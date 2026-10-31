# Trazabilidad del proyecto

Registro cronológico de las acciones, decisiones y comandos del Proyecto Grupal II de Big Data (UTEC). Sirve de base para el informe técnico y para reproducir el trabajo.

**Cómo agregar una entrada:** fecha, responsable, qué se hizo y por qué, comandos ejecutados y resultado. Las entradas nuevas van al final. Los datos sensibles (IDs de facturación, correos, contraseñas) se reemplazan por `<PLACEHOLDER>`.

## Datos generales

| Dato | Valor |
| --- | --- |
| Fecha de entrega | 17 de noviembre de 2026 |
| Integrantes | 4 |
| Dataset | Wikipedia Recent Changes (Wikimedia EventStreams) |
| Wikis incluidas | `enwiki`, `eswiki` |
| Repositorio | `github.com/Zoro4r/big-data-p2` (privado) |
| Proyecto GCP | `big-data-p2` |

---

## 2026-10-31

### 1. Lectura de las instrucciones

Se revisó `Instrucciones Proyecto Grupal II.pdf`. Requisitos principales:

- Dataset semiestructurado, con al menos 50,000 registros y actualizable.
- Arquitectura multimodelo: MongoDB, Cassandra y Neo4j.
- DAG de Airflow con 6 etapas (extracción, validación, carga en Mongo, Cassandra y Neo4j, y KPIs), ejecutado de forma programada.
- CRUD en las 3 bases, un dashboard y al menos 5 KPIs.
- Entregables: informe PDF, código, scripts de creación de las bases, DAG, dashboard y un video de 20 a 25 minutos.

### 2. Evaluación de GitHub Events (descartado)

Se evaluó GH Archive (`gharchive.org`) como primera opción. Se descargó una hora de muestra:

```bash
curl -sS -o h.json.gz -w "%{http_code} %{size_download}\n" \
  https://data.gharchive.org/2026-10-30-15.json.gz
gunzip -c h.json.gz | wc -l
```

Resultado: HTTP 200, 4.9 MB y **4,880 eventos** en esa hora. Es mucho menos que los más de 100k por hora de años anteriores.

**Decisión:** se descartó porque otro grupo ya había elegido este dataset.

### 3. Selección y verificación de Wikipedia Recent Changes

Se capturaron 2 minutos del stream público (sin API key):

```bash
curl -sS -N -m 120 -H 'Accept: text/event-stream' \
  -A 'UTEC-BigData-Project/0.1 (<CORREO_CONTACTO>)' \
  https://stream.wikimedia.org/v2/stream/recentchange > stream.txt
grep -c '^data:' stream.txt
```

Se analizó la muestra con un script de Python que lee las líneas `data:`, descarta los eventos de prueba (`meta.domain == "canary"`) y cuenta tipos, bots, wikis, usuarios y páginas.

| Métrica | Valor |
| --- | --- |
| Eventos válidos | 4,915 en 134 s (~37 eventos/s, ~132k por hora) |
| Tipos | `categorize` 2,323 · `edit` 2,105 · `new` 260 · `log` 227 |
| Bots | 51.4% |
| Cuentas temporales (`~AAAA-NNNNN-NN`) | 2.6% |
| Wikis / usuarios / páginas distintos | 93 / 607 / 2,758 |
| Reversiones que nombran al editor revertido | 16 |
| Ediciones en páginas de discusión de usuarios | 27 |

Se verificó que el stream permite pedir datos pasados con `?since=`:

```bash
curl -sS -N -m 8 "https://stream.wikimedia.org/v2/stream/recentchange?since=2026-10-28T00:00:00Z" \
  | grep -m1 '^data:'
```

Resultado: devolvió eventos del 28 de octubre de 2026. Esto permite extraer por ventanas fijas y reprocesar horas pasadas (backfill).

**Hallazgos que afectan el diseño:**

- Wikimedia ya no muestra IPs de usuarios anónimos; ahora usa cuentas temporales con prefijo `~`.
- El texto de los eventos `categorize` cambia según el idioma, así que la página afectada se extrae del enlace `[[...]]`.
- Las reversiones se detectan por el enlace `[[Special:Contributions/X]]` en el comentario, que tiene el mismo formato en todos los idiomas.

**Decisión:** el dataset es Wikipedia Recent Changes. El profesor dio el visto bueno.

### 4. Documento de justificación del dataset

Se redactó el documento de justificación con: origen, estructura, verificación empírica, cumplimiento de requisitos, encaje multimodelo, modelo de grafo y KPIs candidatos.

