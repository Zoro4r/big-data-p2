"""Consultas del dashboard a MongoDB, Cassandra y Neo4j (las mismas que usaba la versión Streamlit).

Las conexiones se crean una sola vez por proceso. Los resultados de lectura se guardan 60 s en
memoria, porque los datos cambian una vez por hora; las operaciones CRUD limpian esa caché.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache, wraps

from cassandra.util import Date as CassDate

from wikipipe import cassandra_store, config, mongo, neo4j_store

TTL = 60
_cache: dict = {}


def cacheado(fn):
    """Guarda el resultado por argumentos durante TTL segundos."""
    @wraps(fn)
    def envoltura(*args, **kwargs):
        clave = (fn.__name__, args, tuple(sorted(kwargs.items())))
        hit = _cache.get(clave)
        if hit and time.monotonic() - hit[0] < TTL:
            return hit[1]
        valor = fn(*args, **kwargs)
        _cache[clave] = (time.monotonic(), valor)
        return valor
    return envoltura


def limpiar_cache() -> None:
    _cache.clear()


# ---------------------------------------------------------------- conexiones


@lru_cache(maxsize=1)
def mongo_db():
    return mongo.get_db()


@lru_cache(maxsize=1)
def cassandra():
    _, session = cassandra_store.connect()
    session.set_keyspace(config.CASSANDRA_KEYSPACE)
    return session


@lru_cache(maxsize=1)
def neo4j():
    return neo4j_store.connect()


def _fila(row) -> dict:
    return {k: (v.date() if isinstance(v, CassDate) else v) for k, v in row._asdict().items()}


def _cypher(query: str, **params) -> list[dict]:
    with neo4j().session() as s:
        return s.run(query, **params).data()


def _fechas(dias: int, hasta: date | None = None) -> list[date]:
    hasta = hasta or datetime.now(timezone.utc).date()
    return [hasta - timedelta(days=i) for i in range(dias)]


# ---------------------------------------------------------------- KPIs y resumen (Cassandra + Neo4j)

KPIS = [
    "eventos_procesados", "crecimiento_pct", "tasa_automatizacion_pct", "actividad_por_editor",
    "tasa_creacion_pct", "volumen_neto_bytes", "tasa_reversion_pct", "total_eventos_acumulados",
    "pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido", "calidad_datos_pct",
]


@cacheado
def kpis(horas: int = 72, wiki: str | None = None) -> dict:
    """Serie de cada KPI, de la hora más reciente a la más antigua. Sin wiki: ambas wikis juntas."""
    s, out = cassandra(), {}
    for kpi in KPIS:
        filas = s.execute("SELECT ventana, valor, detalle FROM kpis WHERE kpi = %s LIMIT %s", (kpi, horas)) if wiki is None \
            else s.execute("SELECT ventana, valor, detalle FROM kpis_por_wiki WHERE kpi = %s AND wiki = %s LIMIT %s", (kpi, wiki, horas))
        out[kpi] = [{"ventana": r.ventana.replace(tzinfo=timezone.utc).isoformat(), "valor": r.valor, "detalle": r.detalle}
                    for r in filas]
    return out


@cacheado
def resumen_por_hora(dias: int = 2) -> list[dict]:
    """Una fila por (hora, wiki) de los últimos días."""
    s, filas = cassandra(), []
    for f in _fechas(dias):
        for r in s.execute("SELECT * FROM resumen_por_hora WHERE fecha = %s", (f,)):
            d = _fila(r)
            d["hora_utc"] = f"{r.fecha}T{r.hora:02d}:00:00Z"
            filas.append(d)
    return sorted(filas, key=lambda x: x["hora_utc"])


@cacheado
def ejecuciones(dias: int = 2) -> list[dict]:
    s, filas = cassandra(), []
    for f in _fechas(dias):
        filas += [_fila(r) for r in s.execute("SELECT * FROM ejecuciones WHERE fecha = %s", (f,))]
    for f in filas:
        f["ventana"] = f["ventana"].replace(tzinfo=timezone.utc).isoformat()
    return sorted(filas, key=lambda x: x["ventana"], reverse=True)


@cacheado
def serie_10min(wiki: str, fecha: date) -> list[dict]:
    """Eventos por bloques de 10 minutos de un día (desde eventos_por_minuto)."""
    bloques = defaultdict(lambda: {"eventos": 0, "eventos_bot": 0, "reversiones": 0})
    for r in cassandra().execute("SELECT * FROM eventos_por_minuto WHERE wiki = %s AND fecha = %s", (wiki, fecha)):
        m = r.minuto.replace(minute=r.minuto.minute // 10 * 10, second=0, microsecond=0)
        b = bloques[m]
        b["eventos"] += r.eventos
        b["eventos_bot"] += r.eventos_bot
        b["reversiones"] += r.reversiones
    return [{"t": k.replace(tzinfo=timezone.utc).isoformat(), **v} for k, v in sorted(bloques.items())]


@cacheado
def serie_minuto(wiki: str, fecha: date) -> list[dict]:
    rows = cassandra().execute("SELECT * FROM eventos_por_minuto WHERE wiki = %s AND fecha = %s", (wiki, fecha))
    return sorted(({"t": r.minuto.replace(tzinfo=timezone.utc).isoformat(), "eventos": r.eventos,
                    "eventos_bot": r.eventos_bot, "reversiones": r.reversiones} for r in rows), key=lambda x: x["t"])


@cacheado
def paginas_top(wiki: str, fecha: date) -> list[dict]:
    rows = cassandra().execute("SELECT * FROM paginas_top_por_hora WHERE wiki = %s AND fecha = %s", (wiki, fecha))
    return [_fila(r) for r in rows]


@cacheado
def fechas_con_datos() -> list[str]:
    return sorted({f["fecha"].isoformat() for f in resumen_por_hora(dias=30)}, reverse=True)


@cacheado
def actividad_editor(editor: str, limite: int = 300) -> list[dict]:
    rows = cassandra().execute("SELECT * FROM actividad_editor WHERE editor = %s LIMIT %s", (editor, limite))
    return [_fila(r) for r in rows]


# ---------------------------------------------------------------- MongoDB


@cacheado
def total_eventos() -> int:
    return mongo_db().events.estimated_document_count()


@cacheado
def tipos_por_wiki(horas: int = 24) -> list[dict]:
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    pipeline = [
        {"$match": {"derived.event_dt": {"$gte": desde}}},
        {"$group": {"_id": {"wiki": "$wiki", "tipo": "$type"}, "eventos": {"$sum": 1}}},
    ]
    return [{"wiki": r["_id"]["wiki"], "tipo": r["_id"]["tipo"], "eventos": r["eventos"]}
            for r in mongo_db().events.aggregate(pipeline)]


@cacheado
def buscar_eventos(wiki: str, tipo: str, editor: str, titulo: str, solo_reversiones: bool, limite: int) -> list[dict]:
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
    proy = {"_id": 1, "derived": 1, "wiki": 1, "type": 1, "title": 1, "user": 1, "comment": 1}
    docs = mongo_db().events.find(filtro, proy).sort("derived.event_dt", -1).limit(limite)
    return [{
        "_id": d["_id"], "fecha": d["derived"]["event_dt"].replace(tzinfo=timezone.utc).isoformat(),
        "wiki": d["wiki"], "tipo": d["type"], "titulo": d["title"], "editor": d["user"],
        "tipo_editor": d["derived"].get("user_type"), "delta_bytes": d["derived"].get("delta_bytes"),
        "revierte_a": d["derived"].get("revert_target"), "comentario": d.get("comment"),
    } for d in docs]


def documento(event_id: str) -> dict | None:
    return mongo_db().events.find_one({"_id": event_id})


# ---------------------------------------------------------------- En vivo (capa rápida)


def estado() -> dict:
    """Última hora consolidada por el DAG (Cassandra) y último evento guardado por el streaming (Mongo)."""
    fila = cassandra().execute("SELECT ventana FROM kpis WHERE kpi = 'eventos_procesados' LIMIT 1").one()
    marcador = mongo_db().stream_state.find_one({"_id": "recentchange"}, {"last_dt": 1}) or {}
    return {
        "ahora": datetime.now(timezone.utc).isoformat(),
        "ultima_hora": fila.ventana.replace(tzinfo=timezone.utc).isoformat() if fila else None,
        "stream_ultimo_evento": marcador.get("last_dt"),
    }


def vivo(minutos: int = 30, wikis: list[str] | None = None) -> dict:
    """Actividad de los últimos minutos escrita por el servicio de streaming (sin caché)."""
    ahora = datetime.now(timezone.utc)
    wikis = wikis or sorted(config.WIKIS)
    s, por_minuto = cassandra(), []
    for wiki in wikis:
        filas = []
        for f in (ahora.date(), ahora.date() - timedelta(days=1)):  # el día anterior, si cruzó la medianoche
            if len(filas) >= minutos:
                break
            filas += list(s.execute("SELECT * FROM eventos_por_minuto WHERE wiki = %s AND fecha = %s LIMIT %s",
                                    (wiki, f, minutos - len(filas))))
        por_minuto += [{"wiki": wiki, "t": r.minuto.replace(tzinfo=timezone.utc).isoformat(), "eventos": r.eventos,
                        "ediciones": r.ediciones, "eventos_bot": r.eventos_bot, "reversiones": r.reversiones}
                       for r in filas]
    db = mongo_db()
    hace_un_minuto = ahora - timedelta(seconds=60)
    ultimos = db.events.find({"wiki": {"$in": wikis}}, {"derived": 1, "wiki": 1, "type": 1, "title": 1, "user": 1, "comment": 1}) \
        .sort("derived.event_dt", -1).limit(100)  # el dashboard filtra y muestra 25
    estado = db.stream_state.find_one({"_id": "recentchange"}) or {}
    return {
        "ahora": ahora.isoformat(),
        "eventos_ultimo_minuto": db.events.count_documents(
            {"derived.event_dt": {"$gte": hace_un_minuto}, "wiki": {"$in": wikis}}),
        "por_minuto": sorted(por_minuto, key=lambda x: x["t"]),
        "ultimos": [{
            "_id": d["_id"], "fecha": d["derived"]["event_dt"].replace(tzinfo=timezone.utc).isoformat(),
            "wiki": d["wiki"], "tipo": d["type"], "titulo": d["title"], "editor": d["user"],
            "tipo_editor": d["derived"].get("user_type"), "delta_bytes": d["derived"].get("delta_bytes"),
            "revierte_a": d["derived"].get("revert_target"),
        } for d in ultimos],
        "stream": {
            "ultimo_evento": estado.get("last_dt"),
            "actualizado": estado["updated_at"].replace(tzinfo=timezone.utc).isoformat() if estado.get("updated_at") else None,
            "stats": estado.get("stats"),
        },
    }


# ---------------------------------------------------------------- Neo4j


@cacheado
def conteo_grafo_wiki(wiki: str) -> dict | None:
    """Totales del grafo de una wiki: los calcula el DAG cada hora (ver neo4j_store.conteo_por_wiki)."""
    run = mongo_db().pipeline_runs.find_one({"grafo_por_wiki": {"$exists": True}}, {"grafo_por_wiki": 1, "window_start": 1},
                                            sort=[("window_start_dt", -1)])
    if not run or wiki not in run["grafo_por_wiki"]:
        return None
    return {**run["grafo_por_wiki"][wiki], "ventana": run["window_start"]}


def conteo_grafo() -> dict:
    # Con la etiqueta o el tipo escritos en la consulta, Neo4j usa sus contadores internos.
    nodos = {lb: _cypher(f"MATCH (n:{lb}) RETURN count(n) AS n")[0]["n"]
             for lb in ("Editor", "Pagina", "Categoria", "Wiki")}
    rels = {t: _cypher(f"MATCH ()-[r:{t}]->() RETURN count(r) AS n")[0]["n"]
            for t in ("EDITO", "CREO", "SUBIO", "REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO",
                      "COEDITA", "MOVIDA_A", "PERTENECE_A", "EN_CATEGORIA")}
    return {"nodos": nodos, "relaciones": rels}


@cacheado
def ranking_revertidos(limite: int = 10, wiki: str | None = None) -> list[dict]:
    return _cypher(
        "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) WHERE $wiki IS NULL OR r.wiki = $wiki "
        "RETURN b.user AS editor, b.tipo AS tipo, sum(r.veces) AS reversiones, count(DISTINCT a) AS revertido_por "
        "ORDER BY reversiones DESC, revertido_por DESC LIMIT $limite", limite=limite, wiki=wiki)


@cacheado
def ranking_patrulleros(limite: int = 10, wiki: str | None = None) -> list[dict]:
    return _cypher(
        "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) WHERE $wiki IS NULL OR r.wiki = $wiki "
        "RETURN a.user AS editor, a.tipo AS tipo, sum(r.veces) AS reversiones, count(DISTINCT b) AS editores_revertidos "
        "ORDER BY reversiones DESC LIMIT $limite", limite=limite, wiki=wiki)


@cacheado
def paginas_disputadas(horas: int = 24, limite: int = 12, wiki: str | None = None) -> list[dict]:
    desde = (datetime.now(timezone.utc) - timedelta(hours=horas)).isoformat()
    return _cypher(
        "MATCH (p:Pagina) WHERE p.ultima_edicion >= datetime($desde) AND ($wiki IS NULL OR p.wiki = $wiki) "
        "MATCH (e:Editor)-[r:EDITO]->(p) "
        "WITH p, count(e) AS editores, sum(r.ediciones) AS ediciones, "
        "     sum(CASE WHEN e.tipo = 'bot' THEN 0 ELSE 1 END) AS humanos "
        "RETURN p.key AS pagina, p.wiki AS wiki, p.titulo AS titulo, editores, humanos, ediciones "
        "ORDER BY editores DESC LIMIT $limite", desde=desde, limite=limite, wiki=wiki)


@cacheado
def ego_red(user: str, limite: int = 30) -> dict:
    centro = _cypher("MATCH (e:Editor {user: $u}) RETURN e.user AS user, e.tipo AS tipo", u=user)
    rels = _cypher(
        "MATCH (e:Editor {user: $u})-[r:REVIRTIO|MENSAJE_A|AGRADECIO|BLOQUEO|COEDITA]-(o:Editor) "
        "RETURN startNode(r).user AS origen, endNode(r).user AS destino, type(r) AS tipo, "
        "       coalesce(r.veces, r.paginas_en_comun, 1) AS peso, o.user AS vecino, o.tipo AS tipo_vecino "
        "ORDER BY peso DESC LIMIT $limite", u=user, limite=limite)
    return {"centro": centro[0] if centro else None, "relaciones": rels}
