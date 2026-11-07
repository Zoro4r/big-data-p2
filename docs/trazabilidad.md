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
- **Reparto de componentes** (aprobado):

| Integrante | Componente principal | En el DAG | CRUD y dashboard |
| --- | --- | --- | --- |
| 1 | Infraestructura: Terraform, `deploy.sh`, docker-compose | Extracción, y armar y programar el DAG | Página "Resumen" (KPIs) |
| 2 | MongoDB | Validación, limpieza y carga en Mongo | CRUD de Mongo y página "Explorador de eventos" |
| 3 | Cassandra | Agregación y carga en Cassandra, cálculo de KPIs | CRUD de Cassandra y página "Actividad en el tiempo" |
| 4 | Neo4j | Construcción de relaciones y carga en Neo4j | CRUD de Neo4j y página "Red de editores" |

### 10. Base del pipeline: extracción, limpieza, docker-compose y DAG

**Extracción** ([`src/wikipipe/extract.py`](../src/wikipipe/extract.py)):

- Pide el stream con `?since=<inicio de la ventana>`.
- Guarda solo los eventos de `enwiki` y `eswiki` con `inicio <= meta.dt < fin`.
- Escribe el resultado en `data/raw/AAAA-MM-DD/HHMM.jsonl.gz`.
- Si la conexión se corta, se reconecta con `Last-Event-ID`.

Problemas encontrados y cómo se resolvieron:

1. **El primer evento cortaba la lectura.** El stream mezcla dos datacenters (`eqiad` y `codfw`). Al pedir datos pasados, el inactivo entrega primero un evento `canary` con la hora actual. Solución: ignorar los `canary` y cortar solo después de 100 eventos reales fuera de la ventana.
2. **Error al comparar fechas en Airflow** (`can't compare offset-naive and offset-aware datetimes`). Airflow entrega fechas de `pendulum`, que pierden la zona horaria al convertirlas con `astimezone()` y sumarles un `timedelta`. Solución: normalizar con `datetime.fromtimestamp(x.timestamp(), tz=timezone.utc)`.

**Limpieza** ([`src/wikipipe/clean.py`](../src/wikipipe/clean.py)): valida los campos obligatorios, descarta los `canary` y los duplicados, y agrega `_id = meta.id` y un subdocumento `derived` con estos campos:

- Fecha, hora y minuto del evento.
- Tipo de editor: bot, temporal, ip o registrado.
- Cambio de tamaño (Δbytes).
- Destino de reversiones, mensajes, bloqueos, agradecimientos, traslados y subidas de archivos.
- Página y acción (añadida o eliminada) de los eventos `categorize`.

Las reglas se probaron con comentarios reales de las dos wikis:

- **Reversiones:** `Undid`, `Reverted`, `Deshecha`, `Revertida`, con enlaces `Special:Contributions/`, `Special:Contribs/` y `Especial:Contribuciones/`.
- **Falsos positivos excluidos:** `Warning`, `Reporting`, `Restored` y las autorreversiones.

```bash
PYTHONPATH=src .venv/bin/python -m pytest -q tests   # 8 passed
```

**Entorno Docker** ([`docker-compose.yml`](../docker-compose.yml)):

- MongoDB 7.0 (caché de 0.25 GB).
- Cassandra 4.1 (heap de 512 MB).
- Neo4j 5.26 Community (heap de 512 MB).
- Postgres 16, como base de metadatos de Airflow.
- Airflow 2.10.5 en modo `standalone` con `LocalExecutor`.
- La imagen de Airflow ([`airflow/Dockerfile`](../airflow/Dockerfile)) instala los drivers usando las restricciones oficiales de Airflow 2.10.5. Por eso `requirements.txt` usa rangos de versiones y no versiones fijas.

```bash
cp .env.example .env    # contraseñas generadas con openssl rand
docker compose up -d --build
```

Problema de memoria: con ~3.8 GB asignados a Docker, el kernel mató a Cassandra 12 veces mientras corrían tareas (`Out of memory: Killed process ... java`). Solución:

- 1 worker para el webserver de Airflow (`AIRFLOW__WEBSERVER__WORKERS=1`).
- `AIRFLOW__CORE__PARALLELISM=4`.
- Se detuvo el otro proyecto Docker del equipo local.

En GCP la VM tendrá más memoria.

**DAG** ([`airflow/dags/wikipedia_pipeline.py`](../airflow/dags/wikipedia_pipeline.py)): `wikipedia_recent_changes` se ejecuta `@hourly` con `max_active_runs=1` y 2 reintentos cada 5 minutos. Sus 6 etapas son:

```
extraer → validar_y_limpiar → cargar_mongo → [cargar_cassandra, cargar_neo4j] → calcular_kpis
```

Las 4 cargas están como tareas vacías (`EmptyOperator`) hasta que cada integrante implemente su parte.

Otro problema: con `start_date` el 1 de noviembre, una prueba del 31 de octubre terminaba en "success" sin ejecutar ninguna tarea. Solución: `start_date` el 25 de octubre de 2026, con `catchup=False`.

Prueba de punta a punta sobre una hora real:

```bash
docker compose exec airflow airflow dags test wikipedia_recent_changes 2026-10-31T17:00:00+00:00
```

| Ventana procesada | Leídos del stream | enwiki + eswiki | Válidos | Rechazados | Duración de la extracción |
| --- | --- | --- | --- | --- | --- |
| 2026-10-31 16:00–17:00 UTC | 171,756 | 16,442 | 16,442 (100%) | 0 | 52 s |

Con ~16k eventos por hora, el mínimo de 50,000 registros se supera con 4 horas de datos.

### 11. Cargas en las tres bases y cálculo de KPIs

Se implementaron las 4 tareas que faltaban en el DAG. Diseño general:

- **MongoDB es la fuente de verdad.** Cassandra y Neo4j leen de Mongo los eventos de la ventana (`derived.event_dt` entre el inicio y el fin de la hora), así el flujo de datos queda Mongo → Cassandra y Mongo → Neo4j.
- **Todas las cargas son idempotentes.** Re-ejecutar una hora deja el mismo resultado.

**Scripts de creación de las bases** (entregable), aplicados por [`db/create_schemas.py`](../db/create_schemas.py):

| Base | Script | Contenido |
| --- | --- | --- |
| MongoDB | [`db/mongo/schema.json`](../db/mongo/schema.json) | Colecciones `events` (con validador `$jsonSchema`), `events_rejected` y `pipeline_runs`; 5 índices en `events` |
| Cassandra | [`db/cassandra/schema.cql`](../db/cassandra/schema.cql) | Keyspace `wikipipe`; tablas `resumen_por_hora`, `eventos_por_minuto`, `actividad_editor`, `paginas_top_por_hora`, `kpis` y `ejecuciones` |
| Neo4j | [`db/neo4j/constraints.cypher`](../db/neo4j/constraints.cypher) | Unicidad de `Editor.user`, `Pagina.key`, `Wiki.nombre` y `Categoria.key`; 3 índices |

```bash
docker compose exec airflow python /opt/airflow/db/create_schemas.py
```

