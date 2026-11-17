"""Regresiones con las tres bases reales. Activar con WIKIPIPE_INTEGRATION=1."""

import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

if os.getenv("WIKIPIPE_INTEGRATION") != "1":
    pytest.skip("Requiere las bases locales y WIKIPIPE_INTEGRATION=1", allow_module_level=True)

from fastapi.testclient import TestClient
from wikipipe import cassandra_store, clean, config, kpis, mongo, neo4j_store
from wikipipe.streaming import Streaming
from wikipipe.windows import lock_hour

START = datetime(2026, 11, 14, 10, tzinfo=timezone.utc)


@pytest.fixture
def stores(monkeypatch):
    import queries

    database = "wikipipe_test_" + uuid4().hex[:10]
    monkeypatch.setattr(config, "MONGO_DB", database)
    monkeypatch.setattr(config, "CASSANDRA_KEYSPACE", database)
    db = mongo.get_db()
    cluster, session = cassandra_store.connect()
    mongo.ensure_schema(db)
    cassandra_store.ensure_schema(session)
    driver = neo4j_store.connect()
    neo4j_store.ensure_schema(driver)
    prefix = "test_" + uuid4().hex[:10] + "_"
    monkeypatch.setattr(queries, "mongo_db", lambda: db)
    monkeypatch.setattr(queries, "cassandra", lambda: session)
    monkeypatch.setattr(queries, "neo4j", lambda: driver)
    queries.limpiar_cache()
    yield db, session, driver, prefix
    with driver.session() as graph:
        graph.run("MATCH (e:Editor) WHERE e.user STARTS WITH $p DETACH DELETE e", p=prefix).consume()
        graph.run("MATCH (p:Pagina) WHERE p.titulo STARTS WITH $prefix DETACH DELETE p", prefix=prefix).consume()
    queries.limpiar_cache()
    db.client.drop_database(database)
    session.execute(f"DROP KEYSPACE {database}")
    cluster.shutdown()
    driver.close()


def event(prefix, key, user="A", wiki="enwiki", minute=0, start=START, revert=None):
    dt = start + timedelta(minutes=minute, seconds=10)
    doc = {"meta": {"id": prefix + key, "dt": dt.isoformat(), "domain": "local-test"},
           "type": "edit", "wiki": wiki, "title": prefix + "Page", "namespace": 0,
           "user": prefix + user, "bot": False, "timestamp": int(dt.timestamp()),
           "length": {"old": 10, "new": 20}, "comment": ""}
    if revert:
        doc["comment"] = f"Reverted edit by [[Special:Contributions/{prefix + revert}|editor]]"
    doc["_id"] = doc["meta"]["id"]
    doc["derived"] = clean.derive(doc)
    return mongo.to_document(doc)


def load(stores, start=START):
    db, session, driver, _prefix = stores
    end = start + timedelta(hours=1)
    cassandra_store.load_window(session, mongo.events_in_window(db, start, end), start, db)
    neo4j_store.load_window(driver, mongo.events_in_window(db, start, end), start.isoformat())


def test_wiki_distinct_users_history_and_reprocessing(stores):
    db, session, driver, prefix = stores
    docs = [event(prefix, "1"), event(prefix, "2", user="B", minute=1),
            event(prefix, "3", minute=2, revert="B"),
            event(prefix, "4", wiki="eswiki", minute=3, revert="B"),
            event(prefix, "5", user="B", wiki="eswiki", minute=4)]
    db.events.insert_many(docs)
    load(stores)
    first = kpis.compute(START, START + timedelta(hours=1), {}, session, db, driver)
    assert first["actividad_por_editor"][0] == 2.5
    assert first["editor_mas_revertido"][0] == 2
    assert first["editor_mas_conectado"][0] == 1
    for wiki in ("enwiki", "eswiki"):
        assert kpis.from_neo4j(driver, START, wiki)["editor_mas_revertido"][0] == 1
    future = START + timedelta(hours=2)
    db.events.insert_many([event(prefix, "future" + str(i), user="C", start=future, revert="A") for i in range(10)])
    load(stores, future)
    assert kpis.from_neo4j(driver, START) == {k: first[k] for k in ("editor_mas_conectado", "editor_mas_revertido")}
    db.events.delete_many({"_id": {"$in": [d["_id"] for d in docs[1:]]}})
    load(stores)
    load(stores)
    assert session.execute("SELECT * FROM actividad_editor WHERE editor=%s AND fecha=%s AND hora=%s",
                           (prefix + "B", START.date(), START.hour)).one() is None
    rows = list(session.execute("SELECT * FROM eventos_por_minuto WHERE wiki=%s AND fecha=%s "
                                "AND minuto >= %s AND minuto < %s",
                                ("enwiki", START.date(), START, START + timedelta(hours=1))))
    assert sum(r.eventos for r in rows) == 1
    assert kpis.from_neo4j(driver, START)["editor_mas_revertido"] == (None, None)
    assert kpis.from_neo4j(driver, START)["editor_mas_conectado"] == (None, None)
    db.events.delete_one({"_id": docs[0]["_id"]})
    load(stores)
    assert kpis.from_cassandra(session, START)["eventos_procesados"][0] == 0


