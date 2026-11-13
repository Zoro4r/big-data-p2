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

### 27. Crear eventos de MongoDB con formulario y editor JSON

Antes, "Crear" en MongoDB solo pedía título, editor y comentario, y el servidor completaba el resto con valores fijos (siempre una edición en enwiki). Un evento real tiene unos 25 campos. El diseño se trabajó en Claude Design (propuestas A, B, C y variantes B2–B6) y se eligió una columna izquierda simple con un editor JSON a la derecha.

**Columna izquierda** (`web/src/components/crear-evento.tsx`):

- Wiki de destino: "Se insertará en enwiki · English Wikipedia". Por defecto sigue el filtro de la cabecera y se puede cambiar ahí mismo. Al cambiarla se ajustan el dominio y los prefijos del título (User: ↔ Usuario:, Category: ↔ Categoría:, File: ↔ Archivo:).
- Tipo de evento: Edición, Página nueva, Categorización u Otros. "Otros" son los eventos `log` de Wikipedia; una segunda elección, "Acción", decide los campos: bloqueo, agradecimiento, traslado de página, subida de archivo u otra acción. Son las acciones que el pipeline convierte en relaciones de Neo4j (BLOQUEO, AGRADECIO, SUBIO).
- Campos de ese tipo (título, editor, tipo de editor, bytes, comentario, categoría y página, usuario bloqueado y duración…). Cada campo lee y escribe el JSON de la derecha, así que formulario y editor siempre coinciden.

Los eventos `external` (cambios de Wikidata) no se ofrecen porque el pipeline los descarta al limpiar.

**Columna derecha:** editor JSON con números de línea y colores, botón "Restablecer", el bloque `derived` que calculará el servidor (en gris, "calculado al insertar") y una barra con el estado: "Cumple el validador de events" o "Falta user…".

**API** (`api/main.py`, `src/wikipipe/crud.py`):

- `POST /api/crud/mongo` recibe el documento completo. `crud.preparar_evento` calcula `derived` con la misma función que usa el pipeline (`clean.derive`), así el documento queda igual a uno real.
- Si faltan campos, no se completan: el documento se envía sin `derived` y el validador `$jsonSchema` lo rechaza. La respuesta lo indica (`rechazado: true` y la lista de campos que faltan) y la página lo muestra en azul con la etiqueta VALIDADOR. Así la prueba del validador se hace borrando un campo en el editor, y se quitaron el botón "Probar el validador" y su ruta `/api/crud/mongo/invalido`.
- `POST /api/crud/mongo/previa` devuelve el `derived` calculado y los campos que faltan, para la vista previa.
- Tras insertar, el `_id` del documento creado pasa a Consultar, Actualizar y Eliminar, y el editor recibe un `_id` nuevo para la siguiente inserción.

Verificación con Playwright en local: edición con bytes cambiados (−100 B), cambio a Otros · bloqueo en eswiki (título "Usuario:Demo_Vandalo"), inserción correcta e inserción sin `user` rechazada por el validador, sin errores de JavaScript. El documento de prueba se borró. Commits `feat: accept full event documents in mongo create` y `feat: add event form and json editor to crud page`.

### 28. Consultar eventos de MongoDB con filtros y ficha del documento

Antes, Consultar pedía un `_id` exacto y mostraba el JSON crudo. Se diseñaron en Claude Design tres opciones (por `_id` con atajos, filtros con lista de resultados, filtros con filtro JSON) y se eligió una combinación: la columna izquierda de la opción de filtros y la derecha de la opción por `_id`.

**Columna izquierda** (`web/src/components/consultar-evento.tsx`):

- Wiki donde buscar (sigue al filtro de la cabecera, se puede cambiar), tipo de evento, periodo (última hora, 24 horas, 7 días, todo), editor (empieza con…), título (contiene…) y "solo documentos de demostración" (`_id` que empieza con «demo-»). Un campo opcional "_id exacto" ignora los demás filtros.
- Botón **Buscar** y, debajo, las coincidencias cuando hay más de una (título, `_id`, tipo y antigüedad), de 10 en 10 con "Ver 10 más". Al entrar a Consultar se busca solo, así aparecen los documentos recién creados.

**Columna derecha:** ficha legible del documento elegido ("Coincidencia 1 de 3", la consulta `find()` ejecutada, título, wiki, tipo, editor, comentario, fecha, bytes, tamaño y espacio de nombres) y el JSON completo con colores. "Actualizar este" y "Eliminar" llevan el `_id` a esas operaciones (no borran directamente).

**API:** `GET /api/crud/mongo/buscar` (`queries.crud_buscar`), sin caché. Usa los índices existentes (`por_wiki_tipo_fecha`, `por_editor`, `por_fecha`): las búsquedas probadas tardan entre 2 y 100 ms sobre ~1.3 millones de documentos. "Ver más" pide los documentos anteriores a la fecha del último mostrado en vez de usar `skip`: con el stream insertando eventos, `skip` repetía documentos (lo detectó la prueba con Playwright).

Verificación con Playwright en local: tres documentos creados y encontrados con "solo demostración", búsqueda real de la última hora con "Ver 10 más" sin repetidos, paso de la ficha a Eliminar, sin errores de JavaScript. Los documentos de prueba se borraron. Commits `feat: add filtered search endpoint for mongo crud` y `feat: search mongo events with filters in crud page`.

**Ajuste:** al entrar a Consultar ya no se busca solo. Con los filtros por defecto la búsqueda automática solía no encontrar nada y mostraba "Sin coincidencias" y un READ que nadie pidió. Ahora la columna derecha dice "Realiza una consulta" hasta que se presiona Buscar, y "Sin coincidencias" aparece solo a la derecha (no repetido en la izquierda). Commit `fix: wait for search before querying in crud page`.

### 29. Actualizar eventos de MongoDB con el formulario y los cambios a la vista

Antes, Actualizar pedía un `_id`, el nombre de un campo y un valor, sin mostrar el documento. Además, el `$set` dejaba `derived` desactualizado: si cambiaban los bytes, `delta_bytes` seguía con el valor viejo. Se diseñó en Claude Design (canvas "Actualizar eventos en MongoDB"); se eligió la opción B3: formulario con los valores actuales en tonos neutros, sin "Se ejecutará" ni el valor anterior repetido en la columna izquierda.

**Columna izquierda** (`web/src/components/actualizar-evento.tsx`): "Documento a actualizar" con `_id` y botón Cargar ("Actualizar este" desde Consultar lo carga solo), una ficha corta del documento y sus campos con los valores actuales: título, editor, tipo de editor, bytes (en ediciones y páginas nuevas) y comentario. Un campo cambiado muestra "· editado" en gris, un borde algo más oscuro y un botón para deshacer dentro del campo. El comentario ocupa el espacio que sobra, así la columna termina a la misma altura que la derecha. El botón dice "Guardar N cambios".