**Carga en MongoDB** ([`src/wikipipe/mongo.py`](../src/wikipipe/mongo.py)):

- Hace `ReplaceOne(upsert=True)` por `_id = meta.id`, en lotes de 1,000.
- Las claves que MongoDB no acepta (por ejemplo `$schema`) se renombran.
- Los rechazados van a `events_rejected`, y el resumen de cada hora a `pipeline_runs`.

**Carga en Cassandra** ([`src/wikipipe/cassandra_store.py`](../src/wikipipe/cassandra_store.py)):

- Agrega en memoria los eventos de la hora y escribe valores ya calculados, que se sobrescriben al re-ejecutar.
- No usa contadores (`counter`), porque se duplicarían en una re-ejecución.
- El top de páginas de una hora se borra y se reescribe entero.
- El módulo no se llama `cassandra.py` para no tapar el paquete `cassandra` del driver.

**Carga en Neo4j** ([`src/wikipipe/neo4j_store.py`](../src/wikipipe/neo4j_store.py)):

- Usa `UNWIND` + `MERGE` en lotes de 2,000.
- Las relaciones que acumulan conteos (`EDITO`, `REVIRTIO`, `MENSAJE_A`, `AGRADECIO`) guardan en la propiedad `ventanas` las horas ya sumadas, y no las vuelven a sumar.
- `EN_CATEGORIA` se crea o se borra según la última acción de la hora.
- `COEDITA` se recalcula para las páginas editadas en la hora. Solo cuenta editores humanos, y se omiten las páginas con más de 50 editores para no generar demasiados pares.

**KPIs** ([`src/wikipipe/kpis.py`](../src/wikipipe/kpis.py)): 12 KPIs por hora, cada uno calculado en la base que mejor lo responde. Se guardan en la tabla `kpis` de Cassandra y en `pipeline_runs` de MongoDB.

| Fuente | KPIs |
| --- | --- |
| Cassandra | eventos procesados, crecimiento %, tasa de automatización %, actividad por editor |
| MongoDB | tasa de creación %, volumen neto en bytes, tasa de reversión %, total acumulado |
| Neo4j | página más disputada, editor más conectado, editor más revertido |
| Limpieza | calidad de datos % |

**Problema encontrado:** el KPI "editor humano más conectado" devolvía bots (ClueBot NG, AnomieBOT). Wikimedia no marca todas las ediciones de un bot con `bot = true`; por ejemplo, las reversiones de ClueBot NG salen sin la marca a propósito. Solución: un editor también es bot si su nombre termina una palabra en "bot", que es la convención obligatoria en Wikipedia. Se agregaron pruebas, incluido un nombre que no debe confundirse con bot ("Abbott"). Después se borraron los datos de prueba de las tres bases y se reprocesaron las dos horas.

**Resultados** (dos horas reales procesadas con `airflow dags test`):

| KPI | 16:00–17:00 UTC | 17:00–18:00 UTC |
| --- | --- | --- |
| Eventos procesados | 16,442 | 15,402 |
| Crecimiento | — (sin hora anterior) | −6.33% |
| Tasa de automatización | 27.31% | 27.22% |
| Actividad por editor humano | 5.54 | 5.03 |
| Tasa de creación | 3.32% | 3.02% |
| Volumen neto | +1,612,163 bytes | +1,354,552 bytes |
| Tasa de reversión | 2.04% (194) | 1.76% (159) |
| Total acumulado en MongoDB | 16,442 | 31,844 |
| Página más disputada | enwiki:Mišo Kovač (8 editores) | enwiki:Mišo Kovač (11 editores) |
| Editor más conectado (COEDITA) | Celjski Grad (27) | Boud (20) |
| Editor más revertido | Liubuiminn (5) | Cyan015 (16, por 1 editor) |
| Calidad de datos | 100% | 100% |

Tiempos de carga en una hora (~16k eventos): MongoDB 2.4 s, Cassandra 4.3 s, Neo4j 28 s, KPIs 1.7 s.

**Prueba de idempotencia:** se re-ejecutó la hora 16:00 después de cargar la de 17:00. MongoDB insertó 0 documentos y actualizó 16,442; el total acumulado se mantuvo en 31,844 y Neo4j no volvió a sumar las ediciones de esa hora.

### 12. Infraestructura como código y despliegue en GCP

**Herramienta:** Terraform 1.17.1. En macOS, Homebrew no permitía instalarlo porque las Command Line Tools de Xcode estaban desactualizadas, así que se usó el binario oficial verificado con su checksum:

```bash
curl -sSfO https://releases.hashicorp.com/terraform/1.17.1/terraform_1.17.1_darwin_arm64.zip
curl -sSfO https://releases.hashicorp.com/terraform/1.17.1/terraform_1.17.1_SHA256SUMS
grep darwin_arm64 terraform_1.17.1_SHA256SUMS | shasum -a 256 -c -   # OK
unzip terraform_1.17.1_darwin_arm64.zip && mv terraform ~/.local/bin/
```

**Archivos:**

- [`infra/main.tf`](../infra/main.tf), [`variables.tf`](../infra/variables.tf) y [`outputs.tf`](../infra/outputs.tf).
- [`infra/startup.sh`](../infra/startup.sh): script de arranque de la VM.
- [`deploy.sh`](../deploy.sh) y [`destroy.sh`](../destroy.sh).
- Instrucciones para el equipo: [`docs/despliegue.md`](despliegue.md).

**Diseño:**

- **VM:** `e2-standard-2` (2 vCPU, 8 GB), Debian 12, con el mismo `docker-compose.yml` que en local.
- **Código:** `deploy.sh` empaqueta el último commit (`git archive`) y Terraform lo sube al bucket. Como el repo es privado, la VM descarga el código del bucket y no necesita credenciales de GitHub.
- **Contraseñas:** las genera Terraform (`random_password`) y llegan a la VM como metadato (`wikipipe-env`), que el startup script escribe en `.env`.
- **Firewall:** las interfaces web (8080, 7474, 7687, 8501) solo se abren a la IP de quien despliega. SSH solo por IAP (`35.235.240.0/20`). MongoDB y Cassandra no se exponen.
- **Data lake:** un cron copia `data/raw` al bucket cada 30 minutos (`gcloud storage rsync`).
- **DAG:** en la VM arranca activo (`DAGS_PAUSED=false`); en local sigue arrancando pausado.
- **Actualizaciones:** si la VM ya existe, `deploy.sh` vuelve a ejecutar el startup script por SSH (IAP), y los datos se conservan.

**Despliegue:**

```bash
gcloud auth application-default login                    # credenciales para Terraform (navegador)
gcloud auth application-default set-quota-project big-data-p2
PROJECT_ID=big-data-p2 ./deploy.sh
```

**Resultado:**

- Se crearon 16 recursos, en ~3 minutos.
- El startup script terminó en ~3 minutos: instaló Docker y levantó los 5 contenedores sanos.
- Airflow (`:8080`) y Neo4j (`:7474`) responden desde la IP autorizada.
- La primera ejecución programada del DAG (`scheduled__2026-10-31T19:00:00+00:00`) terminó en **success** en 2 min 44 s.
- Memoria de la VM: ~4 GB usados de 8 GB.

