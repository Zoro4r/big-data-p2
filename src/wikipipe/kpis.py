"""Cálculo de los KPIs de cada ventana horaria. Cada KPI se calcula en la base que mejor lo responde.

| KPI                        | Fuente    | Fórmula                                              |
| eventos_procesados         | Cassandra | suma de eventos de la hora                           |
| crecimiento_pct            | Cassandra | (eventos h − eventos h−1) / eventos h−1 × 100        |
| tasa_automatizacion_pct    | Cassandra | eventos de bots / eventos × 100                      |
| actividad_por_editor       | MongoDB | eventos humanos / editores humanos                   |
| tasa_creacion_pct          | MongoDB   | new / (edit + new) × 100                             |
| volumen_neto_bytes         | MongoDB   | Σ (length.new − length.old)                          |
| tasa_reversion_pct         | MongoDB   | ediciones que revierten a otro editor / ediciones × 100 |
| total_eventos_acumulados   | MongoDB   | documentos en events con fecha anterior al fin de la ventana |
| pagina_mas_disputada       | Cassandra | página que más reversiones recibió en la hora          |
| editor_mas_conectado       | Neo4j     | editor humano con más coeditores de esa hora |
| editor_mas_revertido       | Neo4j     | editor con más reversiones recibidas en la hora |
| calidad_datos_pct          | limpieza  | eventos válidos / eventos extraídos × 100            |

Cada KPI se guarda como (valor, detalle); el detalle lleva el nombre de la entidad cuando aplica.
Se calculan para ambas wikis juntas (wiki=None) y para cada wiki por separado.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from wikipipe import config

log = logging.getLogger(__name__)


def _pct(num, den):
    return round(100 * num / den, 2) if den else None


def _hour_totals(session, start: datetime, wiki: str | None = None) -> dict | None:
    rows = [r for r in session.execute(
        "SELECT * FROM resumen_por_hora WHERE fecha = %s AND hora = %s", (start.date(), start.hour))
        if wiki is None or r.wiki == wiki]
    if not rows:
        return None
    fields = ("eventos", "ediciones", "creaciones", "eventos_bot", "eventos_humanos", "editores_humanos", "reversiones")
    return {f: sum(getattr(r, f) or 0 for r in rows) for f in fields}


def from_cassandra(session, start: datetime, wiki: str | None = None) -> dict:
    now, prev = _hour_totals(session, start, wiki), _hour_totals(session, start - timedelta(hours=1), wiki)
    if not now:
        return {}
    growth = _pct(now["eventos"] - prev["eventos"], prev["eventos"]) if prev else None
    growth_detail = None
    if not prev:
        growth_detail = "Sin hora anterior"
    elif not prev["eventos"]:
        growth_detail = "Hora anterior sin eventos"
    return {
        "eventos_procesados": (now["eventos"], None),
        "crecimiento_pct": (growth, growth_detail),
        "tasa_automatizacion_pct": (_pct(now["eventos_bot"], now["eventos"]), None),
        "actividad_por_editor": (
            round(now["eventos_humanos"] / now["editores_humanos"], 2) if now["editores_humanos"] else None, None),
        "pagina_mas_disputada": _pagina_disputada(session, start, wiki),
    }


def _pagina_disputada(session, start: datetime, wiki: str | None = None) -> tuple:
    """La página que más reversiones recibió en la hora (tabla paginas_disputadas_por_hora)."""
    mejor = None
    for w in ([wiki] if wiki else sorted(config.WIKIS)):
        fila = session.execute(
            "SELECT pagina, reversiones FROM paginas_disputadas_por_hora WHERE wiki = %s AND fecha = %s AND hora = %s LIMIT 1",
            (w, start.date(), start.hour)).one()
        if fila and (mejor is None or fila.reversiones > mejor[0]):
            mejor = (fila.reversiones, f"{w}:{fila.pagina}")
    return mejor if mejor else (None, None)


def from_mongo(db, start: datetime, end: datetime, wiki: str | None = None) -> dict:
    wikis = [wiki] if wiki else sorted(config.WIKIS)
    pipeline = [
        {"$match": {"wiki": {"$in": wikis}, "type": {"$in": ["edit", "new"]},
                    "derived.event_dt": {"$gte": start, "$lt": end}}},
        {"$group": {
            "_id": None,
            "ediciones": {"$sum": 1},
            "solo_ediciones": {"$sum": {"$cond": [{"$eq": ["$type", "edit"]}, 1, 0]}},
            "creaciones": {"$sum": {"$cond": [{"$eq": ["$type", "new"]}, 1, 0]}},
            "reversiones": {"$sum": {"$cond": [{"$and": [{"$eq": ["$type", "edit"]}, {"$ifNull": ["$derived.revert_target", False]}]}, 1, 0]}},
            "delta": {"$sum": "$derived.delta_bytes"},
        }},
    ]
    agg = next(db.events.aggregate(pipeline), None) or {"ediciones": 0, "solo_ediciones": 0, "creaciones": 0, "reversiones": 0, "delta": 0}
    return {
        "tasa_creacion_pct": (_pct(agg["creaciones"], agg["ediciones"]),
                              f"{agg['creaciones']:,} páginas nuevas de {agg['ediciones']:,} ediciones y creaciones"),
        "volumen_neto_bytes": (agg["delta"], None),
        "tasa_reversion_pct": (_pct(agg["reversiones"], agg["solo_ediciones"]), f"{agg['reversiones']} reversiones"),
        # Hasta el fin de la ventana: la capa de streaming ya guardó eventos posteriores.
        "total_eventos_acumulados": (
            db.events.count_documents({"wiki": {"$in": wikis}, "derived.event_dt": {"$lt": end}}), None),
    }


Q_CONECTADO = """
MATCH (e:Editor)-[r:EDITO]->(p:Pagina)<-[other:EDITO]-(b:Editor)
WHERE r.ventana >= $start AND r.ventana < $end
  AND other.ventana >= $start AND other.ventana < $end
  AND r.tipo <> 'bot' AND other.tipo <> 'bot' AND e <> b
  AND ($wiki IS NULL OR p.wiki = $wiki)
