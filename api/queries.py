"""Consultas del dashboard a MongoDB, Cassandra y Neo4j (las mismas que usaba la versión Streamlit).

Las conexiones se crean una sola vez por proceso. Los resultados de lectura se guardan 60 s en
memoria, porque los datos cambian una vez por hora; las operaciones CRUD limpian esa caché.
"""

from __future__ import annotations

import re
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


# El dashboard muestra días y horas en UTC−5 (Perú, sin horario de verano). Las tablas guardan todo en UTC:
# un día en UTC−5 (00:00–23:59) va de las 05:00 UTC de esa fecha a las 04:59 UTC de la siguiente.
ZONA = timezone(timedelta(hours=-5))


def a_zona(fecha: date, hora: int) -> datetime:
    """Hora guardada en UTC como (fecha, hora) → la misma hora en UTC−5."""
    return datetime(fecha.year, fecha.month, fecha.day, hora, tzinfo=timezone.utc).astimezone(ZONA)


def fechas_utc(dia: date) -> tuple[date, date]:
    """Las dos fechas UTC que cubren un día en UTC−5."""
    return dia, dia + timedelta(days=1)


def _fechas(dias: int, hasta: date | None = None) -> list[date]:
    hasta = hasta or datetime.now(timezone.utc).date()
    return [hasta - timedelta(days=i) for i in range(dias)]


# ---------------------------------------------------------------- KPIs y resumen (Cassandra + Neo4j)

KPIS = [
    "eventos_procesados", "crecimiento_pct", "tasa_automatizacion_pct", "actividad_por_editor",
    "tasa_creacion_pct", "volumen_neto_bytes", "tasa_reversion_pct", "total_eventos_acumulados",
    "pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido", "calidad_datos_pct",
]


def completed_runs(horas: int = 72) -> list[dict]:
    return list(mongo_db().pipeline_runs.find(
        {"format_version": 2, "reprocessing": {"$ne": True}},
        {"window_start": 1, "window_end": 1, "window_start_dt": 1, "recorded_at": 1})
        .sort("window_start_dt", -1).limit(horas))


@cacheado
def kpis(horas: int = 72, wiki: str | None = None) -> dict:
    """Series alineadas exclusivamente con ventanas completadas del modelo actual."""
    runs = completed_runs(horas)
    out = {name: [] for name in KPIS}
    if not runs:
        return out
    start = datetime.fromisoformat(runs[-1]["window_start"])
    end = datetime.fromisoformat(runs[0]["window_end"])
    session = cassandra()
    for name in KPIS:
        if wiki is None:
            rows = session.execute("SELECT ventana, valor, detalle FROM kpis WHERE kpi = %s "
                                   "AND ventana >= %s AND ventana < %s", (name, start, end))
        else:
            rows = session.execute("SELECT ventana, valor, detalle FROM kpis_por_wiki WHERE kpi = %s AND wiki = %s "
                                   "AND ventana >= %s AND ventana < %s", (name, wiki, start, end))
        values = {r.ventana.replace(tzinfo=timezone.utc).isoformat(): r for r in rows}
        for run in runs:
            key = datetime.fromisoformat(run["window_start"]).astimezone(timezone.utc).isoformat()
            row = values.get(key)
            out[name].append({"ventana": key, "valor": row.valor if row else None, "detalle": row.detalle if row else None})
    # Si una reconstrucción comenzó durante las lecturas, se descarta esa ventana completa.
    current = {run["_id"]: run for run in mongo_db().pipeline_runs.find(
        {"_id": {"$in": [run["_id"] for run in runs]}, "reprocessing": {"$ne": True}}, {"recorded_at": 1})}
    stable = {datetime.fromisoformat(run["window_start"]).astimezone(timezone.utc).isoformat()
              for run in runs if run["_id"] in current and current[run["_id"]].get("recorded_at") == run.get("recorded_at")}
    out = {name: [point for point in points if point["ventana"] in stable] for name, points in out.items()}
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
    """Días (en UTC−5) con datos, del más reciente al más antiguo."""
    return sorted({a_zona(f["fecha"], f["hora"]).date().isoformat() for f in resumen_por_hora(dias=30)}, reverse=True)


@cacheado
def actividad_editor(editor: str, limite: int = 300) -> list[dict]:
    rows = cassandra().execute("SELECT * FROM actividad_editor WHERE editor = %s LIMIT %s", (editor, limite))
    return [_fila(r) for r in rows]