| Recurso | Costo aproximado |
| --- | --- |
| VM e2-standard-2 | ~1.6 USD/día |
| IP fija | ~0.12 USD/día |
| Disco de 50 GB y bucket | centavos |
| **Total hasta el 17 de noviembre** | **~30 USD** (cubierto por el crédito) |

### 13. Proyección de volumen y memoria de Neo4j

**Proyección hasta la entrega:**

- Se decidió no procesar horas pasadas (sin backfill) y acumular solo desde el primer despliegue.
- Quedan ~390 horas, desde el 31 de octubre a las 19:00 UTC hasta el 17 de noviembre a las 00:00 UTC.
- A 12–15k eventos por hora en promedio, se estiman **4.7 a 5.9 millones de registros** al llegar a la entrega.

**Medición del grafo tras 4 horas de ejecución automática en la VM:**

| Medida | Valor |
| --- | --- |
| Nodos | 39,924 (28,311 páginas, 6,741 editores, 4,870 categorías, 2 wikis) |
| Relaciones | ~92 mil (`PERTENECE_A` 33k, `EDITO` 30k, `EN_CATEGORIA` 23k, `COEDITA` 2.2k, `MENSAJE_A` 1.2k, `REVIRTIO` 504, ...) |
| Duración de `cargar_neo4j` por hora | 46 s → 25 s → 19 s → 18 s |

**Análisis:**

- El volumen esperado al final (1.5–2 millones de nodos y 5–8 millones de relaciones) no es un problema para Neo4j.
- Los `MERGE` buscan cada nodo por un índice único, así que su costo casi no crece con el tamaño del grafo.
- La carga usa ~20 s de la hora disponible.

Riesgos identificados:

1. **Caché de páginas pequeña:** con el grafo pesando varios GB, aumentan las lecturas a disco.
2. **El cálculo de `COEDITA`:** recorre la historia completa de cada par de editores, así que crece con el tiempo.
3. **Consultas globales del dashboard:** deben usar límites y conteos ya guardados en los nodos.

**Cambio aplicado (riesgo 1):** la memoria de Neo4j ahora se configura con `NEO4J_HEAP` y `NEO4J_PAGECACHE`.

- En local mantiene 512 MB de heap y 256 MB de caché.
- En la VM se subió a **1 GB de heap y 1.5 GB de caché**, con las variables de Terraform `neo4j_heap` y `neo4j_pagecache`.

```bash
PROJECT_ID=big-data-p2 ./deploy.sh   # solo se recreó el contenedor de Neo4j; los datos se conservaron
```

Verificación:

```
server.memory.heap.max_size  = 1.00GiB
server.memory.pagecache.size = 1.50GiB
nodos = 39,924 (sin pérdida)
```

La memoria de la VM quedó en ~5.1 GB usados de 8 GB. La duración de `cargar_neo4j` se seguirá en Airflow; si supera unos minutos, se optimizará `COEDITA` para calcularlo de forma incremental.

### 14. Operaciones CRUD

Se implementó [`src/wikipipe/crud.py`](../src/wikipipe/crud.py), que cubre la sección 4 de las instrucciones:

- **Funciones reutilizables** por base. Las usará la página de CRUD del dashboard.
- **Una demo por consola** para la exposición. Usa entidades marcadas como "demo" que crea y luego borra, así no altera los datos del pipeline. Además consulta datos reales.

| Base | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| MongoDB (`events`) | `insert_one` de un evento con la misma estructura que uno real. Un documento sin `derived` es rechazado por el validador `$jsonSchema` | `find_one` por `_id` y búsqueda de la última reversión real en eswiki | `update_one` con `$set` | `delete_one` |
| Cassandra (`actividad_editor`) | `INSERT` de una fila | `SELECT` por partición (`editor`), con fecha opcional | `UPDATE` por clave primaria completa | `DELETE` de una fila (clave completa) o de la partición |
| Neo4j | `MERGE` de nodos `Editor` y `Pagina`, y de las relaciones `EDITO` y `REVIRTIO` | Editor con sus relaciones salientes | `SET +=` en propiedades del nodo y de la relación | `DELETE` de la relación y `DETACH DELETE` de los nodos |

Seguridad de las consultas: los tipos de relación y las etiquetas se validan contra una lista fija antes de insertarlos en el texto Cypher. Los valores siempre van como parámetros.

```bash
docker compose exec airflow python -m wikipipe.crud todo                                  # local
gcloud compute ssh wikipipe-vm --zone us-central1-a --tunnel-through-iap \
  --command "cd /opt/wikipipe && sudo docker compose exec -T airflow python -m wikipipe.crud todo"   # VM
```

Resultado en la VM: las 12 operaciones se ejecutaron correctamente. La consulta real mostró **79,521 eventos** en `events`, así que el mínimo de 50,000 registros ya se superó tras ~5 horas de ejecución automática. Las entidades demo quedaron eliminadas: `encontrado: false` en Mongo y en Neo4j, y 0 filas en Cassandra.

**Correcciones encontradas al probar:**

- **Neo4j:** el borrado de relaciones buscaba el nodo de origen sin etiqueta, lo que obliga a recorrer todos los nodos. Se agregó `:Editor` para usar el índice único.
- **Cassandra:** un editor que en una hora solo fue revertido (sin ediciones propias) quedaba con `tipo_editor = desconocido`. Ahora el tipo se deduce por el nombre (temporal, ip, bot o registrado), igual que en Neo4j.

### 15. Dashboard en Streamlit

**Stack:** Streamlit 1.45, Plotly 6 para los gráficos y pyvis para el grafo interactivo. Corre como servicio `dashboard` del `docker-compose` (puerto 8501), con su propia imagen ([`dashboard/Dockerfile`](../dashboard/Dockerfile)).

**Páginas** ([`dashboard/`](../dashboard/)):

| Página | Base | Contenido |
| --- | --- | --- |
| Resumen y KPIs | Cassandra (`kpis`, `resumen_por_hora`, `ejecuciones`) | 12 KPIs de la última hora con su cambio respecto de la anterior; eventos por hora y wiki; evolución de cualquier KPI; tabla con definición, fórmula, fuente e interpretación de cada KPI |
| Actividad en el tiempo | Cassandra (`eventos_por_minuto`, `paginas_top_por_hora`, `actividad_editor`) | Serie por minuto (total y bots), top 10 de páginas por hora, historial de un editor |
| Explorador de eventos | MongoDB (`events`) | Eventos por tipo y wiki en 24 h (`$group`), búsqueda con filtros (wiki, tipo, editor, título, solo reversiones) y el documento JSON completo |
| Red de editores | Neo4j | Tamaño del grafo, editores más revertidos, patrulleros más activos, páginas más disputadas y vecindario interactivo de un editor |
| Operaciones CRUD | Las 3 | Formularios para crear, consultar, actualizar y eliminar en cada base; reutiliza `wikipipe.crud` |

**Decisiones de diseño:**