- Versión en Markdown: [`docs/justificacion-dataset.md`](justificacion-dataset.md), con las imágenes en `docs/img/`.
- **Modelo de grafo:** 4 tipos de nodo (Editor, Página, Wiki, Categoría) y 11 tipos de relación. Incluye una capa de relaciones entre editores: `REVIRTIO`, `MENSAJE_A`, `AGRADECIO`, `BLOQUEO` y `COEDITA`.
- **Corrección durante la revisión:** el ejemplo real se interpretó primero como coedición, pero el editor central era un patrullero que revertía ediciones. Se corrigió a "red de reversiones": 5 reversiones y 5 avisos en 93 segundos.

### 5. Repositorio

Se creó el repositorio local y se subió a GitHub como privado, con un commit por cada cambio lógico, según `CLAUDE.md`:

```bash
git init -b main
git commit -m "chore: add gitignore"
git commit -m "chore: add claude instructions"
git commit -m "docs: add project instructions"
git commit -m "docs: add dataset justification"
gh repo create Zoro4r/big-data-p2 --private --source . --remote origin --push
```

### 6. Decisión de infraestructura: GCP

Se evaluaron tres opciones: todo local, servicios administrados y una VM en la nube.

**Decisión:** GCP con una VM de Compute Engine que corre MongoDB, Cassandra, Neo4j y Airflow con Docker. Además se usan Cloud Storage para los datos crudos y Cloud Run para el dashboard.

Motivos:

- **Cloud Composer** (Airflow administrado) cuesta del orden de $10–15 por día. Agotaría los créditos.
- **MongoDB Atlas y Neo4j AuraDB**, en sus planes gratis, se llenarían en 1 o 2 días con nuestro volumen.
- **La VM** cuesta del orden de $3–4 por día y permite que el pipeline corra 24/7.

### 7. Limpieza de la cuenta de GCP

Se revisaron los créditos en la consola: **S/ 270.07** restantes del Free Trial, que vencen alrededor del 27 de noviembre de 2026.

Se inventariaron los recursos con cobro en todos los proyectos:

```bash
gcloud compute instances list --project <PROYECTO>
gcloud compute disks list --project <PROYECTO> \
  --format="table(name,type.basename(),sizeGb,provisionedIops,provisionedThroughput)"
gcloud dataproc clusters list --project <PROYECTO> --region us-east4
gcloud storage buckets list --project <PROYECTO>
```

Hallazgo: había dos clusters de Dataproc de trabajos anteriores, apagados pero con 6 discos `hyperdisk-balanced` (3 × 50 GB y 3 × 150 GB). Esos discos se seguían cobrando, unos $100 al mes según una estimación de precios de lista. Se eliminaron:

```bash
gcloud dataproc clusters delete chicago-crime-dask --region us-east4 --project <PROYECTO_ANTERIOR_1> --quiet
gcloud dataproc clusters delete mi-cluster-utec   --region us-east4 --project <PROYECTO_ANTERIOR_2> --quiet
```

Resultado: no quedaron VMs ni discos.

### 8. Proyecto de GCP del curso

Se eliminó el proyecto anterior del curso, que no tenía datos en BigQuery y cuyos buckets estaban vacíos. Luego se creó el proyecto dedicado:

```bash
gcloud projects delete <PROYECTO_ANTERIOR_1> --quiet      # recuperable 30 días con 'undelete'
gcloud projects create big-data-p2 --name="big-data-p2"
gcloud billing projects link big-data-p2 --billing-account <BILLING_ACCOUNT_ID>
gcloud config set project big-data-p2
```

Resultado: el proyecto `big-data-p2` quedó activo y con facturación habilitada. Todavía no tiene APIs ni recursos.

> **Nota para el despliegue:** el ID de un proyecto de GCP es único en todo el mundo. Los demás integrantes deben usar un ID propio, por ejemplo `big-data-p2-<nombre>`. El nombre visible puede ser el mismo.

### 9. Decisiones del equipo

- **Integrantes:** 4.
- **Wikis:** `enwiki` y `eswiki`.
- **Infraestructura como código:** Terraform más un script `deploy.sh`, para que cualquier integrante despliegue todo en su propio proyecto con un solo comando.

---

## Pendientes

- [ ] Definir el reparto de componentes entre los 4 integrantes.
- [ ] `docker-compose` local con MongoDB, Cassandra, Neo4j, Airflow y Streamlit.
- [ ] Extracción por ventanas y limpieza.
- [ ] Cargas en MongoDB, Cassandra y Neo4j, y cálculo de KPIs.
- [ ] DAG de Airflow programado cada hora.
- [ ] Terraform y `deploy.sh` para GCP, con instrucciones de despliegue (`docs/despliegue.md`).
- [ ] Dashboard y página de CRUD.
- [ ] Informe PDF y video.