def test_stream_restart_failed_write_and_fencing(stores):
    db, session, _driver, prefix = stores
    docs = [event(prefix, str(i)) for i in range(10)]
    db.events.insert_many(docs)
    stream = Streaming()
    original = stream.cass

    class FailingSession:
        def execute(self, *args):
            raise RuntimeError("fallo de escritura simulado")

    try:
        stream.contadores.sumar(docs[0])
        stream.cass = FailingSession()
        with pytest.raises(RuntimeError, match="simulado"):
            stream.guardar_minutos()
        assert stream.contadores.tocados
        stream.cass = original
        stream.guardar_minutos()
        assert not stream.contadores.tocados
    finally:
        stream.cluster.shutdown()
    restarted = Streaming()
    try:
        restarted.contadores.sumar(docs[0])  # replay del mismo evento
        restarted.guardar_minutos()
        extra = event(prefix, "extra")
        db.events.insert_one(extra)
        restarted.contadores.sumar(extra)
        restarted.guardar_minutos()
    finally:
        restarted.cluster.shutdown()
    row = session.execute("SELECT eventos FROM eventos_por_minuto WHERE wiki=%s AND fecha=%s AND minuto=%s",
                          ("enwiki", START.date(), START)).one()
    assert row.eventos == 11
    with lock_hour(db, START) as lease:
        old = lease.timestamp
    with lock_hour(db, START) as lease:
        new = lease.timestamp
    assert new > old
    stmt = "UPDATE eventos_por_minuto USING TIMESTAMP %s SET eventos=%s WHERE wiki=%s AND fecha=%s AND minuto=%s"
    session.execute(stmt, (new + 1, 11, "enwiki", START.date(), START))
    session.execute(stmt, (old + 1, 1, "enwiki", START.date(), START))
    assert session.execute("SELECT eventos FROM eventos_por_minuto WHERE wiki=%s AND fecha=%s AND minuto=%s",
                           ("enwiki", START.date(), START)).one().eventos == 11


def test_crud_api_and_exact_relationship_delete(stores):
    import main
    db, session, driver, prefix = stores
    client = TestClient(main.app)
    doc = event(prefix, "crud")
    doc.pop("derived")
    r = client.post("/api/crud/mongo", json=doc)
    assert r.status_code == 200 and r.json()["rechazado"] is False
    assert client.post("/api/crud/mongo", json=doc).status_code == 409
    assert client.get("/api/crud/mongo/" + doc["_id"]).status_code == 200
    r = client.patch("/api/crud/mongo/" + doc["_id"], json={"cambios": {"length.new": 40}})
    assert r.json()["documento"]["derived"]["delta_bytes"] == 30
    assert client.delete("/api/crud/mongo/" + doc["_id"]).json()["eliminados"] == 1
    assert client.get("/api/crud/mongo/" + doc["_id"]).status_code == 404
    assert client.post("/api/crud/mongo", json={"_id": prefix + "invalid"}).json()["rechazado"]

    key = {"kpi": "demo_" + prefix, "ventana": START.isoformat()}
    assert client.post("/api/crud/cassandra", json={**key, "valor": 42}).json()["reemplazo"] is False
    assert client.post("/api/crud/cassandra", json={**key, "valor": 43}).json()["reemplazo"] is True
    assert client.get("/api/crud/cassandra/fila", params=key).json()["valor"] == 43
    assert client.patch("/api/crud/cassandra", json={**key, "cambios": {"valor": 44}}).json()["valor"] == 44
    assert client.patch("/api/crud/cassandra", json={**key, "cambios": {"valor": "invalido"}}).status_code == 400
    assert client.delete("/api/crud/cassandra", params=key).json()["filas_eliminadas"] == 1
    assert client.get("/api/crud/cassandra/fila", params=key).status_code == 404
    assert client.patch("/api/crud/cassandra", json={**key, "cambios": {"valor": 9}}).status_code == 404
    for offset in range(6):
        client.post("/api/crud/cassandra", json={"kpi": key["kpi"],
                    "ventana": (START + timedelta(hours=offset)).isoformat(), "valor": offset})
    assert len(client.get("/api/crud/cassandra/ultimas").json()) == 5
    assert client.delete("/api/crud/cassandra", params={"kpi": key["kpi"]}).json()["filas_eliminadas"] == 6

    a, b = prefix + "A", prefix + "B"
    assert client.post("/api/crud/neo4j/editor", json={"user": a}).json()["creado"]
    assert client.patch("/api/crud/neo4j/editor/" + a, json={"cambios": {"nota": "editado"}}).json()["nota"] == "editado"
    for wiki in ("enwiki", "eswiki"):
        assert client.post("/api/crud/neo4j/relacion", json={"origen": a, "destino": b, "tipo": "REVIRTIO", "wiki": wiki}).status_code == 200
    rels = client.get("/api/crud/neo4j/editor/" + a).json()["salientes"]
    assert len(rels) == 2
    params = {"origen": a, "destino": b, "tipo": "REVIRTIO"}
    assert client.delete("/api/crud/neo4j/relacion", params=params).status_code == 400
    assert client.delete("/api/crud/neo4j/relacion", params={**params, "relacion_id": rels[0]["id"]}).json()["relaciones_eliminadas"] == 1
    assert len(client.get("/api/crud/neo4j/editor/" + a).json()["salientes"]) == 1
    assert client.delete("/api/crud/neo4j/editor/" + a).json()["nodos_eliminados"] == 1
    assert client.get("/api/crud/neo4j/editor/" + a).status_code == 404
    assert client.post("/api/crud/neo4j/editor", json={"user": " "}).status_code == 400