- **Conexiones y caché:** las conexiones se crean una vez por proceso (`st.cache_resource`) y las consultas se guardan 5 minutos (`st.cache_data`), porque los datos cambian una vez por hora. Las operaciones CRUD limpian esa caché.
- **Colores:** paleta categórica validada con el script de la guía de visualización: azul `#2a78d6` para enwiki y registrados, naranja `#eb6834` para eswiki y cuentas temporales, aqua `#1baf7a` para bots. Resultado: todas las comprobaciones de daltonismo y separación aprobadas, con un aviso de contraste del aqua, que se compensa con leyenda y tablas.
- **Gráficos:** una sola escala por gráfico; series de una sola métrica en el mismo azul; hover en todos los gráficos.
- **Conteos del grafo:** se consultan con la etiqueta o el tipo escritos en la consulta (`MATCH (n:Editor) RETURN count(n)`), que Neo4j responde desde sus contadores internos sin recorrer el grafo.
- **Seguridad:** contraseña opcional (`DASHBOARD_PASSWORD`). En la VM la genera Terraform, porque la página CRUD permite escribir. Además, el firewall solo abre el puerto 8501 a la IP autorizada.

**Pruebas:**

- Cada página se ejecutó con `streamlit.testing.v1.AppTest`: 0 excepciones en las 5.
- Se revisaron capturas tomadas con Playwright (Chrome headless).

Problemas encontrados y corregidos:

1. **Fechas de Cassandra:** el driver devuelve el tipo `Date`, que la tabla de Streamlit (Arrow) no sabe mostrar. Se convierten a `datetime.date`.
2. **Modo "magic" de Streamlit:** expresiones como `st.json(x) if c else st.warning(...)` se imprimirían en pantalla. Se reemplazaron por `if/else`.
3. **Flechas engañosas:** los KPIs de grafo mostraban una flecha ↑ junto al detalle, como si fuera un cambio. Ahora el detalle va como texto debajo.
4. **Eje de tiempo** en milisegundos con un solo punto: ahora se muestra un aviso cuando hay menos de dos horas de datos.
5. **Cambios de código no aplicados:** Streamlit en Docker no detectaba los cambios en el volumen montado desde macOS. Se reinicia el contenedor.
6. **Grafo ilegible** con muchos vecinos: se acortaron los resortes, se agrandó la letra y las etiquetas de las flechas pasan al hover cuando hay más de 12 relaciones.
7. **Color de los rankings:** el de editores revertidos usaba el naranja de eswiki; se cambió al azul base.

**Despliegue:**

```bash
PROJECT_ID=big-data-p2 ./deploy.sh   # crea el contenedor dashboard; Terraform genera DASHBOARD_PASSWORD
```

Verificación en la VM: se ingresó con la contraseña desde la IP autorizada. El Resumen mostró 4 horas procesadas automáticamente (19:00–22:00 UTC), 79,521 eventos acumulados y la página más disputada con 18 editores distintos.

### 16. Dashboard compartido y rediseño visual

**Compartir con el equipo.** El firewall solo permitía la IP de quien desplegó. Se evaluaron tres opciones:

1. Abrir solo el dashboard a internet.
2. Agregar las IPs de los compañeros.
3. Acceso con IAP.

Se eligió la opción 1: una regla aparte, `wikipipe-dashboard` (tcp:8501), con origen `0.0.0.0/0` por defecto (variable `dashboard_cidrs`). Lo protege la contraseña `DASHBOARD_PASSWORD`. Airflow y Neo4j (8080, 7474 y 7687) siguen restringidos a la IP autorizada.

```
wikipipe-dashboard  0.0.0.0/0        tcp:8501
wikipipe-web        <IP-autorizada>  tcp:8080,tcp:7474,tcp:7687
wikipipe-ssh-iap    35.235.240.0/20  tcp:22
```

**Hallazgo de seguridad.** GCP crea en todo proyecto nuevo las reglas `default-allow-ssh` (tcp:22) y `default-allow-rdp` (tcp:3389), abiertas a `0.0.0.0/0`. Eso anulaba la decisión de permitir SSH solo por IAP, así que se eliminaron:

```bash
gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --project big-data-p2 --quiet
```

Verificación:

- El SSH por IAP sigue funcionando (`gcloud compute ssh ... --tunnel-through-iap`).
- El puerto 22 ya no responde desde internet (`nc -z 34.45.96.253 22` falla).
- Se agregó el paso a [`docs/despliegue.md`](despliegue.md) para los proyectos de los demás integrantes.

**Rediseño del dashboard.** La primera versión se veía demasiado simple. Se creó [`dashboard/ui.py`](../dashboard/ui.py) con un sistema visual propio:

- Tipografía Inter y tema claro con color primario `#2a78d6`.
- Barra lateral oscura con la marca del proyecto.
- Cabecera ("hero") en cada página, con estado en vivo: última hora procesada, eventos almacenados y horas procesadas.
- Tarjetas de KPI con barra de acento, sparkline de las últimas 24 horas (SVG) y pastilla de cambio coloreada según si el cambio es bueno o malo. Por ejemplo, una baja en la tasa de reversión sale en verde.
- Tarjetas destacadas para los "protagonistas de la hora" (página más disputada, editor más conectado, editor más revertido).
- Secciones con título y subtítulo que nombran la tabla o la consulta de origen.
- Gráficos dentro de tarjetas, con área rellena y barras con esquinas redondeadas.
- En los rankings de Neo4j, el color de cada barra indica el tipo de editor (registrado, temporal o bot), igual que en el grafo interactivo.
- El texto que viene de los datos se escapa (`html.escape`) antes de insertarlo en el HTML.

Ajustes tras revisar capturas:

- El estilo de tarjeta blanca se limitó al área principal, porque afectaba a la barra lateral.
- Se agregó margen superior a la cabecera.
- Ticks del eje de tiempo cada una hora.
- Grilla de 4 tarjetas por fila, con etiquetas en una línea.
- La página de Actividad abre en el último día con datos.
- Se acortaron los textos que se cortaban.

Verificación: 0 excepciones en las 5 páginas (`AppTest`) y captura en la VM con datos reales. Por ejemplo, el 31 de octubre enwiki tuvo 93,288 eventos, un pico de 818 por minuto a las 19:18, 31.5% hechos por bots y 665 reversiones.

### 17. Decisión: dashboard en React + shadcn/ui, con mockup previo

Aun con el rediseño, el dashboard en Streamlit se veía poco profesional. shadcn/ui es una librería de React, así que no se puede integrar de verdad en Streamlit: el paquete comunitario `streamlit-shadcn-ui` muestra cada componente en un iframe y está poco mantenido.

**Decisión** (aprobada): migrar el dashboard a **React + shadcn/ui + Recharts**, con una API en **FastAPI** que reutiliza las consultas actuales a las tres bases. El enunciado lo permite: "Streamlit o Dash (Python) u otro que crea conveniente".

**Mockup previo en Claude Design** (lienzo privado del dueño del proyecto), con 4 pantallas: Resumen y KPIs, Actividad en el tiempo, Red de editores y Operaciones CRUD.

