"""DAG del proyecto: procesa cada hora una ventana del stream Wikipedia Recent Changes.

Etapas (las pedidas en la sección 3 de las instrucciones):
1. extraer            → data/raw/AAAA-MM-DD/HHMM.jsonl.gz
2. validar_y_limpiar  → data/clean/... y data/rejected/...
3. cargar_mongo
4. cargar_cassandra   (en paralelo con 5)
5. cargar_neo4j
6. calcular_kpis

Cada ejecución procesa su propio intervalo [data_interval_start, data_interval_end), por lo que
re-ejecutar una hora o lanzar un backfill trae exactamente los mismos eventos.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from airflow.decorators import dag, task
from airflow.operators.empty import EmptyOperator

default_args = {
    "owner": "big-data-p2",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}


@dag(
    dag_id="wikipedia_recent_changes",
    schedule="@hourly",
    # Con catchup=False no se procesan solas las horas pasadas, pero sí se pueden lanzar a mano
    # (backfill) desde esta fecha. Wikimedia conserva el stream solo unos días.
    start_date=datetime(2026, 10, 25),
    catchup=False,
    max_active_runs=1,
    default_args=default_args,
    tags=["wikipedia", "big-data-p2"],
    doc_md=__doc__,
)
def wikipedia_pipeline():
    @task(execution_timeout=timedelta(minutes=30))
    def extraer(data_interval_start=None, data_interval_end=None) -> dict:
        from wikipipe.extract import extract_window, raw_path_for

        return extract_window(data_interval_start, data_interval_end, raw_path_for(data_interval_start))

    @task
    def validar_y_limpiar(extraccion: dict) -> dict:
        from wikipipe.clean import clean_file

        raw = Path(extraccion["path"])
        clean = Path(str(raw).replace("/raw/", "/clean/"))
        rejected = Path(str(raw).replace("/raw/", "/rejected/"))
        stats = clean_file(raw, clean, rejected)
        stats.update(clean_path=str(clean), window_start=extraccion["window_start"])
        return stats

    # Pendientes: se reemplazan por tareas reales a medida que cada integrante termine su parte.
    cargar_mongo = EmptyOperator(task_id="cargar_mongo")
    cargar_cassandra = EmptyOperator(task_id="cargar_cassandra")
    cargar_neo4j = EmptyOperator(task_id="cargar_neo4j")
    calcular_kpis = EmptyOperator(task_id="calcular_kpis")

    limpieza = validar_y_limpiar(extraer())
    limpieza >> cargar_mongo >> [cargar_cassandra, cargar_neo4j] >> calcular_kpis


wikipedia_pipeline()
