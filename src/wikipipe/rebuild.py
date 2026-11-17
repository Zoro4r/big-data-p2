"""Reconstrucción del modelo 2 desde MongoDB. Ejecutar con el streaming y DAG detenidos.

Uso: python -m wikipipe.rebuild [--reset-graph]
El reset guarda primero una copia JSONL gzip de todo el grafo en DATA_DIR/backups.
"""

import argparse
import gzip
import json
from datetime import datetime, timedelta, timezone

from wikipipe import cassandra_store, config, kpis, mongo, neo4j_store


def backup_graph(driver):
    path = config.DATA_DIR / "backups" / f"neo4j-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.jsonl.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as output, driver.session(fetch_size=1000) as session:
        for kind, query in (
            ("node", "MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS properties"),
            ("relationship", "MATCH (a)-[r]->(b) RETURN elementId(a) AS source, elementId(b) AS target, "
                             "type(r) AS type, properties(r) AS properties"),
        ):
            for record in session.run(query):
                output.write(json.dumps({"kind": kind, **dict(record)}, ensure_ascii=False, default=str) + "\n")
    return path


def rebuild_window(db, session, driver, start):
    end = start + timedelta(hours=1)
    previous = db.pipeline_runs.find_one({"_id": start.isoformat()}) or {}
    clean_stats = previous.get("limpieza") or {}
    extraction = previous.get("extraccion") or {"fuente": "mongodb"}
    cassandra = cassandra_store.load_window(session, mongo.events_in_window(db, start, end), start, db)
    graph = neo4j_store.load_window(driver, mongo.events_in_window(db, start, end), start.isoformat())
    global_values = kpis.compute(start, end, clean_stats, session, db, driver)
    cassandra_store.write_kpis(session, start, global_values)
    per_wiki = {}
    for wiki in sorted(config.WIKIS):
        per_wiki[wiki] = kpis.compute(start, end, clean_stats, session, db, driver, wiki)
        cassandra_store.write_kpis(session, start, per_wiki[wiki], wiki)
    # Una corrección de volumen también cambia el crecimiento de la hora siguiente y
    # los totales acumulados posteriores. El comando reconstruye en orden cronológico.
    cassandra_store.write_run(session, start, extraction, clean_stats)
    mongo.record_run(db, {"window_start": start.isoformat(), "window_end": end.isoformat(),
                         "extraccion": extraction, "limpieza": clean_stats,
                         "carga_cassandra": cassandra, "carga_neo4j": graph,
                         "kpis": {k: {"valor": v, "detalle": d} for k, (v, d) in global_values.items()},
                         "kpis_por_wiki": {wiki: {k: {"valor": v, "detalle": d} for k, (v, d) in values.items()}
                                           for wiki, values in per_wiki.items()},
                         "grafo_por_wiki": neo4j_store.conteo_por_wiki(driver)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset-graph", action="store_true", help="Respaldar y reconstruir el grafo anterior")
    args = parser.parse_args()
    db = mongo.get_db()
    mongo.ensure_schema(db)
    cluster, session = cassandra_store.connect()
    driver = neo4j_store.connect()
    try:
        cassandra_store.ensure_schema(session)
        if args.reset_graph:
            print(f"Respaldo del grafo: {backup_graph(driver)}", flush=True)
            with driver.session() as graph:
                # Volumen acotado por transacción para grafos grandes.
                while graph.run("MATCH (n) WITH n LIMIT 2000 DETACH DELETE n RETURN count(*) AS n").single()["n"]:
                    pass
        neo4j_store.ensure_schema(driver)
        # Sembrar el manifiesto de instalaciones antiguas, antes de limpiar cualquier hora.
        for row in session.execute("SELECT editor, fecha, hora FROM actividad_editor"):
            start = datetime.combine(row.fecha.date(), datetime.min.time(), timezone.utc).replace(hour=row.hora)
            db.pipeline_windows.update_one({"_id": start.isoformat()},
                                            {"$addToSet": {"editors": row.editor}}, upsert=True)
        first = db.events.find_one({}, {"derived.event_dt": 1}, sort=[("derived.event_dt", 1)])
        runs = list(db.pipeline_runs.find({}, {"window_start": 1}))
        starts = [datetime.fromisoformat(run["window_start"]) for run in runs if run.get("window_start")]
        processed = {value.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0) for value in starts}
        coverage = list(db.stream_cobertura.find({}, {"inicio": 1, "fin": 1}))
        if first:
            starts.append(first["derived"]["event_dt"].replace(tzinfo=timezone.utc))
        if not starts:
            print("Sin ventanas para reconstruir")
            return
        start = min(starts).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        while start < end:
            covered = any(span["inicio"].replace(tzinfo=timezone.utc) <= start
                          and span["fin"].replace(tzinfo=timezone.utc) >= start + timedelta(hours=1, minutes=5)
                          for span in coverage)
            if start in processed or covered:
                rebuild_window(db, session, driver, start)
                print(f"Reconstruida {start.isoformat()}", flush=True)
            else:
                print(f"Sin cobertura completa: {start.isoformat()}", flush=True)
            start += timedelta(hours=1)
    finally:
        cluster.shutdown()
        driver.close()


if __name__ == "__main__":
    main()