- **Estilo:** neutros zinc de shadcn, tipografía Geist, tarjetas con borde fino y barra lateral clara.
- **Colores de datos:** la paleta validada de la entrada 15.
- **Datos:** reales, tomados de la VM el 31 de octubre de 2026. Por ejemplo, la hora 23:00 tuvo 18,606 eventos, con 41.43% de bots y 164 reversiones.
- **Pendiente:** la pantalla "Explorador de eventos" no se incluyó en el mockup; se diseñará al implementar.

### 18. Dashboard en React + shadcn/ui + FastAPI

Se aprobó el mockup y se implementó el dashboard nuevo. Reemplaza a la versión Streamlit, que queda en el historial de git.

**Arquitectura:**

```
navegador ──► web (nginx, puerto 8501) ──/api──► api (FastAPI) ──► MongoDB · Cassandra · Neo4j
```

**API** ([`api/`](../api/)):

- FastAPI 0.115.
- [`queries.py`](../api/queries.py) reutiliza las consultas de la versión Streamlit, con una caché en memoria de 60 segundos. El CRUD usa las funciones de `wikipipe.crud`.
- Rutas de lectura: `/api/resumen`, `/api/serie10`, `/api/actividad`, `/api/editor/{nombre}`, `/api/eventos`, `/api/eventos/{id}`, `/api/red` y `/api/red/ego/{nombre}`.
- Rutas de CRUD por base: `/api/crud/mongo`, `/api/crud/cassandra` y `/api/crud/neo4j/...`.
- Documentación automática en `/api/docs`.
- **Seguridad:** si existe `DASHBOARD_PASSWORD`, `/api/login` entrega una cookie `httpOnly` (HMAC-SHA256 de la clave) y un middleware rechaza con 401 las rutas sin sesión. En la VM la clave la sigue generando Terraform.

**Frontend** ([`web/`](../web/)):

- Vite 6 + React 19 + TypeScript.
- Tailwind CSS 4 con el tema zinc de shadcn/ui: componentes card, badge, button, table, tabs, select, toggle-group, input, textarea y sonner.
- Recharts 2 para los gráficos y react-force-graph-2d para el grafo de fuerzas.
- Tipografía Geist y la paleta de datos validada (enwiki/registrado azul, eswiki/temporal naranja, bot verde).
- Cada página se carga por separado: el JavaScript inicial pesa 121 KB comprimido.

Las 5 páginas siguen el mockup:

| Página | Contenido |
| --- | --- |
| Resumen | 8 KPIs con pastilla de cambio (verde si mejora, rojo si empeora); ritmo cada 10 minutos por wiki; protagonistas de la hora; tabla de ejecuciones; evolución de cualquier KPI; tabla de definiciones |
| Actividad | KPIs del día; barras apiladas de humanos y bots por hora; pulso por minuto; top 10 de páginas por hora; historial de un editor |
| Explorador | Totales por tipo; barras por tipo y wiki (`$group`); búsqueda con filtros; tabla de resultados y documento JSON completo al hacer clic |
| Red | Tamaño del grafo; grafo interactivo (arrastrar, zoom, clic en un vecino para explorarlo); rankings de revertidos y patrulleros coloreados por tipo de editor; páginas disputadas |
| CRUD | Pestañas por base; operación como control segmentado; resultado en JSON con botón de copiar; historial de la sesión; notificaciones; botón para mostrar el validador de MongoDB rechazando un documento |

**Despliegue:**

- En el `docker-compose`, el servicio `dashboard` se reemplazó por `api` y `web`.
- `web` es una imagen multietapa: `node:22` compila y `nginx:1.27` sirve los archivos y redirige `/api` a la API.
- El puerto sigue siendo 8501, así que el firewall y Terraform no cambian.
- La API se publica solo en `127.0.0.1:8000`, para desarrollar el frontend con `npm run dev`.

**Problema encontrado:** `shadcn init` falló en la validación del CSS (`css: Invalid input`), aunque sí agregó los componentes, pero importando `cn` desde una ruta inválida (`"cn"`). Se corrigió a mano:

- Se creó `src/lib/utils.ts` y se reemplazaron los imports por `@/lib/utils`.
- Se instalaron las dependencias que faltaban: `clsx`, `tailwind-merge`, `class-variance-authority`, `radix-ui` y `tw-animate-css`.
- Se escribió el tema zinc de Tailwind 4 en `src/index.css`.

**Pruebas:**

- `npm run build` sin errores de TypeScript.
- Las 5 páginas, capturadas con Playwright, sin errores en la consola del navegador.
- Operación CREATE probada desde la página CRUD; el documento de prueba se borró después.

Ajustes tras revisar las capturas:

- El grafo se veía amontonado: se aumentó la repulsión (−260) y el largo de las aristas (90), y se ajusta el zoom al terminar de acomodarse.
- Los selectores del Explorador ahora ocupan todo el ancho.
- Se oculta la pastilla de cambio cuando el valor no cambió.

**Despliegue en la VM:**

- `./deploy.sh` construyó los contenedores `api` y `web`, y eliminó el contenedor `dashboard` (Streamlit) por quedar huérfano.
- Sin sesión, `/api/resumen` responde 401.
- Con la contraseña, el dashboard mostró 6 horas procesadas, 114,320 eventos acumulados y 0 errores en la consola del navegador.

### 19. Capa rápida (streaming): datos en segundos

**Motivo:** hasta aquí el pipeline procesaba por lotes una vez por hora, y los datos llegaban a las bases y al dashboard con 3 a 60 minutos de atraso. La expectativa del equipo era ver la actividad casi en vivo: Wikipedia emite eventos cada pocos segundos (~4–5 por segundo entre enwiki y eswiki).

**Decisión:** pasar a una **arquitectura Lambda** con dos capas:

- **Capa rápida:** un servicio nuevo, `stream`, que corre 24/7.
- **Capa por lotes:** el DAG de Airflow, que sigue cada hora con sus 6 etapas.

Se descartó acortar el intervalo del DAG a 5–10 minutos: los agregados por hora y los KPIs asumen ventanas de una hora, y la latencia seguiría siendo de minutos.

**Capa rápida** ([`src/wikipipe/streaming.py`](../src/wikipipe/streaming.py)):

- Se conecta al stream sin `?since=` y no se desconecta.
- Aplica la misma validación y los mismos campos derivados que el DAG (reutiliza `clean.validate` y `clean.derive`).
- Cada ~2 s, o cada 200 eventos, guarda los eventos en MongoDB (`ReplaceOne` con `upsert` por `_id`) y reescribe en Cassandra (`eventos_por_minuto`) los contadores de los minutos que cambiaron.
- Guarda un marcador del último evento leído en la colección `stream_state`. Al reiniciar o al cortarse la conexión, retoma desde ahí con el encabezado `Last-Event-ID` (si el marcador tiene menos de 24 h).
- **Sin duplicados:** las dos capas usan el mismo `_id` (`meta.id`).
- **La capa por lotes corrige a la rápida:** cada hora el DAG vuelve a extraer la hora completa y reescribe los contadores por minuto. Si la capa rápida perdió eventos por un reinicio, la hora queda exacta igual.
- Corre como servicio `stream` del `docker-compose`, con la imagen de la API.