**Columna derecha:** "Cambios a guardar" (campo, antes tachado, después), con los campos de `derived` que se recalculan marcados como "recalculado"; con más de 4 filas aparece scroll y el encabezado queda fijo. Debajo, "Documento después de guardar" con las líneas cambiadas y recalculadas marcadas en gris.

**API:** `PATCH /api/crud/mongo/{id}` recibe `{"cambios": {"ruta.con.punto": valor}}`. `crud.preparar_actualizacion` aplica los cambios a una copia, recalcula `derived` con `clean.derive` y arma un único `update_one` con `$set` (cambios + `derived` que cambió) y `$unset` (derivados que ya no aplican). No deja modificar `_id`, `meta.id` ni `derived` a mano, y rechaza cambios que dejarían el documento incompleto (p. ej. editor vacío). La vista previa del recálculo usa `POST /api/crud/mongo/previa`.

Verificación: con la API, un cambio de bytes y título recalculó `delta_bytes` y `page_key`, y los intentos de cambiar `_id` o dejar el editor vacío se rechazaron. Con Playwright: crear → Consultar → "Actualizar este" → editar tres campos → deshacer uno → guardar 2 cambios, sin errores de JavaScript; las dos columnas terminan a la misma altura. Los documentos de prueba se borraron. Commits `feat: recalculate derived fields on mongo update` y `feat: edit mongo events with a prefilled form in crud page`.

### 30. Eliminar eventos de MongoDB con doble confirmación

Antes, Eliminar borraba directo con solo escribir un `_id`, sin mostrar qué documento era. Se diseñaron en Claude Design (canvas "Eliminar eventos en MongoDB") tres opciones: confirmar escribiendo el `_id`, limpiar varios documentos de demostración, y diálogo de confirmación con "Deshacer". Se eligió combinar la confirmación escrita con el diálogo, sin "Deshacer": borrar no se puede revertir.

**Columna izquierda** (`web/src/components/eliminar-evento.tsx`): "Documento a eliminar" con `_id` y Cargar ("Eliminar" desde Consultar lo carga solo), ficha del documento y el campo "Para confirmar, escribe el _id". El botón rojo "Eliminar documento…" se activa solo cuando el texto coincide y abre un diálogo "¿Eliminar «…»?" con Cancelar y Eliminar.

**Columna derecha:** "Qué pasa al eliminarlo" (MongoDB lo borra con `delete_one`; Cassandra y Neo4j no cambian porque sus datos ya se calcularon) y el documento que se va a eliminar. Después de borrar: "Documento eliminado · deleted_count: 1".

Verificación con Playwright: crear → Consultar → "Eliminar" → el botón está deshabilitado hasta escribir el `_id` → diálogo → eliminar; el documento ya no existe y no hay errores de JavaScript. Commit `feat: confirm mongo deletes by typing the id and in a dialog`.

### 31. Requerimientos del proyecto y cómo los cumplimos

Se diseñaron en Claude Design las mismas mejoras del CRUD para Cassandra y Neo4j (canvas "CRUD de Cassandra y Neo4j"), pero quedaron en pausa: se discutió que Cassandra solo guarda datos calculados por el pipeline y que, si se implementan, las escrituras deberían limitarse a editores «Demo_».

Se creó `docs/requerimientos.md`: recorre cada sección de las instrucciones (fuente de datos, arquitectura multimodelo, Airflow, CRUD, dashboard, KPIs y entregables) y describe cómo la cumple el proyecto, con las cifras de la VM al 7 de noviembre (2,570,895 eventos en MongoDB, ~945 mil nodos y ~2.8 millones de relaciones en Neo4j, 163 corridas del DAG). Marca como pendientes el informe en PDF, las capturas del dashboard y el video. Commit `docs: add project requirements checklist`.

### 32. Sección «Arquitectura» del dashboard

Nueva página **Arquitectura** (grupo "Proyecto" del menú), diseñada en Claude Design (canvas "Sección Arquitectura"). Se compararon una página larga, pestañas y un diagrama clicable, y se eligió el diagrama: cada componente abre un modal con su detalle, con la caja "Capa por lotes" compacta ("DAG de Airflow · cada hora · extraer → validar → cargar → KPIs").

**Diagrama** (`web/src/pages/Arquitectura.tsx`): Wikimedia EventStreams → capa rápida y capa por lotes → MongoDB, Cassandra y Neo4j → API FastAPI → dashboard. Debajo, cuatro cifras en vivo (eventos guardados, ritmo de llegada, corridas del DAG y calidad de la última hora) que abren el modal relacionado. Cada modal tiene navegación anterior/siguiente por los 8 componentes.

**Modales:**

- **Wikimedia EventStreams:** los datos que llegan. Volumen, velocidad, variedad y calidad; origen (fuente, endpoint, SSE, esquema, wikis guardadas, licencia); un evento real de MongoDB con filtro por tipo y "Ver otro"; campos comunes y los 4 tipos con su porcentaje de las últimas 24 h y sus campos extra.
- **Capa rápida:** cómo trabaja el servicio stream, qué escribe y por qué existe junto al DAG (arquitectura Lambda).
- **Capa por lotes:** el flujo de Airflow: qué es un DAG, las 6 tareas dibujadas en orden (con Cassandra y Neo4j en paralelo), qué hace cada una y dónde escribe, idempotencia y las últimas corridas.
- **MongoDB, Cassandra y Neo4j:** qué guarda cada una, por qué ahí y quién escribe. Además: tamaño, validador e índices de `events`; las 7 tablas de Cassandra con su clave primaria; nodos y los 11 tipos de relación de Neo4j con su cantidad.
- **API y Dashboard:** qué bases consulta cada vista y cómo está construido y desplegado.

**API:** `GET /api/arquitectura` (cifras con caché de 60 s; la mezcla de tipos sale de `resumen_por_hora` en Cassandra y, si no hay horas recientes, de MongoDB) y `GET /api/arquitectura/ejemplo?tipo=` (un evento reciente al azar).

Verificación con Playwright: recorrido de los 8 modales con anterior/siguiente, en modo claro y oscuro, sin errores de JavaScript. Commits `feat: add architecture endpoints` y `feat: add architecture page with clickable diagram`.

**Ajuste: todo el contenido de la justificación del dataset en la página.** Se comparó el modal de Wikimedia EventStreams con `docs/justificacion-dataset.md` y se agregó lo que faltaba:

- El problema que planteamos (monitorear la actividad colaborativa en Wikipedia).
- En el origen: cobertura (todos los proyectos e idiomas), autenticación (solo `User-Agent`), datos pasados con `?since=`, licencia completa y el enlace a la documentación en Wikitech. El esquema se indica como público y versionado (`1.0.x`).
- Campos comunes `id` y `server_name`, y los campos extra completos de cada tipo (`patrolled`, `notify_url`, `log_id`, `log_params` de estructura libre).
- La captura de prueba del 31 de octubre (134 s, 4,915 eventos, ~37/s) con su tabla de métricas y el gráfico de eventos por wiki.
- La tabla de cumplimiento de los requisitos del dataset.
- En el modal de Neo4j: de qué parte del evento sale cada relación, el esquema del grafo y el ejemplo real de reversiones.

