"""Consultas del dashboard a MongoDB, Cassandra y Neo4j.

Las conexiones se crean una vez por proceso (st.cache_resource) y los resultados se guardan
unos minutos (st.cache_data), porque los datos solo cambian una vez por hora.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pandas as pd
import streamlit as st
from cassandra.util import Date as CassDate

from wikipipe import cassandra_store, config, mongo, neo4j_store

TTL = 300  # segundos

# ---------------------------------------------------------------- conexiones


@st.cache_resource
def mongo_db():
    return mongo.get_db()


@st.cache_resource
def cassandra():
    _, session = cassandra_store.connect()
    session.set_keyspace(config.CASSANDRA_KEYSPACE)
    return session


@st.cache_resource
def neo4j():
    return neo4j_store.connect()


def _fechas(dias: int) -> list[date]:
    hoy = datetime.now(timezone.utc).date()
    return [hoy - timedelta(days=i) for i in range(dias)]


def _fila(row) -> dict:
    """Fila de Cassandra a dict; el tipo Date del driver se convierte a datetime.date."""
    return {k: (v.date() if isinstance(v, CassDate) else v) for k, v in row._asdict().items()}


# ---------------------------------------------------------------- Cassandra

KPI_NOMBRES = [
    "eventos_procesados", "crecimiento_pct", "tasa_automatizacion_pct", "actividad_por_editor",
    "tasa_creacion_pct", "volumen_neto_bytes", "tasa_reversion_pct", "total_eventos_acumulados",
    "pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido", "calidad_datos_pct",
]


@st.cache_data(ttl=TTL)
def kpis(horas: int = 72) -> pd.DataFrame:
    """Serie de cada KPI (una partición por KPI en la tabla kpis)."""
    s, filas = cassandra(), []
    for kpi in KPI_NOMBRES:
        for r in s.execute("SELECT ventana, valor, detalle FROM kpis WHERE kpi = %s LIMIT %s", (kpi, horas)):
            filas.append({"kpi": kpi, "ventana": r.ventana, "valor": r.valor, "detalle": r.detalle})
    return pd.DataFrame(filas, columns=["kpi", "ventana", "valor", "detalle"])


@st.cache_data(ttl=TTL)
def resumen_por_hora(dias: int = 3) -> pd.DataFrame:
    s, filas = cassandra(), []
    for f in _fechas(dias):
        for r in s.execute("SELECT * FROM resumen_por_hora WHERE fecha = %s", (f,)):
            d = _fila(r)
            d["hora_utc"] = datetime.fromisoformat(f"{r.fecha}T{r.hora:02d}:00:00")
            filas.append(d)
    df = pd.DataFrame(filas)
    return df.sort_values("hora_utc") if not df.empty else df


@st.cache_data(ttl=TTL)
def eventos_por_minuto(wiki: str, fecha: date) -> pd.DataFrame:
    rows = cassandra().execute("SELECT * FROM eventos_por_minuto WHERE wiki = %s AND fecha = %s", (wiki, fecha))
    df = pd.DataFrame([_fila(r) for r in rows])
    return df.sort_values("minuto") if not df.empty else df


@st.cache_data(ttl=TTL)
def paginas_top(wiki: str, fecha: date) -> pd.DataFrame:
    rows = cassandra().execute("SELECT * FROM paginas_top_por_hora WHERE wiki = %s AND fecha = %s", (wiki, fecha))
    return pd.DataFrame([_fila(r) for r in rows])


@st.cache_data(ttl=TTL)
def actividad_editor(editor: str, limite: int = 200) -> pd.DataFrame:
    rows = cassandra().execute("SELECT * FROM actividad_editor WHERE editor = %s LIMIT %s", (editor, limite))
    df = pd.DataFrame([_fila(r) for r in rows])
    if not df.empty:
        df["hora_utc"] = pd.to_datetime(df["fecha"].astype(str)) + pd.to_timedelta(df["hora"], unit="h")
    return df


@st.cache_data(ttl=TTL)
def ejecuciones(dias: int = 3) -> pd.DataFrame:
    s, filas = cassandra(), []
    for f in _fechas(dias):
        filas += [_fila(r) for r in s.execute("SELECT * FROM ejecuciones WHERE fecha = %s", (f,))]
    df = pd.DataFrame(filas)
    return df.sort_values("ventana", ascending=False) if not df.empty else df


# ---------------------------------------------------------------- MongoDB


@st.cache_data(ttl=TTL)
def total_eventos() -> int:
    return mongo_db().events.estimated_document_count()


@st.cache_data(ttl=TTL)
def buscar_eventos(wiki: str, tipo: str, editor: str, titulo: str, solo_reversiones: bool, limite: int) -> pd.DataFrame:
    filtro: dict = {}
    if wiki != "todas":
        filtro["wiki"] = wiki
    if tipo != "todos":
        filtro["type"] = tipo
    if editor:
        filtro["user"] = editor
    if titulo:
        filtro["title"] = {"$regex": titulo, "$options": "i"}
    if solo_reversiones:
        filtro["derived.revert_target"] = {"$exists": True}
    proyeccion = {"_id": 1, "derived.event_dt": 1, "wiki": 1, "type": 1, "title": 1, "user": 1,
                  "derived.user_type": 1, "derived.delta_bytes": 1, "derived.revert_target": 1, "comment": 1}
    docs = mongo_db().events.find(filtro, proyeccion).sort("derived.event_dt", -1).limit(limite)
    filas = [{
        "fecha_utc": d["derived"]["event_dt"], "wiki": d["wiki"], "tipo": d["type"], "título": d["title"],
        "editor": d["user"], "tipo_editor": d["derived"].get("user_type"),
        "Δbytes": d["derived"].get("delta_bytes"), "revierte_a": d["derived"].get("revert_target"),
        "comentario": d.get("comment"), "_id": d["_id"],
    } for d in docs]
    return pd.DataFrame(filas)


@st.cache_data(ttl=TTL)
def documento(event_id: str) -> dict | None:
    return mongo_db().events.find_one({"_id": event_id})


@st.cache_data(ttl=TTL)
def tipos_por_wiki(horas: int = 24) -> pd.DataFrame:
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    pipeline = [
        {"$match": {"derived.event_dt": {"$gte": desde}}},
        {"$group": {"_id": {"wiki": "$wiki", "tipo": "$type"}, "eventos": {"$sum": 1}}},
    ]
    return pd.DataFrame([{"wiki": r["_id"]["wiki"], "tipo": r["_id"]["tipo"], "eventos": r["eventos"]}
                         for r in mongo_db().events.aggregate(pipeline)])


# ---------------------------------------------------------------- Neo4j


def _cypher(query: str, **params) -> list[dict]:
    with neo4j().session() as s:
        return s.run(query, **params).data()


@st.cache_data(ttl=TTL)
def conteo_grafo() -> dict:
    # Con la etiqueta o el tipo escritos en la consulta, Neo4j responde desde su contador interno
    # (no recorre el grafo). Los nombres vienen de una lista fija, no del usuario.
    nodos = {lb: _cypher(f"MATCH (n:{lb}) RETURN count(n) AS n")[0]["n"]
             for lb in ("Editor", "Pagina", "Categoria", "Wiki")}
    rels = {t: _cypher(f"MATCH ()-[r:{t}]->() RETURN count(r) AS n")[0]["n"]
            for t in ("EDITO", "REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO", "COEDITA", "EN_CATEGORIA")}
    return {"nodos": nodos, "relaciones": rels}


@st.cache_data(ttl=TTL)
def ranking_revertidos(limite: int = 15) -> pd.DataFrame:
    return pd.DataFrame(_cypher(
        "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) "
        "RETURN b.user AS editor, b.tipo AS tipo, sum(r.veces) AS reversiones, count(DISTINCT a) AS revertido_por "
        "ORDER BY reversiones DESC, revertido_por DESC LIMIT $limite", limite=limite))


@st.cache_data(ttl=TTL)
def ranking_patrulleros(limite: int = 15) -> pd.DataFrame:
    return pd.DataFrame(_cypher(
        "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) "
        "RETURN a.user AS editor, a.tipo AS tipo, sum(r.veces) AS reversiones, count(DISTINCT b) AS editores_revertidos "
        "ORDER BY reversiones DESC LIMIT $limite", limite=limite))


@st.cache_data(ttl=TTL)
def paginas_disputadas(horas: int = 24, limite: int = 15) -> pd.DataFrame:
    desde = (datetime.now(timezone.utc) - timedelta(hours=horas)).isoformat()
    return pd.DataFrame(_cypher(
        "MATCH (p:Pagina) WHERE p.ultima_edicion >= datetime($desde) "
        "MATCH (e:Editor)-[r:EDITO]->(p) "
        "WITH p, count(e) AS editores, sum(r.ediciones) AS ediciones, "
        "     sum(CASE WHEN e.tipo = 'bot' THEN 0 ELSE 1 END) AS humanos "
        "RETURN p.key AS pagina, editores, humanos, ediciones ORDER BY editores DESC LIMIT $limite",
        desde=desde, limite=limite))


@st.cache_data(ttl=TTL)
def ego_red(user: str, limite: int = 40) -> dict:
    """Vecindario de un editor: relaciones entre editores en ambos sentidos."""
    centro = _cypher("MATCH (e:Editor {user: $u}) RETURN e.user AS user, e.tipo AS tipo", u=user)
    rels = _cypher(
        "MATCH (e:Editor {user: $u})-[r:REVIRTIO|MENSAJE_A|AGRADECIO|BLOQUEO|COEDITA]-(o:Editor) "
        "RETURN startNode(r).user AS origen, endNode(r).user AS destino, type(r) AS tipo, "
        "       coalesce(r.veces, r.paginas_en_comun, 1) AS peso, o.user AS vecino, o.tipo AS tipo_vecino "
        "ORDER BY peso DESC LIMIT $limite", u=user, limite=limite)
    return {"centro": centro[0] if centro else None, "relaciones": rels}