**API y dashboard:**

- Endpoint `/api/vivo`: contadores por minuto de los últimos 30 minutos (Cassandra), las 25 ediciones más recientes (MongoDB), eventos del último minuto y estado del streaming.
- Página **"En vivo"**: se refresca cada 4 segundos. Muestra eventos por segundo, totales de 30 minutos, el pulso por minuto por wiki, y una lista de las últimas ediciones que resalta las nuevas y marca bots y reversiones.

**Pruebas:**

- 2 pruebas nuevas (`tests/test_streaming.py`): filtro y enriquecimiento de eventos, y contadores por minuto. En total, 10 pruebas pasando.
- En local, el último evento guardado tenía 1.4 s de antigüedad.
- En la VM, después de `./deploy.sh`, 2 s de antigüedad y ~4 eventos por segundo.

**Otro cambio:** en el equipo local, el puerto 8000 lo usaba otro proyecto, así que la API de este proyecto se publica en `127.0.0.1:8010`. El proxy de Vite se actualizó; la VM no cambia.

### 20. Cabecera común en el dashboard y dos correcciones de despliegue

**Cabecera homogénea:** cada vista armaba su cabecera a su manera, con filtros, etiquetas propias y el estado en formatos distintos. Ahora todas comparten la misma estructura:

- **A la izquierda:** la ruta (Panel / Vista).
- **Al centro:** solo los filtros de la vista, todos de 32 px de alto. Hay filtros en Resumen y en Actividad.
- **A la derecha:** la misma pastilla de estado en todas las vistas: "● En vivo · hace N s | Lote <hora> UTC". Combina la capa rápida (último evento guardado por el streaming) y la capa por lotes (última hora consolidada por el DAG).

Detalles de implementación:

- Nuevo endpoint liviano `/api/estado`: 1 fila de Cassandra y 1 documento de MongoDB. El frontend lo consulta cada 10 s desde un contexto compartido (`web/src/lib/estado.tsx`).
- Las etiquetas propias de cada vista pasaron a su descripción. La advertencia del CRUD ("Estas operaciones escriben en las bases de producción") quedó como aviso bajo el título.

**Corrección 1: código nuevo que no se aplicaba.** La API y el streaming leen el código desde volúmenes montados, así que un despliegue sin cambios en el `docker-compose` no los reiniciaba y seguían con el código anterior. Ahora `infra/startup.sh` ejecuta `docker compose restart api stream` después de levantar todo.

**Corrección 2: error 502 después de reiniciar la API.** nginx resolvía la dirección del contenedor `api` una sola vez, al arrancar. Cuando la API se reinició y cambió de IP, el dashboard respondió 502; se restauró reiniciando nginx. Solución de fondo en `web/nginx.conf`: `resolver 127.0.0.11 valid=10s` y `proxy_pass` con variable, para que nginx vuelva a resolver la dirección cada 10 s. Se verificó reiniciando la API en local y desplegando en la VM: el dashboard y la API siguieron respondiendo 200.

### 21. Cabecera estándar y filtro global de wiki

La cabecera de "Resumen y KPIs" pasó a ser la misma en las seis vistas: ruta a la izquierda y, a la derecha, el selector de wiki (Ambas / enwiki / eswiki) y la pastilla de estado. Los filtros propios de una vista se movieron dentro de la página: el selector de día de "Actividad en el tiempo" quedó junto al título.

El selector de wiki es global: se guarda en el navegador (`localStorage`, clave `wp-wiki`) y lo usan todas las vistas.

- **API:** los endpoints `/api/vivo`, `/api/serie10`, `/api/actividad`, `/api/eventos` y `/api/red` aceptan `?wiki=ambas|enwiki|eswiki` (un valor distinto devuelve 400). Con "ambas" se suman las series de las dos wikis; en el top de páginas por hora se combinan y se vuelven a ordenar.
- **En vivo, Actividad y Explorador:** las series y leyendas muestran solo la wiki elegida. El Explorador ya no tiene su propio selector de wiki.
- **Red de editores:** los rankings y las páginas disputadas se filtran en Neo4j (`WHERE $wiki IS NULL OR r.wiki = $wiki`); los totales del grafo siguen siendo de ambas wikis.
- **Resumen:** el ritmo de ediciones y las ejecuciones se filtran; los KPIs se calculan sobre ambas wikis y la página lo indica.
- **CRUD:** la wiki de los formularios toma la elegida en la cabecera (con "Ambas", enwiki).

Verificación: `tsc` y `npm run build` sin errores; capturas con Playwright de las seis vistas con la misma cabecera y sin errores de JavaScript; al elegir eswiki, "En vivo" mostró solo eventos de eswiki. Commits `feat: add wiki filter to api` y `feat: standardize header and filter views by wiki`, desplegados con `./deploy.sh`.

### 22. Modo oscuro en el dashboard

Se agregó un modo oscuro con un botón (sol / luna) al final de la cabecera estándar. La primera vez sigue la preferencia del sistema operativo; después se recuerda la elección en el navegador (`next-themes`, clave `wp-tema`).

- `web/src/index.css`: paleta zinc oscura de shadcn/ui en la clase `.dark` y un token `--neutro` para la serie "Ambas". Los colores de datos (enwiki azul, eswiki naranja, bots verde) no cambian porque contrastan en ambos fondos.
- Los colores fijos de las vistas se reemplazaron por tokens del tema (`bg-card`, `bg-muted`, `text-muted-foreground`…). Los gráficos usan `var(--border)` y `var(--muted-foreground)`, y las etiquetas de estado (verde, rojo, ámbar) tienen su variante `dark:`.
- El grafo de Neo4j se dibuja en canvas, que no lee variables CSS: toma sus colores del tema activo.

Durante la prueba local, los contenedores de otros dos proyectos (`ccs` y `agente-bc`) ocupaban ~850 MB de los 3.8 GB de Docker y Cassandra y Neo4j se reiniciaban. Se detuvieron con `docker stop` (sin borrarlos).

Verificación: `tsc` y `npm run build` sin errores; capturas con Playwright en modo oscuro de las seis vistas sin errores de JavaScript; el botón cambia a claro y la elección se mantiene al recargar. Commit `feat: add dark mode to dashboard`, desplegado con `./deploy.sh`.

### 23. KPIs por wiki y definiciones en un modal

**Problema.** Al cambiar la wiki en la cabecera, varias secciones no cambiaban: las tarjetas de KPIs, los protagonistas, la evolución de un KPI, la calidad de las ejecuciones y los totales de la Red se calculaban sobre ambas wikis. Además, las tarjetas del Explorador y el historial de un editor en Actividad no se recalculaban con la wiki nueva.

**Pipeline.** El DAG ahora calcula los 12 KPIs tres veces por hora: ambas wikis (tabla `kpis`, sin cambios), enwiki y eswiki (tabla nueva `kpis_por_wiki`, partición `(kpi, wiki)`).