def test_correction_updates_following_totals_and_completed_series(stores, monkeypatch):
    import queries
    db, session, driver, prefix = stores
    next_hour = START + timedelta(hours=1)
    docs = [event(prefix, "first"), event(prefix, "removed", user="B"),
            *[event(prefix, "next" + str(i), start=next_hour) for i in range(3)]]
    db.events.insert_many(docs)
    for start in (START, next_hour):
        load(stores, start)
        values = kpis.compute(start, start + timedelta(hours=1), {}, session, db, driver)
        cassandra_store.write_kpis(session, start, values)
        mongo.record_run(db, {"window_start": start.isoformat(), "window_end": (start + timedelta(hours=1)).isoformat()})
    db.events.delete_one({"_id": docs[1]["_id"]})
    load(stores)
    kpis.refresh_following(db, session, START)
    queries.limpiar_cache()
    series = queries.kpis()
    assert series["total_eventos_acumulados"][0]["valor"] == 4
    assert series["crecimiento_pct"][0]["valor"] == 200
    assert {points[0]["ventana"] for points in series.values()} == {next_hour.isoformat()}
    totals = queries.resumen_acumulado((next_hour + timedelta(hours=1)).isoformat())
    assert totals["eventos"] == totals["ediciones"] == 3
    assert totals["horas"] == 1 and totals["creaciones"] == 0
    assert totals["delta_bytes"] == 30

    class ConcurrentSession:
        def execute(self, *args):
            result = session.execute(*args)
            db.pipeline_runs.update_one({"_id": next_hour.isoformat()}, {"$set": {"reprocessing": True}})
            return result

    monkeypatch.setattr(queries, "cassandra", lambda: ConcurrentSession())
    queries.limpiar_cache()
    assert all(not points for points in queries.kpis().values())


def test_graph_window_is_atomic_on_failure(stores, monkeypatch):
    db, session, driver, prefix = stores
    db.events.insert_one(event(prefix, "first", revert="B"))
    load(stores)
    before = kpis.from_neo4j(driver, START)
    db.events.insert_one(event(prefix, "second", revert="B"))
    with monkeypatch.context() as patch:
        patch.setattr(neo4j_store, "Q_PAR", "THIS IS INVALID CYPHER %s")
        with pytest.raises(Exception):
            neo4j_store.load_window(driver, mongo.events_in_window(db, START, START + timedelta(hours=1)), START.isoformat())
    assert kpis.from_neo4j(driver, START) == before
    load(stores)
    assert kpis.from_neo4j(driver, START)["editor_mas_revertido"][0] == 2


def test_mongo_pagination_keeps_events_with_equal_timestamps(stores):
    import main
    db, _session, _driver, prefix = stores
    db.events.insert_many([event(prefix, str(i)) for i in range(23)])
    client = TestClient(main.app)
    params = {"wiki": "enwiki", "periodo": "todo", "editor": prefix, "limite": 10}
    seen = []
    while True:
        result = client.get("/api/crud/mongo/buscar", params=params).json()
        seen.extend(doc["_id"] for doc in result["documentos"])
        if not result["hay_mas"]:
            break
        last = result["documentos"][-1]
        params.update(antes=last["fecha"], antes_id=last["_id"])
    assert len(seen) == len(set(seen)) == 23