# ---------------------------------------------------------------- MongoDB


@cacheado
def total_eventos() -> int:
    return mongo_db().events.estimated_document_count()


CAMPO_TIPO = (("ediciones", "edit"), ("creaciones", "new"), ("categorizaciones", "categorize"), ("logs", "log"))


def tipos_por_wiki(horas: int = 24) -> list[dict]:
    """Eventos por wiki y tipo en las últimas `horas` horas cerradas. Sale de Cassandra (resumen_por_hora, ya agregado
    por hora y wiki): se suman ~24 filas por wiki en vez de agrupar cientos de miles de documentos en MongoDB."""
    limite = (datetime.now(timezone.utc) - timedelta(hours=horas)).strftime("%Y-%m-%dT%H")
    conteo: dict = defaultdict(int)
    for r in resumen_por_hora(2):
        if r["hora_utc"][:13] >= limite:
            for campo, tipo in CAMPO_TIPO:
                conteo[(r["wiki"], tipo)] += r.get(campo) or 0
    return [{"wiki": w, "tipo": t, "eventos": n} for (w, t), n in conteo.items()]


@cacheado
def buscar_eventos(wiki: str, tipo: str, editor: str, titulo: str, limite: int) -> list[dict]:
    filtro: dict = {}
    if wiki != "todas":
        filtro["wiki"] = wiki
    if tipo != "todos":
        filtro["type"] = tipo
    if editor:
        filtro["user"] = editor
    if titulo:
        filtro["title"] = {"$regex": titulo, "$options": "i"}
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


def crud_buscar(wiki: str, tipo: str, horas: int | None, editor: str, titulo: str, solo_demo: bool, event_id: str,
                antes: datetime | None, limite: int, antes_id: str = "") -> dict:
    """Búsqueda de la página CRUD (Consultar). Sin caché: tiene que ver lo que se acaba de crear o borrar.

    Con _id exacto se ignoran los demás filtros. El editor se busca por prefijo para aprovechar el
    índice por_editor; el título, por texto contenido (sin distinguir mayúsculas). "Ver más" pide los
    anteriores al par fecha e identificador del último documento (`antes`, `antes_id`), no un skip: el stream sigue
    insertando y un skip repetiría documentos.
    """
    if event_id:
        filtro: dict = {"_id": event_id}
        consulta = f'db.events.find({{ _id: "{event_id}" }})'
    else:
        filtro, partes = {"wiki": wiki}, [f'wiki: "{wiki}"']
        if tipo != "todos":
            filtro["type"] = tipo
            partes.append(f'type: "{tipo}"')
        if editor:
            filtro["user"] = {"$regex": "^" + re.escape(editor)}
            partes.append(f"user: /^{editor}/")
        if titulo:
            filtro["title"] = {"$regex": re.escape(titulo), "$options": "i"}
            partes.append(f"title: /{titulo}/i")
        if solo_demo:
            filtro["_id"] = {"$regex": "^demo-"}
            partes.append("_id: /^demo-/")
        fecha: dict = {}
        if horas:
            fecha["$gte"] = datetime.now(timezone.utc) - timedelta(hours=horas)
            partes.append(f'"derived.event_dt": {{ $gte: hace {horas} h }}')
        if antes and antes_id:
            filtro["$or"] = [{"derived.event_dt": {"$lt": antes}},
                              {"derived.event_dt": antes, "_id": {"$lt": antes_id}}]
        elif antes:
            fecha["$lt"] = antes
        if fecha:
            filtro["derived.event_dt"] = fecha
        consulta = f"db.events.find({{ {', '.join(partes)} }})"
    consulta += f'.sort({{ "derived.event_dt": -1, "_id": -1 }}).limit({limite})'
    inicio = time.perf_counter()
    proy = {"_id": 1, "derived": 1, "wiki": 1, "type": 1, "title": 1, "user": 1, "log_type": 1}
    docs = list(mongo_db().events.find(filtro, proy).sort([("derived.event_dt", -1), ("_id", -1)]).limit(limite + 1))
    ms = round((time.perf_counter() - inicio) * 1000)

    def resumen(d: dict) -> dict:
        der = d.get("derived") or {}
        fecha = der.get("event_dt")
        return {"_id": d["_id"], "fecha": fecha.replace(tzinfo=timezone.utc).isoformat() if fecha else None,
                "wiki": d.get("wiki"), "tipo": d.get("type"), "titulo": d.get("title"), "editor": d.get("user"),
                "log_type": d.get("log_type"), "revierte_a": der.get("revert_target")}

    return {"documentos": [resumen(d) for d in docs[:limite]], "hay_mas": len(docs) > limite, "consulta": consulta, "ms": ms}