- Cassandra y MongoDB filtran por wiki. "Eventos acumulados" pasa a contar los documentos con fecha anterior al fin de la ventana: la capa de streaming ya guardó eventos posteriores.
- Neo4j: la página disputada filtra `p.wiki`, el editor más conectado debe haber editado esa wiki en la hora, y las reversiones filtran `r.wiki`.
- La limpieza registra la calidad por wiki (`quality_by_wiki`).
- Los totales del grafo por wiki (editores, páginas, ediciones, reversiones…) recorren todas las páginas: en la VM tardan unos 11 s. Por eso los calcula el DAG una vez por hora (`neo4j_store.conteo_por_wiki`) y se guardan en `pipeline_runs`; la API solo los lee. COEDITA no guarda la wiki, así que con una sola wiki la tarjeta muestra los agradecimientos.

**Horas anteriores.** `python -m wikipipe.kpis` rellenó `kpis_por_wiki` para las ventanas ya procesadas: Cassandra y MongoDB exactos, calidad recalculada desde el archivo crudo de cada hora, Neo4j solo en la última ventana (el grafo guarda su estado actual, no el de cada hora). En local, enwiki (14,499) + eswiki (903) = ambas (15,402).

**Dashboard.**
- API: `/api/resumen?wiki=` y `/api/red?wiki=` devuelven los KPIs y totales de la wiki elegida.
- Las definiciones de los KPIs salieron del final del Resumen a un modal (botón "Definición de los KPIs" junto al título), agrupadas por la base que calcula cada uno, con fórmula, interpretación y valor de la última hora.

Verificación: capturas con Playwright en eswiki (KPIs, protagonistas, evolución y totales de la Red cambian) y del modal, sin errores de JavaScript. Commits `feat: compute kpis per wiki`, `feat: serve kpis and graph totals per wiki`, `fix: make every section follow the wiki filter` y `feat: show kpi definitions in a modal`.

En la VM, `python -m wikipipe.kpis` (contenedor de Airflow, que tiene los archivos crudos) rellenó las 150 ventanas procesadas hasta el 7 nov 00:00 UTC sin errores.

### 24. Logos de las bases como fuente de los datos

La fuente de cada tarjeta ("Cassandra · resumen_por_hora", "MongoDB · events", patrones Cypher de Neo4j, "Limpieza · DAG") se muestra ahora con el logo del servicio y el nombre de la tabla, colección o patrón. El texto completo queda en el tooltip y para lectores de pantalla.

- Logos de Simple Icons (licencia CC0, paquete `simple-icons@16.36.0`) con su color de marca: MongoDB, Apache Cassandra, Neo4j y Apache Airflow (la limpieza corre en el DAG). Solo se incluyen los cuatro usados.
- Componente `web/src/components/fuente.tsx`. Se usa en todas las tarjetas de KPIs y en el modal de definiciones, cuyos grupos también llevan el logo.

Commit `feat: show database logos as data sources`, desplegado con `./deploy.sh`.

**Ajuste: recorrido del dato en lugar de nombres de tablas.** Los nombres de tablas (`resumen_por_hora`, `events`) no aportaban en las tarjetas y daban a entender que los KPIs se leen de varias bases. En realidad, cada KPI se calcula en la base que mejor lo responde y todos se guardan en Cassandra, desde donde los lee el dashboard. Se compararon cuatro diseños en Claude Design y se eligió mostrar el recorrido:

- KPI calculado en Cassandra: solo "Cassandra".
- Calculado en otra base: "MongoDB → Cassandra", "Neo4j → Cassandra" o "Airflow → Cassandra" (la calidad sale de la limpieza en el DAG).
- Tarjetas que no son KPIs guardados (En vivo, Actividad, Explorador, Red): la base de la que se leen. Los totales de la Red por wiki muestran "Neo4j → MongoDB", porque el DAG los calcula en Neo4j y los guarda en `pipeline_runs`.

El pie queda separado por una línea y alineado al fondo de la tarjeta; el tooltip dice "Se calcula en X y se guarda en Y". El modal de definiciones usa el mismo recorrido y lo explica en su descripción. Commit `feat: show where each kpi is computed and stored`.

### 25. Tarjetas compactas y detalle de cada KPI

Las tarjetas se veían grandes con el pie "MongoDB → Cassandra". Se diseñaron varias alternativas en Claude Design (tarjetas clickeables, modal, panel lateral, detalle desplegado, globo, botón de información) y se eligió la "F4": un modal en dos columnas.

**Tarjetas.** Quedan solo con nombre, cambio, valor y una línea de contexto, en todas las vistas. En el Resumen, cada tarjeta de KPI es un botón: al pasar el mouse se marca y muestra una flecha junto al nombre, y al hacer clic abre su detalle. Los protagonistas de Neo4j también se pueden clickear.

**Modal de detalle** (`web/src/components/detalle-kpi.tsx`):

- Izquierda: hora del lote, valor grande, cambio frente a la hora anterior dicho en palabras ("0.28 pp menos que la hora anterior"), mini gráfica de las últimas horas (hasta 24) y datos de apoyo: detalle de la hora, valor de la hora anterior y promedio. En los KPIs de Neo4j el dato principal es el nombre de la página o del editor.
- Derecha: Definición, Cómo se calcula (como fracción cuando el KPI es un cociente), Cómo leerlo y De dónde sale ("Se calcula en MongoDB y se guarda en Cassandra", con los logos).
- Pie: anterior/siguiente para recorrer los 12 KPIs sin cerrar el modal.
- El botón "Definición de los KPIs" abre este mismo modal desde el primer KPI; reemplaza a la lista con todas las definiciones.

Cada KPI tiene ahora una definición propia en `web/src/lib/kpis.ts`, además de fórmula e interpretación, que es lo que piden las indicaciones del proyecto para cada indicador.

Verificación: `tsc` y `npm run build` sin errores; con Playwright se abrió un KPI desde su tarjeta, se navegó hasta un KPI de Neo4j, se cerró con Esc y se probó en ancho de celular, sin errores de JavaScript. Commit `feat: open kpi details from compact cards`.

**Ajuste: valores alineados.** Cuando el nombre de un KPI ocupaba dos líneas ("Tasa de automatización", "Volumen neto de contenido"), su valor quedaba más abajo que el de las tarjetas vecinas. Ahora cada tarjeta usa CSS subgrid: ocupa tres filas de la grilla de la página (nombre, valor, contexto), y las tarjetas de una misma fila comparten la altura de cada una. Verificado midiendo la posición de los valores con Playwright: iguales en cada fila con 4 y con 2 columnas. Se quitó el botón "Definición de los KPIs": el detalle se abre desde cada tarjeta. Commit `fix: align kpi card values across each row`.

**Ajuste: anchos fijos.** La descripción de cada página tenía un ancho máximo (`max-w-3xl`) y no llegaba al borde derecho; ahora ocupa todo el ancho disponible (en Actividad, hasta el selector de día). En la pastilla de estado, "hace 9 s" → "hace 10 s" cambiaba su ancho cada pocos segundos; el tiempo tiene ahora un ancho fijo. Verificado con Playwright: la pastilla midió 312 px en 15 lecturas con 9 textos distintos. Commit `fix: keep header pill width and full-width descriptions`.

