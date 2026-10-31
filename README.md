# Big Data · Proyecto Grupal II · Wikipedia Recent Changes

Pipeline multimodelo que procesa cada hora los cambios de Wikipedia (`enwiki` y `eswiki`) desde el stream público de Wikimedia, los guarda en MongoDB, Cassandra y Neo4j, y calcula KPIs para un dashboard.

- Justificación del dataset: [docs/justificacion-dataset.md](docs/justificacion-dataset.md)
- Registro de lo realizado: [docs/trazabilidad.md](docs/trazabilidad.md)

## Estructura

```
airflow/dags/       DAG de Airflow (wikipedia_recent_changes, cada hora)
airflow/Dockerfile  imagen de Airflow 2.10.5 con los drivers de las 3 bases
src/wikipipe/       código del pipeline: extract.py, clean.py, ...
db/                 scripts de creación de las bases
tests/              pruebas de las reglas de limpieza
docker-compose.yml  MongoDB, Cassandra, Neo4j, Postgres (metadatos de Airflow) y Airflow
```

## Levantar el entorno en local

Requisitos: Docker Desktop con al menos 4 GB de RAM asignados (recomendado: 6 GB o más).

```bash
cp .env.example .env        # y cambiar las contraseñas
docker compose up -d --build
```

| Servicio | Dirección | Usuario |
| --- | --- | --- |
| Airflow | http://localhost:8080 | `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD` del `.env` |
| Neo4j Browser | http://localhost:7474 | `neo4j` / `NEO4J_PASSWORD` |
| MongoDB | `mongodb://localhost:27017` | `MONGO_USER` / `MONGO_PASSWORD` |
| Cassandra | `localhost:9042` | sin autenticación |

El DAG `wikipedia_recent_changes` aparece pausado: se activa desde la interfaz de Airflow.

Para procesar una hora concreta sin esperar al scheduler:

```bash
docker compose exec airflow airflow dags test wikipedia_recent_changes 2026-10-31T17:00:00+00:00
```

## Desarrollo sin Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
PYTHONPATH=src .venv/bin/python -m pytest tests
PYTHONPATH=src .venv/bin/python -m wikipipe.extract 2026-10-31T16:00:00Z 2026-10-31T16:05:00Z
```