Las tres imágenes de `docs/img/` se copiaron a `web/public/img/` (no a `/arquitectura/`, que chocaría con la ruta de la página al recargarla). Commit `feat: show dataset justification in architecture modals`.

`docs/requerimientos.md` se actualizó para reflejar la página Arquitectura: la documentación del dataset (sección 1) y la justificación de cada base (sección 2) ahora también están en sus modales, y la tabla de material para el informe la incluye como fuente. Commit `docs: reflect architecture page in requirements`.

En `docs/requerimientos.md`, cada referencia a otro archivo indica ahora su sección o líneas y lleva un enlace directo: encabezados de los `.md`, líneas exactas del código (`#L…`), la página del PDF de instrucciones (`#page=…`) y las páginas del dashboard desplegado. Un script verificó los 104 enlaces locales (archivos, anclas y líneas). Commit `docs: link file references in requirements`.

### 33. CRUD de Cassandra y Neo4j con la interfaz rediseñada

Se implementó lo diseñado en Claude Design (canvas "CRUD de Cassandra y Neo4j"), con los mismos patrones que MongoDB: columna izquierda alineada con las pestañas, coincidencias debajo de "Buscar", "· editado" con deshacer, tabla de cambios, y confirmación escribiendo el nombre más un diálogo, sin deshacer.

**Regla de datos de demostración:** Cassandra y Neo4j guardan datos que calcula el pipeline. Consultar funciona con cualquier editor real, pero crear, actualizar y eliminar solo se permiten sobre nombres «Demo_…». La API lo impide con un 403 (`solo_demo` en `api/main.py`) y la interfaz lo avisa y desactiva el botón.

**Cassandra** (`web/src/components/cassandra-crud.tsx`, tabla `actividad_editor`):

- **Crear:** wiki de destino, clave (editor como partición; fecha y hora como agrupación) y las seis métricas. A la derecha, la fila a insertar; si la clave ya existe, un aviso explica que el INSERT la reemplaza.
- **Consultar:** por partición (editor), con fecha y hora opcionales; ficha con las métricas y la fila completa.
- **Actualizar:** carga por clave completa; `UPDATE` solo de las columnas cambiadas (`cassandra_actualizar_columnas`).
- **Eliminar:** una fila o toda la partición, con la lista de lo que se borra.

**Neo4j** (`web/src/components/neo4j-crud.tsx`):

- **Crear:** nodo `:Editor` o relación (`REVIRTIO`, `MENSAJE_A`, `AGRADECIO`, `BLOQUEO` con `veces` y `wiki`). Si un editor no existe se crea con la relación. A la derecha, el dibujo de cómo queda en el grafo.
- **Consultar:** por el comienzo del nombre, con el índice de `user`. Ficha con mini grafo del editor, relaciones y propiedades; las fechas de Neo4j se pasan a texto.
- **Actualizar:** propiedades del nodo con "+ Agregar propiedad"; `user` no se cambia.
- **Eliminar:** `DETACH DELETE` de un nodo (lista antes sus relaciones) o `DELETE` de una relación elegida.

**API:** nuevas rutas `GET /api/crud/cassandra/fila`, `GET /api/crud/neo4j/editores`; `POST`, `PATCH` y `DELETE` de ambas bases reescritos (fila completa, cambios por columna o propiedad, borrado de partición). Piezas compartidas de la interfaz en `web/src/components/crud-comun.tsx`.

Verificación: con la API, los intentos de escribir sobre un editor real devolvieron 403. Con Playwright, recorrido completo de las cuatro operaciones en las dos bases (insertar, consultar, actualizar y eliminar la partición en Cassandra; crear relación, consultar, agregar propiedad, eliminar la relación y los dos nodos en Neo4j) y consulta de un editor real en solo lectura, sin errores de JavaScript ni datos de prueba al final. Commits `feat: add cassandra and neo4j crud endpoints with demo-only writes` y `feat: redesign cassandra and neo4j crud`.

### 34. Levantar el proyecto en local para pruebas del equipo

El despliegue oficial sigue siendo la VM de GCP. Para que cada integrante pueda probar en su computadora sin tocar la nube se agregaron:

- **`local.sh`**: `./local.sh` crea el `.env` con contraseñas al azar (en Linux pone el UID en `AIRFLOW_UID`), levanta todo con Docker Compose, espera al dashboard y a Airflow, activa el DAG y muestra direcciones y contraseñas. También tiene `estado`, `detener` (conserva los datos) y `borrar` (empezar de cero).
- **Guía `docs/local.md`**: requisitos, el comando, todas las variables del `.env` (cuáles conviene cambiar y cuáles solo si hace falta), qué ver en cada página, comandos de prueba, problemas comunes y diferencias con la VM. El README apunta a ella.
- **`.env.example`** con las variables opcionales y **`.gitattributes`** para que los `.sh` no se rompan al clonar en Windows.

**Prueba desde un clon limpio** del repositorio, con el entorno local del usuario detenido para liberar puertos:

- **Primer intento:** el script funcionó, pero con 4 GB para Docker el proyecto completo no entraba. Docker mató a Neo4j por memoria, Airflow se congeló hasta 5 minutos y `cargar_cassandra` y `cargar_neo4j` fallaron.
- **Corrección, el modo liviano:** la memoria de Cassandra y el paralelismo de Airflow pasaron a ser configurables (`CASSANDRA_HEAP`, `CASSANDRA_HEAP_NEW`, `AIRFLOW_PARALLELISM`), con los mismos valores por defecto que usa la VM. Con menos de 6 GB para Docker, `./local.sh` agrega al `.env` valores más bajos (Cassandra 384M, Neo4j 384m/128m, 2 tareas a la vez).
- **Segundo intento**, desde cero: las 6 tareas del DAG en `success`, el dashboard con datos y la demo CRUD por consola funcionando.
- **Al terminar** se borró todo lo de la prueba (contenedores, volúmenes, red, imágenes y la carpeta clonada) y se volvió a levantar el entorno local del usuario como estaba.

**Hallazgo: corte prematuro de `extraer` en horas procesadas tarde.** `extract_window` deja de leer al recibir 100 eventos posteriores al final de la hora. Con `?since=`, el stream entrega mezclados eventos de la hora pedida y eventos actuales: se comprobó que incluso el centro de datos `eqiad` mezcla ambos. Si la hora se procesa bastante después de terminada, esos 100 llegan en segundos y la extracción corta: en la prueba, 2 eventos en vez de miles. En la VM no ocurre (245 corridas, todas con más de 5,000 eventos, mediana 15,163) porque el DAG corre al cumplirse cada hora. Afecta a backfills y a la primera corrida local. Se corrigió en la entrada 35. Commits `feat: add local.sh to run the project locally`, `feat: add light memory mode for local runs` y `docs: add local setup guide`.

### 35. Arreglo del corte de `extraer` en horas procesadas tarde