WITH e, count(DISTINCT b) AS coeditores
RETURN e.user AS nombre, coeditores AS valor ORDER BY valor DESC, nombre LIMIT 1
"""
Q_REVERTIDO = """
MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor)
WHERE r.ventana >= $start AND r.ventana < $end AND ($wiki IS NULL OR r.wiki = $wiki)
WITH b, sum(r.veces) AS reversiones, count(DISTINCT a) AS patrulleros
RETURN b.user AS nombre, reversiones AS valor, patrulleros
ORDER BY valor DESC, patrulleros DESC, nombre LIMIT 1
"""


def from_neo4j(driver, start: datetime, wiki: str | None = None, end: datetime | None = None) -> dict:
    out = {}
    end = end or start + timedelta(hours=1)
    with driver.session() as session:
        for kpi, query in (("editor_mas_conectado", Q_CONECTADO), ("editor_mas_revertido", Q_REVERTIDO)):
            rec = session.run(query, start=start.isoformat(), end=end.isoformat(), wiki=wiki).single()
            if rec is None:
                out[kpi] = (None, None)
            elif kpi == "editor_mas_revertido":
                n = rec["patrulleros"]
                out[kpi] = (rec["valor"], f"{rec['nombre']} (revertido por {n} {'editor' if n == 1 else 'editores'})")
            else:
                out[kpi] = (rec["valor"], rec["nombre"])
    return out


def compute(start: datetime, end: datetime, clean_stats: dict, cass_session, mongo_db, neo_driver,
            wiki: str | None = None) -> dict:
    """KPIs de la ventana; wiki=None calcula sobre ambas wikis juntas."""
    calidad = clean_stats.get("quality_pct") if wiki is None else \
        (clean_stats.get("quality_by_wiki") or {}).get(wiki)
    kpis = {"calidad_datos_pct": (calidad, None)}
    kpis.update(from_cassandra(cass_session, start, wiki))
    kpis.update(from_mongo(mongo_db, start, end, wiki))
    kpis.update(from_neo4j(neo_driver, start, wiki, end))
    result = next(mongo_db.events.aggregate([
        {"$match": {"wiki": {"$in": [wiki] if wiki else sorted(config.WIKIS)}, "derived.event_dt": {"$gte": start, "$lt": end},
                    "derived.user_type": {"$ne": "bot"}}},
        {"$group": {"_id": "$user", "eventos": {"$sum": 1}}},
        {"$group": {"_id": None, "editores": {"$sum": 1}, "eventos": {"$sum": "$eventos"}}},
    ]), None)
    kpis["actividad_por_editor"] = (round(result["eventos"] / result["editores"], 2) if result else None, None)
    log.info("KPIs de %s (%s): %s", start.isoformat(), wiki or "ambas", kpis)
    return kpis


def refresh_following(db, session, start: datetime) -> None:
    """Propaga una corrección a los acumulados posteriores y al crecimiento de la siguiente hora."""
    from wikipipe import cassandra_store

    runs = db.pipeline_runs.find({"format_version": 2, "reprocessing": {"$ne": True},
                                 "window_start_dt": {"$gt": start}}, {"window_start": 1, "window_end": 1})
    for run in runs:
        following = datetime.fromisoformat(run["window_start"])
        end = datetime.fromisoformat(run["window_end"])
        changes = {}
        for wiki in [None, *sorted(config.WIKIS)]:
            query = {"wiki": {"$in": [wiki] if wiki else sorted(config.WIKIS)}, "derived.event_dt": {"$lt": end}}
            values = {"total_eventos_acumulados": (db.events.count_documents(query), None)}
            if following == start + timedelta(hours=1):
                growth = from_cassandra(session, following, wiki).get("crecimiento_pct")
                if growth:
                    values["crecimiento_pct"] = growth
            cassandra_store.write_kpis(session, following, values, wiki)
            prefix = f"kpis_por_wiki.{wiki}" if wiki else "kpis"
            for name, (value, detail) in values.items():
                changes[f"{prefix}.{name}"] = {"valor": value, "detalle": detail}
        db.pipeline_runs.update_one({"_id": run["_id"]}, {"$set": changes})


def rellenar_por_wiki() -> None:
    """Calcula los KPIs por wiki de las ventanas ya procesadas antes de existir `kpis_por_wiki`.

    Los de Cassandra y MongoDB salen exactos (se filtran por fecha). La calidad se recalcula
    desde el archivo crudo de cada ventana. Los de Neo4j usan las contribuciones temporales del modelo 2 para cada ventana.
    Uso: python -m wikipipe.kpis
    """
    import tempfile
    from pathlib import Path

    from wikipipe import cassandra_store, mongo, neo4j_store
    from wikipipe.clean import clean_file
    from wikipipe.extract import raw_path_for

    db, driver = mongo.get_db(), neo4j_store.connect()
    cluster, session = cassandra_store.connect()
    try:
        cassandra_store.ensure_schema(session)
        session.set_keyspace(config.CASSANDRA_KEYSPACE)
        ventanas = sorted(r.ventana for r in session.execute(
            "SELECT ventana FROM kpis WHERE kpi = 'eventos_procesados'"))
        log.info("Ventanas a rellenar: %d", len(ventanas))
        for i, v in enumerate(ventanas):
            start = v.replace(tzinfo=timezone.utc)
            end = start + timedelta(hours=1)
            calidad = {}
            raw = raw_path_for(start)
            if raw.exists():
                with tempfile.TemporaryDirectory() as tmp:
                    calidad = clean_file(raw, Path(tmp) / "c.gz", Path(tmp) / "r.gz").get("quality_by_wiki", {})
            for wiki in sorted(config.WIKIS):
                valores = {"calidad_datos_pct": (calidad.get(wiki), None)}
                valores.update(from_cassandra(session, start, wiki))
                valores.update(from_mongo(db, start, end, wiki))
                valores.update(from_neo4j(driver, start, wiki, end))
                valores = {k: x for k, x in valores.items() if x[0] is not None or k == "crecimiento_pct"}
                cassandra_store.write_kpis(session, start, valores, wiki)
            print(f"{start:%Y-%m-%d %H:%M} listo ({i + 1}/{len(ventanas)})", flush=True)
        # Totales del grafo por wiki en la última ejecución (luego los agrega el DAG cada hora)
        if ventanas:
            db.pipeline_runs.update_one({"_id": ventanas[-1].replace(tzinfo=timezone.utc).isoformat()},
                                        {"$set": {"grafo_por_wiki": neo4j_store.conteo_por_wiki(driver)}})
    finally:
        cluster.shutdown()
        driver.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    rellenar_por_wiki()
