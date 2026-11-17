"""Carga 55,000 eventos SINTÉTICOS para verificar el entorno local y el DAG.

Ejecutar dentro del contenedor API de un proyecto Compose de desarrollo vacío.
"""

from datetime import datetime, timedelta, timezone

from wikipipe import cassandra_store, clean, mongo, neo4j_store


def main():
    db = mongo.get_db()
    if db.events.estimated_document_count():
        raise RuntimeError("La base ya contiene eventos. Usa un proyecto Compose local vacío para esta muestra")
    mongo.ensure_schema(db)
    cluster, session = cassandra_store.connect()
    driver = neo4j_store.connect()
    try:
        cassandra_store.ensure_schema(session)
        neo4j_store.ensure_schema(driver)
    finally:
        cluster.shutdown()
        driver.close()
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=3)
    docs = []
    for i in range(55_000):
        dt = start + timedelta(hours=i // 20_000, seconds=(i % 20_000) % 3600)
        bot = i % 7 == 0
        user = f"Local_{'Bot' if bot else 'Editor'}_{i % 1000}"
        doc = {"meta": {"id": f"local-sample-{i}", "dt": dt.isoformat(), "domain": "synthetic-local-test"},
               "wiki": "eswiki" if i % 4 == 0 else "enwiki", "type": "new" if i % 11 == 0 else "edit",
               "title": f"Prueba local {i % 120}", "namespace": 0, "user": user, "bot": bot,
               "timestamp": int(dt.timestamp()), "length": {"old": 100, "new": 100 + i % 300},
               "comment": f"Reverted edit by [[Special:Contributions/Local_Editor_{(i + 1) % 1000}|editor]]" if i % 19 == 0 else "Muestra sintética local"}
        doc["_id"] = doc["meta"]["id"]
        doc["derived"] = clean.derive(doc)
        docs.append(mongo.to_document(doc))
        if len(docs) == 1000:
            db.events.insert_many(docs)
            docs.clear()
    db.stream_cobertura.insert_one({"_id": "synthetic-local-test", "inicio": start,
                                    "fin": start + timedelta(hours=3, minutes=5),
                                    "actualizado": datetime.now(timezone.utc)})
    print(f"Muestra sintética local: {db.events.count_documents({})} eventos")
    for hour in range(3):
        print(f"DAG_INTERVAL={(start + timedelta(hours=hour)).isoformat()}")


if __name__ == "__main__":
    main()
