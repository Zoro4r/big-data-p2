# Big Data · Proyecto Grupal II · Wikipedia Recent Changes

Pipeline multimodelo que procesa cada hora los cambios de Wikipedia (`enwiki` y `eswiki`) desde el stream público de Wikimedia, los guarda en MongoDB, Cassandra y Neo4j, y calcula KPIs para un dashboard.

- Justificación del dataset: [docs/justificacion-dataset.md](docs/justificacion-dataset.md)
- Registro de lo realizado: [docs/trazabilidad.md](docs/trazabilidad.md)

## Estructura

```
airflow/dags/            DAG de Airflow (wikipedia_recent_changes, cada hora)
airflow/Dockerfile       imagen de Airflow 2.10.5 con los drivers de las 3 bases
src/wikipipe/
  extract.py             extracción de una ventana del stream
  clean.py               validación, limpieza y campos derivados
  mongo.py               carga de eventos en MongoDB (fuente de verdad)
  cassandra_store.py     agregados por hora y minuto en Cassandra
  neo4j_store.py         grafo de editores, páginas, wikis y categorías en Neo4j
  kpis.py                cálculo de los 12 KPIs de cada hora
  streaming.py           capa rápida: lee el stream sin parar y guarda cada evento en segundos
  crud.py                operaciones CRUD de las 3 bases y demo para la exposición
db/
  mongo/schema.json         colecciones, validador e índices de MongoDB
  cassandra/schema.cql      keyspace y tablas de Cassandra
  neo4j/constraints.cypher  restricciones e índices de Neo4j
  create_schemas.py         aplica los tres scripts
api/                     API del dashboard (FastAPI): consultas a las 3 bases y CRUD
web/                     dashboard en React + shadcn/ui + Recharts (servido por nginx)
tests/                   pruebas de las reglas de limpieza
docker-compose.yml       MongoDB, Cassandra, Neo4j, Postgres (Airflow), Airflow, api y web
```

## Arquitectura: capa rápida + capa por lotes (Lambda)

- **Capa rápida (servicio `stream`):** lee el stream de Wikipedia sin parar y cada ~2 s guarda los eventos en MongoDB y los contadores por minuto en Cassandra. El dashboard los muestra en la página "En vivo".
- **Capa por lotes (DAG de Airflow, cada hora):** toma la hora completa de MongoDB si la capa rápida la cubrió sin cortes (si no, la vuelve a pedir a EventStreams; ver `src/wikipipe/fuente.py`), la valida, construye el grafo, los agregados por hora y los KPIs, y corrige los contadores por minuto. Las dos capas guardan cada evento con el mismo `_id`, así que no hay duplicados.

## Flujo del DAG

```
extraer → validar_y_limpiar → cargar_mongo → [cargar_cassandra, cargar_neo4j] → calcular_kpis
```

Cassandra y Neo4j leen de MongoDB los eventos de la hora. Todas las cargas son idempotentes: re-ejecutar una hora no duplica datos.

## Levantar el entorno en local

Requisitos: Docker Desktop con al menos 4 GB de RAM asignados (recomendado: 6 GB o más). La guía paso a paso, con todas las variables del `.env` y los problemas comunes, está en [docs/local.md](docs/local.md).

```bash
./local.sh            # crea el .env, levanta todo, activa el DAG y muestra las direcciones
./local.sh detener    # apaga (los datos se conservan) · ./local.sh borrar: empezar de cero
```

A mano, sin el script: `cp .env.example .env` (y cambiar las contraseñas) y luego `docker compose up -d --build`.

| Servicio | Dirección | Usuario |
| --- | --- | --- |
| Dashboard | http://localhost:8501 | sin contraseña en local (`DASHBOARD_PASSWORD` del `.env` para activarla) |
| Documentación de la API | http://localhost:8501/api/docs | la misma sesión del dashboard |
| Airflow | http://localhost:8080 | `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD` del `.env` |
| Neo4j Browser | http://localhost:7474 | `neo4j` / `NEO4J_PASSWORD` |
| MongoDB | `mongodb://localhost:27017` | `MONGO_USER` / `MONGO_PASSWORD` |
| Cassandra | `localhost:9042` | sin autenticación |

Para crear los esquemas de las tres bases (el DAG también los crea si no existen):

```bash
docker compose exec airflow python /opt/airflow/db/create_schemas.py
```

El DAG `wikipedia_recent_changes` aparece pausado si se levanta a mano: se activa desde la interfaz de Airflow (`./local.sh` lo activa solo).

Para procesar una hora concreta sin esperar al scheduler:

```bash
docker compose exec airflow airflow dags test wikipedia_recent_changes 2026-10-31T17:00:00+00:00
```

## Demo de operaciones CRUD

Ejecuta paso a paso crear, consultar, actualizar y eliminar en cada base, mostrando el resultado de cada operación. Usa entidades "demo" que crea y luego borra, y además consulta datos reales.

```bash
docker compose exec airflow python -m wikipipe.crud mongo       # o cassandra, neo4j, todo
```

En la VM de GCP:

```bash
gcloud compute ssh wikipipe-vm --zone us-central1-a --tunnel-through-iap \
  --command "cd /opt/wikipipe && sudo docker compose exec -T airflow python -m wikipipe.crud todo"
```

## Desarrollo del dashboard

```
navegador ──► web (nginx: React + shadcn/ui, puerto 8501) ──/api──► api (FastAPI) ──► MongoDB · Cassandra · Neo4j
```

Con los contenedores arriba, el frontend se puede desarrollar con recarga en caliente (Vite redirige `/api` a la API en `127.0.0.1:8010`):

```bash
cd web && npm install && npm run dev      # http://localhost:5173
```

## Desarrollo sin Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
PYTHONPATH=src .venv/bin/python -m pytest tests
PYTHONPATH=src .venv/bin/python -m wikipipe.extract 2026-10-31T16:00:00Z 2026-10-31T16:05:00Z
```