def test_live_five_minute_windows_and_distinct_editors(stores):
    import queries
    db, _, _, prefix = stores
    now = START + timedelta(minutes=10)

    def at(key, dt, user="Shared", wiki="enwiki", bot=False, revert=None):
        doc = event(prefix, key, user=user, wiki=wiki, start=dt - timedelta(seconds=10), revert=revert)
        doc["bot"] = bot
        doc["derived"] = clean.derive(doc)
        return mongo.to_document(doc)

    db.events.insert_many([
        at("too-old", START - timedelta(microseconds=1)),
        at("previous-start", START),
        at("previous-same-user", START + timedelta(minutes=1), wiki="eswiki"),
        at("current-start", START + timedelta(minutes=5), revert="Other"),
        at("current-same-user", START + timedelta(minutes=6), wiki="eswiki"),
        at("bot1", now - timedelta(seconds=2), user="BatchBot", bot=True),
        at("bot2", now - timedelta(seconds=1), user="BatchBot", bot=True),
        at("end-excluded", now),
        at("future", now + timedelta(seconds=1)),
    ])
    windows = queries.metricas_vivo(now, ["enwiki", "eswiki"])
    current, previous = windows["actual"], windows["anterior"]
    assert current["eventos"] == current["ediciones"] == 4
    assert current["eventos_bot"] == 2 and current["reversiones"] == 1
    assert current["editores"] == {"registrado": 1, "bot": 1}
    assert previous["eventos"] == 2 and previous["editores"] == {"registrado": 1}
    assert current["inicio"] == previous["fin"]
    assert datetime.fromisoformat(current["fin"]) - datetime.fromisoformat(current["inicio"]) == timedelta(minutes=5)
    assert queries.metricas_vivo(now, ["eswiki"])["actual"]["eventos"] == 1
    assert queries.metricas_vivo(now, ["missingwiki"])["actual"]["editores"] == {}


def test_cumulative_protagonists_respect_wiki_completed_windows_and_cut(stores):
    import queries
    import main
    db, _, _, prefix = stores
    second, future = START + timedelta(hours=1), START + timedelta(hours=2)
    docs = [event(prefix, "a"), event(prefix, "b", user="B"),
            *[event(prefix, "rev" + str(i), revert="B") for i in range(3)],
            event(prefix, "c", user="C", start=second), event(prefix, "d", user="D", start=second),
            event(prefix, "last-rev", user="C", start=second, revert="D"),
            event(prefix, "es-base", user="E", wiki="eswiki"),
            *[event(prefix, "es-rev" + str(i), user="F", wiki="eswiki", revert="E") for i in range(6)],
            *[event(prefix, "future" + str(i), user="Future", start=future, revert="A") for i in range(10)]]
    db.events.insert_many(docs)
    for start in (START, second, future):
        load(stores, start)
    for start in (START, second):
        mongo.record_run(db, {"window_start": start.isoformat(), "window_end": (start + timedelta(hours=1)).isoformat()})
    cut = (future + timedelta(hours=1)).isoformat()
    en = queries.protagonistas_acumulados(cut, "enwiki")["protagonistas"]
    assert en["pagina_mas_disputada"]["valor"] == 4
    assert en["editor_mas_revertido"]["valor"] == 3
    assert en["editor_mas_revertido"]["detalle"].startswith(prefix + "B ")
    assert en["editor_mas_conectado"] == {"valor": 3, "detalle": prefix + "A"}
    es = queries.protagonistas_acumulados(cut, "eswiki")["protagonistas"]
    assert es["pagina_mas_disputada"]["valor"] == 6
    assert es["editor_mas_revertido"]["detalle"].startswith(prefix + "E ")
    both = queries.protagonistas_acumulados(cut)["protagonistas"]
    assert both["pagina_mas_disputada"]["detalle"] == "eswiki:" + prefix + "Page"
    first = queries.protagonistas_acumulados(second.isoformat(), "enwiki")["protagonistas"]
    assert first["pagina_mas_disputada"]["valor"] == 3
    assert first["editor_mas_conectado"]["valor"] == 1
    client = TestClient(main.app)
    assert client.get("/api/resumen/acumulado/protagonistas", params={"corte": cut, "wiki": "enwiki"}).json()["protagonistas"] == en
    assert client.get("/api/resumen/acumulado/protagonistas", params={"corte": "2026-11-14T10:00:00"}).status_code == 400
    mongo.record_run(db, {"window_start": future.isoformat(), "window_end": cut})
    queries.limpiar_cache()
    latest = queries.protagonistas_acumulados(cut, "enwiki")["protagonistas"]
    assert latest["editor_mas_revertido"]["valor"] == 10
    assert latest["editor_mas_revertido"]["detalle"].startswith(prefix + "A ")
    assert queries.protagonistas_acumulados(future.isoformat(), "enwiki")["protagonistas"] == en
