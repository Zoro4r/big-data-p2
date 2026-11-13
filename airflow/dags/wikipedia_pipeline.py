"""DAG del proyecto: procesa cada hora una ventana del stream Wikipedia Recent Changes.

Etapas (las pedidas en la sección 3 de las instrucciones):
1. extraer            → data/raw/AAAA-MM-DD/HHMM.jsonl.gz, desde MongoDB si el servicio stream
                        cubrió la hora sin huecos; si no, desde EventStreams (ver wikipipe/fuente.py)
2. validar_y_limpiar  → data/clean/... y data/rejected/...
3. cargar_mongo       → colección events (fuente de verdad); no escribe si la hora se leyó de MongoDB
4. cargar_cassandra   → lee la ventana de Mongo y escribe agregados (en paralelo con 5)
5. cargar_neo4j       → lee la ventana de Mongo y construye el grafo
6. calcular_kpis      → calcula los KPIs en cada base y los guarda en Cassandra

Cada ejecución procesa su propio intervalo [data_interval_start, data_interval_end), por lo que
re-ejecutar una hora o lanzar un backfill trae exactamente los mismos eventos, y todas las
cargas son idempotentes (no duplican datos).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from airflow.decorators import dag, task

default_args = {
    "owner": "big-data-p2",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}

# Campos que necesitan Cassandra y Neo4j (no hace falta traer el documento completo).
PROJECTION = {"wiki": 1, "type": 1, "user": 1, "title": 1, "namespace": 1, "length": 1, "derived": 1}


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
        from wikipipe.extract import raw_path_for
        from wikipipe.fuente import extraer_hora

        return extraer_hora(data_interval_start, data_interval_end, raw_path_for(data_interval_start))

    @task
    def validar_y_limpiar(extraccion: dict) -> dict:
        from wikipipe.clean import clean_file

        raw = Path(extraccion["path"])
        clean = Path(str(raw).replace("/raw/", "/clean/"))
        rejected = Path(str(raw).replace("/raw/", "/rejected/"))
        stats = clean_file(raw, clean, rejected)
        stats.update(clean_path=str(clean), rejected_path=str(rejected), window_start=extraccion["window_start"])
        return stats

    @task
    def cargar_mongo(limpieza: dict, extraccion: dict) -> dict:
        from wikipipe import mongo

        # Si la hora se leyó de MongoDB, ya está ahí completa (eventos y rechazados): no se reescribe.
        if extraccion.get("fuente") == "mongodb":
            return {"processed": limpieza.get("valid", 0), "inserted": 0, "updated": 0, "rejected_stored": 0,
                    "omitida": "la hora se leyó de MongoDB"}
        return mongo.load_events(mongo.get_db(), Path(limpieza["clean_path"]), Path(limpieza["rejected_path"]))

    @task
    def cargar_cassandra(_mongo: dict, data_interval_start=None, data_interval_end=None) -> dict:
        from wikipipe import cassandra_store, mongo
        from wikipipe.extract import to_utc

        events = mongo.events_in_window(mongo.get_db(), to_utc(data_interval_start), to_utc(data_interval_end), PROJECTION)
        cluster, session = cassandra_store.connect()
        try:
            return cassandra_store.load_window(session, events)
        finally:
            cluster.shutdown()

    @task
    def cargar_neo4j(_mongo: dict, data_interval_start=None, data_interval_end=None) -> dict:
        from wikipipe import mongo, neo4j_store
        from wikipipe.extract import to_utc

        start, end = to_utc(data_interval_start), to_utc(data_interval_end)
        events = mongo.events_in_window(mongo.get_db(), start, end, PROJECTION)
        driver = neo4j_store.connect()
        try:
            return neo4j_store.load_window(driver, events, ventana=start.isoformat())
        finally:
            driver.close()

    @task
    def calcular_kpis(extraccion: dict, limpieza: dict, carga_mongo: dict, carga_cassandra: dict,
                      carga_neo4j: dict, data_interval_start=None, data_interval_end=None) -> dict:
        from wikipipe import cassandra_store, config, kpis, mongo, neo4j_store
        from wikipipe.extract import to_utc

        start, end = to_utc(data_interval_start), to_utc(data_interval_end)
        db, driver = mongo.get_db(), neo4j_store.connect()
        cluster, session = cassandra_store.connect()
        try:
            session.set_keyspace("wikipipe")
            values = kpis.compute(start, end, limpieza, session, db, driver)
            cassandra_store.write_kpis(session, start, values)
            por_wiki = {}
            for wiki in sorted(config.WIKIS):
                por_wiki[wiki] = kpis.compute(start, end, limpieza, session, db, driver, wiki)
                cassandra_store.write_kpis(session, start, por_wiki[wiki], wiki)
            cassandra_store.write_run(session, start, extraccion, limpieza)
            mongo.record_run(db, {
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
                "extraccion": extraccion,
                "limpieza": limpieza,
                "carga_mongo": carga_mongo,
                "carga_cassandra": carga_cassandra,
                "carga_neo4j": carga_neo4j,
                "kpis": {k: {"valor": v, "detalle": d} for k, (v, d) in values.items()},
                "kpis_por_wiki": {w: {k: {"valor": v, "detalle": d} for k, (v, d) in vals.items()}
                                  for w, vals in por_wiki.items()},
                "grafo_por_wiki": neo4j_store.conteo_por_wiki(driver),
            })
            return {k: v for k, (v, _) in values.items()}
        finally:
            cluster.shutdown()
            driver.close()

    extraccion = extraer()
    limpieza = validar_y_limpiar(extraccion)
    mongo_ok = cargar_mongo(limpieza, extraccion)
    cass_ok = cargar_cassandra(mongo_ok)
    neo_ok = cargar_neo4j(mongo_ok)
    calcular_kpis(extraccion, limpieza, mongo_ok, cass_ok, neo_ok)


wikipedia_pipeline()
