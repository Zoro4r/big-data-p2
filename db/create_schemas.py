"""Crea los esquemas de las tres bases: colecciones e índices de MongoDB, keyspace y tablas de
Cassandra, y restricciones e índices de Neo4j. Es idempotente: se puede correr varias veces.

Uso (dentro del contenedor de Airflow, que ya tiene las conexiones configuradas):
    docker compose exec airflow python /opt/airflow/db/create_schemas.py

Los scripts que aplica son:
    db/mongo/schema.json          validador e índices de cada colección
    db/cassandra/schema.cql       keyspace y tablas
    db/neo4j/constraints.cypher   restricciones de unicidad e índices
"""

from wikipipe import cassandra_store, mongo, neo4j_store


def main() -> None:
    db = mongo.get_db()
    mongo.ensure_schema(db)
    print("MongoDB  : colecciones", sorted(db.list_collection_names()))

    cluster, session = cassandra_store.connect()
    try:
        cassandra_store.ensure_schema(session)
        tables = session.execute(
            "SELECT table_name FROM system_schema.tables WHERE keyspace_name = 'wikipipe'")
        print("Cassandra: tablas", sorted(r.table_name for r in tables))
    finally:
        cluster.shutdown()

    driver = neo4j_store.connect()
    try:
        neo4j_store.ensure_schema(driver)
        with driver.session() as s:
            names = [r["name"] for r in s.run("SHOW CONSTRAINTS YIELD name RETURN name")]
        print("Neo4j    : restricciones", sorted(names))
    finally:
        driver.close()


if __name__ == "__main__":
    main()