# ---------------------------------------------------------------- En vivo (capa rápida)


def estado() -> dict:
    """Última hora consolidada por el DAG (Cassandra) y último evento guardado por el streaming (Mongo)."""
    runs = completed_runs(1)
    marcador = mongo_db().stream_state.find_one({"_id": "recentchange"}, {"last_dt": 1}) or {}
    return {
        "ahora": datetime.now(timezone.utc).isoformat(),
        "ultima_hora": runs[0]["window_start"] if runs else None,
        "stream_ultimo_evento": marcador.get("last_dt"),
    }


BORRADO_GRANDE = 1000  # bytes; igual que en web/src/lib/eventos.ts


def vivo(minutos: int = 30, wikis: list[str] | None = None) -> dict:
    """Actividad de los últimos minutos escrita por el servicio de streaming (sin caché)."""
    ahora = datetime.now(timezone.utc)
    wikis = wikis or sorted(config.WIKIS)
    s, por_minuto = cassandra(), []
    desde = (ahora - timedelta(minutes=minutos - 1)).replace(second=0, microsecond=0)
    for wiki in wikis:
        filas = []
        for f in (ahora.date(), ahora.date() - timedelta(days=1)):  # el día anterior, si cruzó la medianoche
            if len(filas) >= minutos:
                break
            filas += list(s.execute("SELECT * FROM eventos_por_minuto WHERE wiki = %s AND fecha = %s AND minuto >= %s AND minuto <= %s",
                                    (wiki, f, desde, ahora)))
        by_minute = {r.minuto.replace(tzinfo=timezone.utc): r for r in filas}
        for offset in range(minutos):
            minute = desde + timedelta(minutes=offset)
            row = by_minute.get(minute)
            por_minuto.append({"wiki": wiki, "t": minute.isoformat(),
                               **{key: (getattr(row, key) or 0) if row else 0 for key in
                                  ("eventos", "ediciones", "eventos_bot", "reversiones")}})
    db = mongo_db()
    hace_un_minuto = ahora - timedelta(seconds=60)
    proy = {"derived": 1, "wiki": 1, "type": 1, "title": 1, "user": 1, "comment": 1}
    ultimos = db.events.find({"wiki": {"$in": wikis}}, proy).sort("derived.event_dt", -1).limit(100)  # el dashboard filtra y muestra 25
    # Borrados grandes de la ventana: entre los últimos 100 casi nunca hay uno, así que se buscan aparte.
    borrados = db.events.find({"wiki": {"$in": wikis}, "derived.event_dt": {"$gte": desde, "$lt": ahora},
                               "derived.delta_bytes": {"$lte": -BORRADO_GRANDE}}, proy).sort("derived.event_dt", -1).limit(25)
    resumen = lambda d: {
        "_id": d["_id"], "fecha": d["derived"]["event_dt"].replace(tzinfo=timezone.utc).isoformat(),
        "wiki": d["wiki"], "tipo": d["type"], "titulo": d["title"], "editor": d["user"],
        "tipo_editor": d["derived"].get("user_type"), "delta_bytes": d["derived"].get("delta_bytes"),
        "revierte_a": d["derived"].get("revert_target"),
    }
    # Editores distintos de la ventana, por tipo: se agrupa por editor y luego por su tipo.
    editores = {r["_id"] or "registrado": r["n"] for r in db.events.aggregate([
        {"$match": {"wiki": {"$in": wikis}, "derived.event_dt": {"$gte": desde, "$lt": ahora}}},
        {"$group": {"_id": "$user", "tipo": {"$first": "$derived.user_type"}}},
        {"$group": {"_id": "$tipo", "n": {"$sum": 1}}}])}
    estado = db.stream_state.find_one({"_id": "recentchange"}) or {}
    return {
        "ahora": ahora.isoformat(), "inicio": desde.isoformat(), "fin": ahora.isoformat(), "provisional": True,
        "editores": editores,
        "eventos_ultimo_minuto": db.events.count_documents(
            {"derived.event_dt": {"$gte": hace_un_minuto, "$lt": ahora}, "wiki": {"$in": wikis}}),
        "por_minuto": sorted(por_minuto, key=lambda x: x["t"]),
        "ultimos": [resumen(d) for d in ultimos],
        "borrados": [resumen(d) for d in borrados],
        "stream": {
            "ultimo_evento": estado.get("last_dt"),
            "actualizado": estado["updated_at"].replace(tzinfo=timezone.utc).isoformat() if estado.get("updated_at") else None,
            "stats": estado.get("stats"),
        },
    }