**Causa:** con `?since=`, el stream intercala los dos centros de datos de Wikimedia (prefijo `codfw` o `eqiad` en `meta.topic`). Cada uno llega en orden de tiempo, pero a distinto ritmo. En una muestra de la hora 2026-11-10 15:00 procesada horas después, `eqiad` (poco volumen) llegó primero y recorrió todas las horas hasta el presente, mientras `codfw` (el principal, 1,791 de los primeros 3,000 eventos) seguía entregando la hora pedida. Contar eventos posteriores, en total o por centro, cortaba antes de que `codfw` apareciera.

**Arreglo** en [`extract_window`](../src/wikipipe/extract.py#L115-L133): solo se corta cuando se cumplen dos señales a la vez.

1. Cada centro de datos visto lleva 100 eventos posteriores seguidos.
2. Hace 30 s que no llega ningún evento de la hora pedida (parámetro `quiet_seconds`).

**Validación local:**

| Hora | Antes | Después | Referencia |
|---|---|---|---|
| 2026-11-10 15:00, procesada ~10 h después | 2 eventos | 11,342 eventos en 115 s | VM: 11,342 |
| 2026-11-11 01:00, procesada al terminar | — | 17,772 eventos en 317 s | — |

Esto arregla los backfills, los `trigger` con fecha pasada y la primera corrida local. Se quitó la «limitación conocida» de [`docs/local.md`](local.md#5-hacer-pruebas), sección 5. Commit `fix: stop extraction per datacenter when replaying past hours`.

### 36. Orden de las tarjetas del Resumen

Las 8 tarjetas de KPIs estaban sin un orden claro. Primero se ordenaron por filas, y luego, a pedido del usuario, **por columnas**: cada columna es un tema, con el dato general arriba y uno más específico abajo ([`TARJETAS` en `Resumen.tsx`](../web/src/pages/Resumen.tsx#L22-L35)).

| Volumen | Contenido | Editores | Calidad |
|---|---|---|---|
| Eventos acumulados | Volumen neto de contenido | Tasa de automatización | Calidad de datos |
| Eventos procesados | Tasa de creación | Actividad por editor humano | Tasa de reversión |

Las tarjetas se listan columna por columna, así en pantallas angostas las dos de cada tema quedan seguidas. En pantallas anchas, una clase `xl:order-N` en cada tarjeta las ubica en la grilla de 4 columnas. El primer intento, llenar la grilla por columnas con `grid-flow-col`, encimaba las tarjetas, porque cada tarjeta ocupa 3 filas de subgrid.

Commits `refactor: order summary kpi cards from general to specific` `refactor: group summary kpi cards by column` y `fix: place summary kpi cards with order classes`.

### 37. Un solo gráfico de evolución por hora en el Resumen

«Ritmo de ediciones» mostraba eventos del streaming cada 10 minutos, solo del día, y no coincidía con las tarjetas, que vienen del DAG. Abajo había además otro gráfico, «Evolución de un KPI». Los dos se reemplazaron por uno solo, **«Evolución por hora»**, ubicado debajo de las tarjetas ([`Resumen.tsx`](../web/src/pages/Resumen.tsx)).

- **Datos:** la serie del KPI que calcula el DAG en Cassandra (`kpis` / `kpis_por_wiki`), una barra por hora de las últimas 72 procesadas.
- **Desplegable** para elegir el KPI; empieza en «Eventos procesados». Muestra solo los 8 KPIs de las tarjetas. «Crecimiento de actividad» se quitó porque es la variación de «Eventos procesados», que ya aparece al pasar el mouse. Las opciones siguen el orden de las tarjetas, columna por columna: Eventos acumulados, Eventos procesados, Volumen neto, Tasa de creación, Tasa de automatización, Actividad por editor humano, Calidad de datos y Tasa de reversión.
- Las barras usan el color de la wiki elegida. Al principio, «Eventos procesados» separaba humanos y bots; el usuario pidió quitarlo.
- **Última hora:** su barra va resaltada.
- **Al pasar el mouse:** valor y cambio frente a la hora anterior.

El ritmo cada 10 minutos sigue en «En vivo» y «Actividad en el tiempo». Commits `feat: replace summary charts with hourly kpi evolution` y `fix: draw stacked bars in summary evolution chart`. El segundo corrige que las barras apiladas no se dibujaran, porque Recharts no lee las barras dentro de un fragmento.

### 38. Horas del dashboard en UTC−5

A pedido del usuario, el dashboard muestra todas las horas en **UTC−5** (hora de Perú, sin horario de verano), con la etiqueta «UTC−5». **Lo guardado sigue en UTC:** MongoDB, Cassandra, Neo4j, el DAG y las ventanas de Airflow no cambian.

- **Formato** ([`lib/format.ts`](../web/src/lib/format.ts)): `horaLocal` reemplaza a `horaUTC`. Agrega `aLocal`, `horaDeCelda` (para celdas guardadas como fecha + hora UTC) y la constante `ZONA`. `ejeDia` marca la medianoche en UTC−5.
- **Etiquetas:** cabecera, Resumen, En vivo, Actividad, Explorador, Red, Arquitectura (incluidas las notas de la captura del 31 oct: 16:02 UTC pasa a 11:02 UTC−5), modales y CRUD de MongoDB y Neo4j.
- **Días en UTC−5** ([`/api/actividad` y `/api/serie10`](../api/main.py#L108-L145)): un día va de 00:00 a 23:59 UTC−5. La API lee las dos fechas UTC que lo cubren (`fechas_utc`), se queda con las filas de ese día y devuelve la hora en UTC−5 (`a_zona` en [`queries.py`](../api/queries.py#L70-L84)). `fechas_con_datos` también devuelve días en UTC−5.
- **Excepción, el CRUD de Cassandra:** sus campos `fecha` y `hora` son la clave real guardada, así que siguen en UTC con la etiqueta «(UTC)».

Commits `feat: serve activity days in utc-5` y `feat: show dashboard times in utc-5`.

### 39. Regresión del arreglo de `extraer`: horas perdidas el 11 nov y nueva regla de corte

**Problema.** La regla de la entrada 35 exigía 30 s sin recibir eventos de la hora pedida. En vivo siguen llegando eventos atrasados de esa hora (por ejemplo, categorizaciones encoladas), y cada uno reiniciaba el contador, así que la extracción casi nunca cortaba.
- `extraer` pasó de unos 2 min a 14 min (861 s en la hora 05:00 UTC).
- Desde las 07:00 UTC superó el límite de 30 min de la tarea: 3 intentos fallidos por hora.
- Con `max_active_runs=1` y `catchup=False`, Airflow se saltó horas.
- Resultado en la VM, el 11 nov: fallaron 07, 09, 12 y 15 UTC, y 08 y 14 no se intentaron.

**Contexto:** EventStreams solo acepta `since` («desde»), no «hasta». El extractor tiene que deducir cuándo la hora ya llegó completa. Los eventos de otras horas solo se miran para decidirlo; nunca se guardan.

**Nueva regla** ([`extract_window`](../src/wikipipe/extract.py)): se esperan los dos centros de datos de Wikimedia (`codfw`, `eqiad`). Un centro terminó la hora cuando:
- ya envió 100 eventos posteriores al fin de la hora más el margen, o
- lleva 30 s sin enviar ningún evento (está inactivo; uno con eventos pendientes los envía sin pausa).

Se corta cuando terminaron los dos. Al medirlo, en vivo solo emitía `codfw`; con la versión intermedia, que esperaba 100 eventos de `eqiad`, una hora reciente no terminaba nunca.

**Validación local:**

| Hora | Eventos | Tiempo | Referencia |
|---|---|---|---|
| 10 nov 15:00 UTC, procesada tarde | 11,342 | 82 s | VM: 11,342 |
| 12 nov 01:00 UTC, reciente | 19,075 | 70 s | — |

Commit `fix: stop extraction when every datacenter is done or idle`. Las horas perdidas se recuperaron en la entrada 40.

### 40. Recuperación de las horas perdidas e informe técnico

**Recuperación.** Se recuperaron las 6 horas perdidas del 11 de noviembre en la VM, ya con la regla de corte nueva:
- las corridas fallidas de 07, 09, 12 y 15 UTC se reiniciaron con `airflow tasks clear --only-failed`;
- las de 08 y 14 UTC, que no se habían intentado, se corrieron con `airflow dags backfill`.

La corrida de las 00:00 UTC del 12 de noviembre había empezado su extracción 4 minutos antes del despliegue, con el código viejo. Se reinició: extrajo su hora en unos 36 s y terminó las 6 tareas en unos 2 min. Las 6 horas recuperadas terminaron en `success` antes de las 03:00 UTC.

**Informe técnico.** Se redactó el informe como documento compartible (Claude Docs, exportable a PDF), con las secciones que piden las instrucciones:
- introducción y problema, dataset, arquitectura (diagrama), pipeline de Airflow (diagrama), modelos de las tres bases, CRUD, KPIs y dashboard, con capturas de las 7 vistas tomadas de la VM;
- además: despliegue, resultados (gráfico de eventos por hora de las últimas 72 horas, con la ráfaga de bots del 9 de noviembre), problemas y soluciones, y conclusiones.

Las cifras son de la VM al 12 de noviembre de 2026.

### 41. Informe técnico: cada componente justificado por una necesidad

A pedido del usuario, el informe se reescribió para entenderse solo, sin conocer el proyecto. Se agregó:

- **Contexto** de Wikipedia (bots, patrulleros, reversiones).
- **Sección de necesidades:** tres públicos y siete necesidades, N1 a N7.
- **El «por qué» de cada parte**, con su necesidad y la alternativa descartada: dataset, componentes, tareas del DAG, bases, CRUD, vistas y despliegue.
- **KPIs por necesidad**, con cómo leer cada uno.
- **Recorrido numerado de un cambio** (pasos 1 a 9), en el texto y en un diagrama redibujado con los dos caminos en colores distintos.
- **Resultados** ligados a cada necesidad.
- **Conclusiones** que verifican cada necesidad.
- **Glosario.**

### 42. Informe técnico: portada, necesidades por público y dataset detallado

Cambios hechos a partir de las observaciones del usuario:

- **Portada:** lista de los cuatro integrantes.
- **Necesidades reordenadas por público.** El conflicto pasó de N5 a N2. Volumen, bots y crecimiento corrieron un número (N3, N4 y N5). Se actualizaron todas las referencias del informe.
- **Sección 2 reescrita.** Cada público tiene:
  - quiénes son;
  - el problema que tienen, con casos reales: Seigenthaler (2005), Colbert (2006), ClueBot NG (2011), la caída de editores (Halfaker 2013), Lsjbot y Orangemoody (2015);
  - su tabla de necesidades, con una columna «Para qué la necesitan».
- **El público «Investigadores» pasa a ser «Comunidad y Fundación Wikimedia»:** quienes miden la salud del proyecto.
- **Sección 3:**
  - qué trae el stream: uno solo para todas las wikis, filtrado por el campo `wiki`;
  - cuánta historia guarda: unos 9 días y medio, comprobado el 12 nov 2026 pidiendo eventos desde 10, 15 y 31 días antes;
  - por qué el dataset es semiestructurado;
  - los 4 requisitos del curso;
  - los 16 campos comunes en viñetas;
  - una subsección por tipo de evento con sus campos extra y conteos de 24 h actualizados.
- **«Características» del dataset rehecha** con cifras de todo lo recolectado: 293 horas, del 31 oct 14:00 al 12 nov 18:59 UTC−5, agregadas en MongoDB de la VM.
  - **Agregado:** promedio por hora con mínimo y máximo; reparto enwiki/eswiki, bots/personas y por tipo.
  - **Quitado:** la velocidad de captura, que corresponde a la extracción; «87 veces el mínimo»; y «4 wikis concentraban el 70 %».
- **Sección 2:** se quitó la tabla resumen de públicos. La introducción ahora nombra a los tres públicos y qué busca cada uno.
- **Cuatro públicos en lugar de tres:** «Comunidad y Fundación Wikimedia» se separó en dos.
  - **Fundación Wikimedia (N3, N4):** casos de la caída de editores y de la Wikipedia en cebuano.
  - **Comunidad (N5, N6):** los editores, incluidos quienes crean o siguen páginas (en Wikipedia nadie es dueño de una página) y quienes organizan editatones; caso Orangemoody.
  - **Renumeración:** la red de editores pasó de N6 a N5 y el crecimiento de N5 a N6. Se actualizaron las referencias y el orden de las secciones 8, 11 y 13.
- **Cifras actualizadas:**
  - Secciones 1 y 2: el promedio por hora pasó a 16,354 (31 oct–12 nov), el mismo de «Características».
  - Sección 1: el total pasó a 4.79 millones de cambios.
- **Portada:** se quitó la mención a la cuenta que creó el documento; queda solo la fecha.
- **Sección 6 y diagrama de arquitectura:** cifras del 12 nov 20:03 UTC−5, leídas de `/api/arquitectura`.
  - MongoDB: 4.82 millones de documentos, 7.1 GB sin comprimir y 1.7 GB en disco.
  - Neo4j: 1.66 millones de nodos.
- **«Características»:** el reparto por wiki, por bots y personas y por tipo pasó a ser subviñetas de «Volumen».

### 43. El proceso horario lee la hora de MongoDB; EventStreams queda de respaldo

**Motivo.** Deducir el fin de la hora en EventStreams, que no tiene parámetro «hasta», causó dos fallas en una semana (entradas 39 y 40). El servicio stream ya guarda cada evento en MongoDB, así que la hora puede leerse de ahí cuando está completa. A propuesta del usuario.

**Cambios en el código** (commit `feat: read hourly batch from mongodb when the stream covered the hour`):

- [`src/wikipipe/fuente.py`](../src/wikipipe/fuente.py) (nuevo) decide la fuente con `decidir`:
  - **MongoDB:** si un tramo de cobertura del servicio stream cubre la hora y llega 5 min más allá de su fin (`MARGEN`).
  - **Esperar:** si el tramo va llegando, hasta 10 min (`ESPERA_MAX`).
  - **EventStreams:** si no hay tramo, o si el tramo se detuvo; usa `extract_window` con la regla de corte de siempre.
  - Las dos fuentes escriben el mismo archivo crudo, así que las tareas siguientes no cambian. Solo entran eventos con `inicio <= meta.dt < fin`.
- [`src/wikipipe/streaming.py`](../src/wikipipe/streaming.py), docstring del módulo y funciones `rechazo`, `rango_en_vivo` y `guardar`:
  - registra los tramos en `stream_cobertura`. Un reinicio que retoma con `Last-Event-ID` continúa el tramo; uno que arranca en vivo abre otro. `fin` avanza solo con eventos de menos de 60 s de retraso;
  - guarda `received_at` en cada evento;
  - guarda en `events_rejected` los eventos de enwiki/eswiki que no pasan la validación, con `ventana_dt`, para que la calidad se mida igual.
- [`src/wikipipe/mongo.py`](../src/wikipipe/mongo.py), `load_events`: los rechazados que carga el DAG también guardan `ventana_dt`.
- [`db/mongo/schema.json`](../db/mongo/schema.json): índice `por_fecha` en `events_rejected` y colección `stream_cobertura`.
- [`airflow/dags/wikipedia_pipeline.py`](../airflow/dags/wikipedia_pipeline.py), tarea `extraer`: usa `fuente.extraer_hora`.
- Pruebas: [`tests/test_fuente.py`](../tests/test_fuente.py) (nuevo) y [`tests/test_streaming.py`](../tests/test_streaming.py). Pasan las 16 pruebas.

**Despliegue y validación (12 nov, UTC−5):**

- Desplegado a las 20:27, entre dos ejecuciones horarias. El servicio stream retomó desde el marcador y abrió el primer tramo de cobertura a las 20:28.
- **Ventana 20:29–20:34:** MongoDB dio 1,598 eventos en 0.2 s; EventStreams dio los mismos 1,598 identificadores en 48.9 s. Diferencias: 0.
- **Ventana de las 19:00,** anterior al registro de cobertura: usó el respaldo EventStreams, como se esperaba.
- **Retraso medido en vivo** (60 s de muestra): mediana de 0 s y máximo de 1.3 s.

**Documentación:**

- [README.md](../README.md), sección de arquitectura: viñeta «Capa por lotes».
- Informe:
  - sección 4: paso 6, el párrafo «El camino por lotes corrige al rápido» y el diagrama;
  - sección 5: tarea `extraer`, plazo de unos 9 días y el nuevo párrafo «De dónde lee la extracción»;
  - sección 12: fila nueva en la tabla de problemas.

**Cambios relacionados:**

- **Reconexión del servicio stream** (commit `fix: reset stream reconnect delay after each successful connection`, [`streaming.py`](../src/wikipipe/streaming.py), métodos `leer` y `correr`):
  - Wikimedia corta la conexión cada tanto, y cada corte termina en una excepción. Por eso la espera antes de reconectar nunca volvía a 1 s.
  - Llevaba 88 reconexiones de 60 s cada una, y la vista «En vivo» quedaba un minuto atrasada en cada corte. No se perdían datos, porque retoma con `Last-Event-ID`.
  - Ahora la espera vuelve a 1 s apenas se conecta.
- **Fuente en el dashboard** (commit `feat: show batch source in architecture page`):
  - [`db/cassandra/schema.cql`](../db/cassandra/schema.cql): nueva columna `fuente` en `ejecuciones`. [`cassandra_store.ensure_schema`](../src/wikipipe/cassandra_store.py) la agrega con `ALTER TABLE` si la tabla ya existía.
  - `write_run` guarda la fuente.
  - [`Arquitectura.tsx`](../web/src/pages/Arquitectura.tsx):
    - la tabla de corridas tiene una columna «Fuente»; las corridas anteriores, sin registro, figuran como EventStreams;
    - los textos de «Datos pasados» y de la tarea `extraer` describen el nuevo comportamiento.
- **Diagrama de arquitectura del informe:**
  - la flecha entre MongoDB y el proceso horario tiene dos puntas y la etiqueta «lee y carga»;
  - la flecha de EventStreams al proceso horario es punteada, con la etiqueta «respaldo si hubo cortes»;
  - el texto de la caja de Airflow volvió a ser corto.
- **`cargar_mongo` no escribe si la hora vino de MongoDB** (commit `feat: skip mongo load when the hour was read from mongo`, [`wikipedia_pipeline.py`](../airflow/dags/wikipedia_pipeline.py), tarea `cargar_mongo`):
  - antes reescribía los mismos ~16,000 documentos por hora sin cambiarlos; con el respaldo de EventStreams sigue cargando, porque agrega lo que el servicio stream no guardó;
  - la tarea registra `omitida`;
  - el texto de la tarea en [`Arquitectura.tsx`](../web/src/pages/Arquitectura.tsx) y el informe (sección 4, paso 7; sección 5, tabla de tareas) lo explican;
  - en el diagrama, la flecha entre MongoDB y el proceso horario va de MongoDB al proceso, con la etiqueta «lee la hora».
- **Primera ejecución con el cambio** (hora 20:00–21:00 UTC−5): usó el respaldo EventStreams, con 19,017 eventos en 122 s, porque el registro de cobertura empezó a las 20:28. Desde la hora 21:00–22:00 la cobertura es completa.
- **Despliegues** a las 21:05 y 21:12 (UTC−5), entre ejecuciones horarias.
- **Primera hora leída de MongoDB** (hora 21:00–22:00 UTC−5): 20,770 eventos en 3.2 s, frente a 122 s de la hora anterior desde EventStreams. Calidad del 100 %; `cargar_mongo` registró `omitida`.

### 45. Dashboard: cada vista responde a las necesidades del informe

Revisión de las 7 vistas contra N1 a N7, a pedido del usuario. Cambios aprobados:

- **Red de editores** (commit `feat: show 24h conflict and community cards and most connected editors in network view`):
  - **Tarjetas:** las 4 de totales del grafo, que eran inventario, se cambiaron por 4 de las últimas 24 horas: reversiones (desde Cassandra), editores revertidos por 2 o más editores, editores agradecidos y editores humanos conectados (desde Neo4j). Funciones [`tarjetas_red`](../api/queries.py) en la API.
  - **Ranking nuevo «Editores más conectados» (N5):** humanos activos en 24 h con más relaciones COEDITA. Función [`ranking_conectados`](../api/queries.py).
  - **Rendimiento:** contar reversiones en MongoDB tardaba 60 s, así que se leen de `resumen_por_hora`. Las tarjetas responden en 0.5 a 1.7 s.
- **En vivo** (commit `feat: add large deletions filter to live view`): filtro «Borrados grandes», con cambios que quitan más de 1,000 bytes (N1, N2). La API trae aparte los de los últimos 30 minutos (`vivo`, campo `borrados`), porque entre los últimos 100 eventos casi nunca hay uno.
- **Explorador** (commit `refactor: remove event type chart from explorer`): se quitó el gráfico «Eventos por tipo y wiki», que no ayudaba a revisar un caso.
- **Informe, sección 9:** se actualizó la tabla de vistas (En vivo, Explorador, Red, Arquitectura), el texto de las capturas de En vivo y Red, y las capturas de En vivo, Explorador y Red, tomadas del despliegue.
- **Observación:** en eswiki, «Automoderador», la herramienta de moderación automática, figura como editor registrado porque no tiene la marca de bot ni «bot» en el nombre. Por eso aparece entre los más conectados y los patrulleros.
- **Corrección aprobada** (commit `fix: classify automoderator accounts as bots`):
  - [`clean.user_type`](../src/wikipipe/clean.py) reconoce como bot las cuentas de `KNOWN_BOTS`: Automoderador y Automoderator. Hay una prueba nueva en [`tests/test_clean.py`](../tests/test_clean.py); pasan 16.
  - Desplegado a las 22:40 (UTC−5).
  - Datos existentes corregidos en la VM:
    - MongoDB: 1,320 eventos con `derived.user_type = bot`;
    - Neo4j: el nodo pasó a `tipo = bot`, y se borraron sus 1,397 relaciones COEDITA, porque COEDITA solo une humanos;
    - Cassandra: 225 filas de `actividad_editor` con `tipo_editor = bot`.
  - **No se recalcularon** los agregados por hora ya escritos (`resumen_por_hora`, KPIs de horas pasadas). La tasa de automatización de eswiki de esas horas queda apenas más baja: 1,320 eventos en 12 días. Las horas nuevas ya salen bien.
  - El usuario decidió no reprocesar: la regla rige desde ahora.

### 46. Gráficos unificados, términos corregidos y nueva medida de «Página más disputada»

Revisión pedida por el usuario: la correctitud de los términos y la variedad de gráficos.

- **«Página más disputada» mide reversiones** (opción a, aprobada; commit `feat: measure disputed pages by reversions received`):
  - **Antes** contaba editores distintos en toda la historia, así que ganaban «Sandbox» o «Teahouse», sin conflicto.
  - **Ahora** es la página con más reversiones recibidas en la hora.
  - **Dónde se calcula:**
    - tabla nueva `paginas_disputadas_por_hora` en [schema.cql](../db/cassandra/schema.cql), que llena `cassandra_store.load_window` (top 20 por hora);
    - KPI en `kpis._pagina_disputada`, que pasó de Neo4j a Cassandra;
    - lista de la vista Red en `api/queries.paginas_disputadas` (últimas 24 h).
  - **Relleno:** las últimas 24 horas, unos 2 s por hora. Ejemplos reales: «Voĺha Karač» con 25 reversiones en una hora y «The Atheist Experience» con 10.
- **Gráficos y colores** (commit `refactor: use bar charts and separate color palettes across views`):
  - **Gráficos:** todo lo temporal va en barras verticales, apiladas si hay desglose; los rankings, en barras horizontales. Cambiaron En vivo (áreas → barras por wiki), Actividad por minuto (líneas → barras humanos/bots) y la serie del detalle de cada tarjeta (línea → barras).
  - **Paletas separadas:** las wikis van en azul y naranja; los tipos de editor, en gris (registrado), violeta (temporal o IP) y verde (bot).
- **Términos:**
  - «Pulso por minuto» → «Eventos por minuto»;
  - «Pulso de…» → «Actividad de…»;
  - «Últimas ediciones» → «Últimos eventos»;
  - «Páginas más editadas» → «Páginas con más editores»;
  - «Verás sus ediciones» → «sus eventos»;
  - En vivo: «guarda cada edición» → «cada evento» (commit `fix: use event instead of edit in live view description`).
- **Informe:**
  - KPI de la sección 8;
  - secciones 4 (Cassandra), 5 (tareas 4 y 6), 6 (tablas y la viñeta de Neo4j, que ahora es «¿A quién revierten más?») y 9 (tabla de vistas y textos de las capturas);
  - un párrafo nuevo, «Cómo leer los gráficos»;
  - capturas nuevas de Resumen, En vivo, Actividad y Red.
- **Docs del repo:** [justificacion-dataset.md](justificacion-dataset.md) y [requerimientos.md](requerimientos.md) usan la nueva definición.
- **Informe, sección 7 (CRUD), detalle por base:** a pedido del usuario, antes de la tabla resumen, que pasó a llamarse «Resumen de las operaciones», hay una subsección por base: MongoDB (`events`), Cassandra (`actividad_editor`) y Neo4j (grafo de editores).
  - Cada una explica qué hace Crear, Consultar, Actualizar y Eliminar en la página, según [Crud.tsx](../web/src/pages/Crud.tsx) y sus componentes.
  - Lleva 4 capturas del dashboard desplegado, con su pie: crear y consultar en MongoDB, y consultar en Cassandra y en Neo4j con «ClueBot NG».
  - Las capturas solo leen datos: no se escribió nada en las bases.
  - Luego, a pedido del usuario, se agregaron capturas de las 4 operaciones en cada base: 12 en total, con crear, consultar, actualizar y eliminar ordenados.
    - Para Actualizar y Eliminar se usaron registros de demostración, recorridos con Playwright sobre el dashboard desplegado:
      - MongoDB: el documento `demo-crud-1794545280582`;
      - Cassandra: la fila de `Demo_Editor`;
      - Neo4j: la relación `Demo_Patrullero` → `Demo_Vandalo`.
    - Los tres se crearon, se actualizaron y se eliminaron en la misma sesión, a las 23:48–23:50 (UTC−5), así que las bases quedaron como estaban.
    - En Neo4j también se borró `Demo_Vandalo`, y los dos nodos «Demo_» que ya existían de pruebas anteriores.

### 47. Página CRUD: formularios vacíos, datos de prueba y columnas de igual altura

Pedidos del usuario sobre [Crud.tsx](../web/src/pages/Crud.tsx):

- **Subtítulos:** se quitó «insert_one · find · update_one ($set) · delete_one» en MongoDB y la lista de operaciones en Neo4j, que conserva solo la nota sobre «Demo_». El de Cassandra explica la clave y se mantiene.
- **Formularios vacíos al entrar** (commit `feat: start crud forms empty and add test data button`):
  - MongoDB: la plantilla del documento deja vacíos título, editor, comentario, bytes y parámetros (`plantilla(…, prueba=false)` en [crear-evento.tsx](../web/src/components/crear-evento.tsx)), y el `_id` de Actualizar y Eliminar empieza vacío;
  - Cassandra y Neo4j: editor, métricas, relación y búsqueda empiezan vacíos.
- **Botón «Completar con datos de prueba»** (`BotonPrueba` en [crud-comun.tsx](../web/src/components/crud-comun.tsx)), en cada operación de las tres bases:
  - **Crear:** llena el formulario con datos «Demo_».
  - **Consultar:** busca los datos de demostración.
  - **Actualizar y Eliminar:** cargan el registro de demostración más reciente; si no existe, avisan que primero hay que crearlo.
- **Altura de las columnas** (commits `fix: match crud editor height…`, `fix: match crud right column height…` y `fix: scroll crud match lists…`):
  - en pantallas anchas, la columna derecha mide lo mismo que la izquierda en todas las vistas;
  - si su contenido es más largo, se desplaza por dentro;
  - las listas de coincidencias tienen un alto máximo y se desplazan por dentro, para no estirar la columna izquierda.
- **Capturas del informe:** no se actualizan hasta que el usuario apruebe cómo se ve la interfaz.
- **Informe, sección 7 (CRUD):** a pedido del usuario, la introducción ya no dice «El curso pide demostrarlas…» ni «Para nosotros…». Ahora la escribe el sistema en tono de informe. También «para ver qué va a pasar antes de que pase» pasó a «el resultado previsto antes de ejecutar la operación». En el informe (sección 5, tarea `validar_y_limpiar`) se describe como parte de la regla, sin mencionar reprocesos.

### 44. Informe: componentes explicados uno por uno

A pedido del usuario, en la sección 4 la tabla «Por qué está cada componente» se reemplazó por la subsección «Los componentes»:

- una subsección por componente: EventStreams, servicio stream, Airflow, MongoDB, Cassandra, Neo4j, API, dashboard, y Google Cloud con Docker y Terraform;
- cada una explica «Qué es» y «Para qué sirve», con las necesidades que atiende, igual que se hizo con los públicos;
- se quitó la columna «Alternativa descartada».

En la misma sección se reescribió «Por qué dos caminos»:

- **Camino rápido:**
  - da información al instante (N1);
  - reparte la carga de guardar: unos 4 a 5 cambios por segundo, en lugar de unos 16,000 de golpe cada hora, así que el proceso horario solo lee.
- **Camino por lotes:**
  - da información por hora, sobre periodos cerrados;
  - hace el trabajo pesado una sola vez: red, resúmenes y KPIs;
  - garantiza que los datos estén completos (N7).
- La lista de lo que falta con cada camino por separado se amplió, y se quitó el párrafo «El camino por lotes corrige al rápido», que ya quedaba cubierto.
- A pedido del usuario, esa lista ya no menciona las fallas de la sección 12. Ahora explica qué se pierde en utilidad sin cada camino:
  - **sin el rápido:** hasta 60 minutos de atraso y la carga concentrada al cierre de la hora;
  - **sin el de lotes:** no hay horas cerradas, todo se recalcula con cada cambio y los cortes pasan sin que nadie los note.
- Luego, a pedido del usuario, ese cierre dejó de plantearse como «qué falta» y presenta la importancia de cada camino:
  - **rápido:** la inmediatez;
  - **por lotes:** la confiabilidad.
  - Cada una con sus razones en sub-viñetas.
  - El camino por lotes tiene una razón más: hace posible la red de Neo4j.
- **Sección 5, «Las seis tareas, paso a paso»:** a pedido del usuario, va antes de la tabla, que pasó a llamarse «Resumen de las tareas». Cada tarea explica para qué sirve y qué hace, según el código:
  - `extraer`: fuente, ventana y respaldo en Cloud Storage. Los párrafos «De dónde lee» y «El respaldo» se movieron aquí;
  - `validar_y_limpiar`: los 5 motivos de rechazo de `clean.validate`, la quita de duplicados y los campos de `clean.derive`;
  - `cargar_mongo`: cuándo escribe y cuándo no;
  - `cargar_cassandra`: las 4 tablas de `cassandra_store.load_window`;
  - `cargar_neo4j`: nodos, relaciones y COEDITA, de `neo4j_store.load_window`;
  - `calcular_kpis`: qué KPI sale de qué base, según `kpis.compute`.
  - Se quitó la frase suelta «Las tareas 4 y 5 corren a la vez», que ahora está en la tarea 5.
- **Menciones a la falla del 11 de noviembre:** a pedido del usuario, se quitaron fuera de la sección 12:
  - el párrafo «Esto último nos permitió recuperar seis horas…» (sección 5);
  - la frase sobre las horas recuperadas en el componente Airflow (sección 4);
  - la viñeta «Nos pasó» de los operadores (sección 2);
  - la frase de horas perdidas en «Confianza (N7)» (sección 11);
  - la fila N7 de las conclusiones (sección 13) ahora dice «permite detectar y recuperar una hora incompleta».
  - Sección 6, «Modelos de datos»: reescrita a pedido del usuario, con foco en la utilidad de cada base para las necesidades. El contenido sale de las consultas reales de la API ([`api/queries.py`](../api/queries.py): `vivo`, `resumen_por_hora`, `serie_minuto`, `paginas_top`, `actividad_editor`, `ego_red`, `ranking_revertidos`, `paginas_disputadas`):
    - **Tabla resumen:** sus columnas pasan a ser Base, Qué guarda, Para qué sirve y Necesidades. Cassandra se explica como resúmenes ya calculados para tener los KPIs al instante: 72 filas en lugar de 1.2 millones de cambios.
    - **MongoDB:** se agregó «Para qué sirve», con su uso en N1, N2 y N7.
    - **Cassandra:** «Para qué sirve» y una columna con el uso de cada tabla y su necesidad.
    - **Neo4j:** «Para qué sirve», con tres preguntas que responde el grafo: la historia de un editor (vista «Red de editores», N2), quiénes sostienen la comunidad (COEDITA, N5) y dónde se concentra el conflicto (N2). Se quitó la viñeta «Por qué Neo4j», que ya quedaba cubierta.
    - **Relaciones sin uso:** `CREO`, `SUBIO`, `MOVIDA_A` y `EN_CATEGORIA` no las consulta ningún KPI ni vista. Llevan una nota bajo la tabla de relaciones y una mejora en «Trabajo futuro» (sección 12): medir qué temas crecen (N6) y seguir traslados y archivos subidos.
  - Luego, a pedido del usuario, se quitó también la sección 12, «Problemas encontrados y soluciones», porque los problemas ya están corregidos. Las instrucciones del curso no piden esa sección ([requerimientos.md, tabla del informe](requerimientos.md)). «Conclusiones» pasó a ser la sección 12 y «Glosario» la 13; ninguna referencia del texto apuntaba a la sección quitada. La relación COEDITA y la búsqueda del editor más conectado recorren la red completa ([`neo4j_store.py`](../src/wikipipe/neo4j_store.py), `Q_COEDITA`), y hacerlo a cada instante sería un costo desmedido. Por eso el servicio stream no escribe en Neo4j.

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
- [x] Capturas del dashboard para el informe.
- [x] Eliminar las reglas de firewall por defecto `default-allow-ssh` y `default-allow-rdp`.
- [ ] Informe PDF: borrador listo; falta revisión del equipo y exportarlo.
- [ ] Video.