### 26. Lista de últimas ediciones, filtros y detalle del evento

La lista "Últimas ediciones" de la vista En vivo se rediseñó en Claude Design. Se compararon una tabla con columnas, un feed en frases, una consola y una línea de tiempo, y se eligió una lista ordenada sin encabezados.

**Lista** (`web/src/pages/Vivo.tsx`):

- Cada fila: tiempo · título completo de la página (con su prefijo de espacio de nombres, como "Talk:" o "Category:", porque es parte del nombre) · debajo "wiki · tipo · editor" · bytes a la derecha · flecha.
- La segunda línea tiene el mismo formato en todas las filas. Se quitaron los elementos que solo aparecían en algunas: la etiqueta "revierte a…" (la reversión pasa a ser un tipo más), "menor" y las píldoras "bot"/"temporal" (el tipo de editor lo indica el punto de color, explicado en la leyenda).
- Tipos en español: Edición, Página nueva, Categorización, Reversión, Registro.
- La etiqueta EN/ES solo aparece con el filtro "Ambas" de la cabecera.
- Los eventos nuevos tienen un destello breve (1.5 s): con ~6 eventos/s y una actualización cada 4 s, casi toda la lista es nueva en cada actualización y un resaltado fijo las marcaba todas.

**Filtros:** botón "Filtros" con un menú en dos grupos, tipo de evento (Ediciones, Páginas nuevas, Categorizaciones, Reversiones) y editor (Registrados, Cuentas temporales, Bots). Cada grupo tiene "Todos" (sin filtro), los filtros activos aparecen como fichas con X y hay "Limpiar filtros". La API devuelve ahora los últimos 100 eventos (antes 25) para que, al filtrar por ejemplo por bots, sigan quedando filas; se muestran 25.

**Detalle del evento** (`web/src/components/detalle-evento.tsx`): al hacer clic en una fila se abre un modal con el documento real de MongoDB (`/api/eventos/{id}`):

- Izquierda: fecha y hora exactas, bytes agregados o quitados ("de 1,209 a 1,240 bytes"), una barra con el tamaño de la página y los datos del evento (editor, tipo de editor, wiki, espacio de nombres en español, a quién revierte, revisión).
- Derecha: comentario del editor, enlaces para abrir la página y ver el cambio (diff) en Wikipedia, y el documento de MongoDB (resumen o completo).
- Pie: "Guardado en MongoDB · colección events" y navegación al evento más reciente o más antiguo. El modal navega sobre la lista que se veía al abrirlo, porque la lista en vivo sigue cambiando.

Componentes nuevos de shadcn/ui: `popover` y `checkbox`. Verificación con Playwright: filtro "Bots" (23 de 100 eventos), apertura del modal, navegación y "Ver completo", en claro y oscuro, sin errores de JavaScript. Commit `feat: redesign live edits list with filters and event detail`.

**Ajustes:**

- Las cuatro tarjetas de En vivo (eventos por segundo, últimos 30 minutos, hechos por bots, reversiones) abren el mismo modal de detalle que los KPIs: valor, mini gráfica de los últimos 30 minutos, datos de apoyo (promedio, minuto más activo, bots y humanos, reversiones por cada 100 ediciones), definición, cálculo, lectura y origen (MongoDB para el ritmo del último minuto; Cassandra `eventos_por_minuto` para el resto). La parte visual del modal se separó en `web/src/components/modal-metrica.tsx`, que usan tanto los KPIs del Resumen como estas tarjetas.
- Se quitó el resaltado azul de los eventos nuevos en la lista.

Commit `feat: open live metric details and drop new-row highlight`.

**Ajuste: eje X cada 2 horas.** En "Eventos por minuto" (Actividad) y "Ritmo de ediciones" (Resumen), Recharts elegía las marcas según el espacio (01:46, 03:38…). Ahora el eje es de tiempo y cubre el día completo (UTC) con marcas fijas cada 2 horas en punto: 00:00, 02:00 … 22:00 (`ejeDia` en `web/src/lib/format.ts`). Commit `fix: show two-hour ticks on daily charts`.

**Ajuste: todas las tarjetas abren su detalle.** Además del Resumen y En vivo, ahora también las tarjetas de:

- **Actividad en el tiempo** (eventos del día, promedio por minuto, hechos por bots, reversiones): gráfica por hora del día elegido, hora más activa y más tranquila, minuto pico, bots frente a humanos. Origen: Cassandra `eventos_por_minuto`.
- **Explorador de eventos** (un tipo de evento por tarjeta): cantidad por wiki en las últimas 24 h y qué significa cada tipo (edit, categorize, log, new). Cálculo: la agregación `$group` de MongoDB.
- **Red de editores** (editores, ediciones, reversiones, colaboración o agradecimientos): qué cuenta cada relación del grafo y la consulta Cypher que lo calcula. Origen: Neo4j (con una sola wiki, Neo4j → MongoDB, porque el DAG precalcula esos totales).

Todos usan `ModalMetrica`, con navegación anterior/siguiente entre las tarjetas de la vista. Las consultas (Cypher, MongoDB) se muestran en letra de código. Commit `feat: open detail modal from every dashboard card`.

**Ajustes en Operaciones CRUD:**

- Se quitó la pastilla amarilla "Estas operaciones escriben en las bases de producción"; la descripción ya pide usar nombres «Demo_».
- El botón de cada operación ocupa todo el ancho del formulario.
- **Prueba del validador:** el botón envía a propósito un evento sin el campo `derived`, y el `$jsonSchema` de la colección `events` lo rechaza sin guardarlo. Antes la interfaz lo mostraba como "CREATE · Operación realizada" en verde, como si se hubiera insertado. Ahora aparece en azul como "El validador rechazó el documento (resultado esperado)", con la explicación, y en el historial con la etiqueta VALIDADOR. Si el validador llegara a aceptar el documento, se muestra como error. El botón quedó separado del botón principal, con una línea que explica qué prueba.

Commit `fix: clarify mongo validator test in crud page`.

---

## Pendientes

- [x] `docker-compose` local con MongoDB, Cassandra, Neo4j y Airflow.
- [x] Extracción por ventanas y limpieza.
- [x] DAG de Airflow programado cada hora.
- [x] Cargas en MongoDB, Cassandra y Neo4j, y cálculo de KPIs.
- [x] Scripts de creación de las bases.
- [x] Operaciones CRUD de cada base (demostración).
- [x] Terraform y `deploy.sh` para GCP, con instrucciones de despliegue (`docs/despliegue.md`).
- [x] Dashboard en Streamlit (5 páginas) con página de CRUD, en local y en la VM.
- [x] Aprobar el mockup y migrar el dashboard a React + shadcn/ui + FastAPI.
- [ ] Capturas del dashboard para el informe (cuando haya varios días de datos).
- [x] Eliminar las reglas de firewall por defecto `default-allow-ssh` y `default-allow-rdp`.
- [ ] Informe PDF y video.