# ---------------------------------------------------------------- Arquitectura


@cacheado
def primer_evento() -> str | None:
    """Fecha del evento más antiguo guardado en MongoDB (usa el índice por_fecha)."""
    d = mongo_db().events.find_one({}, {"derived.event_dt": 1}, sort=[("derived.event_dt", 1)])
    return d["derived"]["event_dt"].replace(tzinfo=timezone.utc).isoformat() if d else None


@cacheado
def arquitectura() -> dict:
    """Cifras en vivo para la página Arquitectura: volumen, ritmo, tipos, DAG y tamaño de cada base."""
    db = mongo_db()
    stats = db.command("collStats", "events")
    serie = kpis(24)
    eventos_h = [p["valor"] for p in serie.get("eventos_procesados", []) if p["valor"] is not None]
    calidad = [p["valor"] for p in serie.get("calidad_datos_pct", []) if p["valor"] is not None]
    # Mezcla de tipos de las últimas 24 h, de Cassandra (ya agregada por hora).
    tipos: dict = defaultdict(int)
    for t in tipos_por_wiki(24):
        tipos[t["tipo"]] += t["eventos"]
    desde = primer_evento()
    return {
        "mongo": {"eventos": total_eventos(), "desde": desde, "tamano_bytes": stats.get("size"),
                  "disco_bytes": stats.get("storageSize"), "indices": [ix["name"] for ix in db.events.list_indexes()]},
        "ritmo": {"promedio_hora": sum(eventos_h) / len(eventos_h) if eventos_h else None,
                  "min_hora": min(eventos_h, default=None), "max_hora": max(eventos_h, default=None), "horas": len(eventos_h)},
        "calidad_pct": calidad[0] if calidad else None,
        "tipos_24h": dict(tipos),
        "dag": {"corridas": cassandra().execute("SELECT count(*) FROM ejecuciones").one()[0], "ultimas": ejecuciones(2)[:6]},
        "grafo": conteo_grafo(),
        "stream": estado(),
    }


def ejemplo_evento(tipo: str | None = None) -> dict | None:
    """Un evento reciente al azar (de entre los últimos 50 del tipo pedido), para mostrar su estructura."""
    import random

    filtro = {"type": tipo} if tipo else {}
    return next(mongo_db().events.find(filtro).sort("derived.event_dt", -1).skip(random.randint(0, 49)).limit(1), None)


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


def _desde(horas: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=horas)).isoformat()


@cacheado
def tarjetas_red(horas: int = 24, wiki: str | None = None) -> dict:
    """Las tres tarjetas de la vista Red de editores: conflicto (N2) y comunidad (N5) en las últimas horas."""
    runs = completed_runs(1)
    hasta = runs[0]["window_end"] if runs else datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()
    desde = (datetime.fromisoformat(hasta) - timedelta(hours=horas)).isoformat()
    revertidos = _cypher(
        "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) WHERE r.ventana >= $desde AND r.ventana < $hasta AND ($wiki IS NULL OR r.wiki = $wiki) "
        "WITH b, count(DISTINCT a) AS por RETURN count(b) AS revertidos, sum(CASE WHEN por >= 2 THEN 1 ELSE 0 END) AS varios",
        desde=desde, hasta=hasta, wiki=wiki)[0]
    # Las reversiones ya están sumadas por hora en Cassandra: contarlas en MongoDB tardaría un minuto.
    wikis = [wiki] if wiki else sorted(config.WIKIS)
    limite = datetime.fromisoformat(desde)
    reversiones = sum(f["reversiones"] or 0 for f in resumen_por_hora(2)
                      if f["wiki"] in wikis and datetime.combine(f["fecha"], datetime.min.time(), timezone.utc)
                      + timedelta(hours=f["hora"]) >= limite
                      and datetime.combine(f["fecha"], datetime.min.time(), timezone.utc)
                      + timedelta(hours=f["hora"]) < datetime.fromisoformat(hasta))
    gracias = _cypher(
        "MATCH (a:Editor)-[r:AGRADECIO]->(b:Editor) WHERE r.ventana >= $desde AND r.ventana < $hasta AND ($wiki IS NULL OR r.wiki = $wiki) "
        "RETURN count(DISTINCT [a.user,b.user]) AS pares, count(DISTINCT b) AS agradecidos", desde=desde, hasta=hasta, wiki=wiki)[0]
    return {
        "horas": horas, "inicio": desde, "fin": hasta,
        "reversiones": reversiones,
        "editores_revertidos": revertidos["revertidos"],
        "revertidos_por_varios": revertidos["varios"],
        "pares_agradecimiento": gracias["pares"],
        "editores_agradecidos": gracias["agradecidos"],
    }


@cacheado
def ranking_conectados(limite: int = 10, horas: int = 24, wiki: str | None = None) -> list[dict]:
    """Coeditores humanos distintos sobre todo el historial, dentro de la wiki elegida."""
    return _cypher(
        "MATCH (e:Editor)-[r:EDITO]->(p:Pagina)<-[other:EDITO]-(b:Editor) "
        "WHERE r.tipo <> 'bot' AND other.tipo <> 'bot' AND e <> b AND ($wiki IS NULL OR p.wiki = $wiki) "
        "RETURN e.user AS editor, e.tipo AS tipo, count(DISTINCT b) AS coeditores "
        "ORDER BY coeditores DESC, editor LIMIT $limite", limite=limite, wiki=wiki)


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
    """Páginas con más reversiones recibidas en las últimas horas (tabla paginas_disputadas_por_hora)."""
    runs = completed_runs(1)
    end = datetime.fromisoformat(runs[0]["window_end"]) if runs else datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    limite_t = end - timedelta(hours=horas)
    s, suma = cassandra(), {}
    for w in ([wiki] if wiki else sorted(config.WIKIS)):
        for f in _fechas(2):
            for r in s.execute("SELECT * FROM paginas_disputadas_por_hora WHERE wiki = %s AND fecha = %s", (w, f)):
                when = datetime.combine(r.fecha.date(), datetime.min.time(), timezone.utc) + timedelta(hours=r.hora)
                if not limite_t <= when < end:
                    continue
                p = suma.setdefault((w, r.pagina), {"pagina": f"{w}:{r.pagina}", "wiki": w, "titulo": r.pagina,
                                                     "reversiones": 0, "ediciones": 0, "horas": 0})
                p["reversiones"] += r.reversiones or 0
                p["ediciones"] += r.ediciones or 0
                p["horas"] += 1
    return sorted(suma.values(), key=lambda p: (-p["reversiones"], -p["ediciones"]))[:limite]


@cacheado
def ego_red(user: str, limite: int = 30, wiki: str | None = None) -> dict:
    centro = _cypher("MATCH (e:Editor {user: $u}) RETURN e.user AS user, e.tipo AS tipo", u=user)
    rels = _cypher(
        "MATCH (e:Editor {user: $u})-[r:REVIRTIO|MENSAJE_A|AGRADECIO|BLOQUEO]-(o:Editor) "
        "WHERE $wiki IS NULL OR r.wiki = $wiki "
        "RETURN startNode(r).user AS origen, endNode(r).user AS destino, type(r) AS tipo, "
        "sum(coalesce(r.veces,1)) AS peso, o.user AS vecino, o.tipo AS tipo_vecino",
        u=user, wiki=wiki)
    coeditors = _cypher(
        "MATCH (e:Editor {user:$u})-[r:EDITO]->(p:Pagina)<-[other:EDITO]-(o:Editor) "
        "WHERE e <> o AND r.tipo <> 'bot' AND other.tipo <> 'bot' AND ($wiki IS NULL OR p.wiki=$wiki) "
        "RETURN e.user AS origen, o.user AS destino, 'COEDITA' AS tipo, count(DISTINCT p) AS peso, "
        "o.user AS vecino, o.tipo AS tipo_vecino", u=user, wiki=wiki)
    combined = sorted(rels + coeditors, key=lambda r: (-r["peso"], r["vecino"], r["tipo"]))[:limite]
    return {"centro": centro[0] if centro else None, "relaciones": combined}
