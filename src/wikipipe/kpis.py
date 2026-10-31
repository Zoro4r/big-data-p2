"""Cálculo de los KPIs de cada ventana horaria. Cada KPI se calcula en la base que mejor lo responde.

| KPI                        | Fuente    | Fórmula                                              |
| eventos_procesados         | Cassandra | suma de eventos de la hora                           |
| crecimiento_pct            | Cassandra | (eventos h − eventos h−1) / eventos h−1 × 100        |
| tasa_automatizacion_pct    | Cassandra | eventos de bots / eventos × 100                      |
| actividad_por_editor       | Cassandra | eventos humanos / editores humanos                   |
| tasa_creacion_pct          | MongoDB   | new / (edit + new) × 100                             |
| volumen_neto_bytes         | MongoDB   | Σ (length.new − length.old)                          |
| tasa_reversion_pct         | MongoDB   | ediciones que revierten a otro editor / ediciones × 100 |
| total_eventos_acumulados   | MongoDB   | documentos en la colección events                    |
| pagina_mas_disputada       | Neo4j     | página editada en la hora con más editores distintos (histórico) |
| editor_mas_conectado       | Neo4j     | editor humano activo en la hora con más relaciones COEDITA |
| editor_mas_revertido       | Neo4j     | editor con más reversiones recibidas, entre los revertidos en la hora |
| calidad_datos_pct          | limpieza  | eventos válidos / eventos extraídos × 100            |

Cada KPI se guarda como (valor, detalle); el detalle lleva el nombre de la entidad cuando aplica.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)


def _pct(num, den):
    return round(100 * num / den, 2) if den else None


def _hour_totals(session, start: datetime) -> dict | None:
    rows = list(session.execute(
        "SELECT * FROM resumen_por_hora WHERE fecha = %s AND hora = %s", (start.date(), start.hour)))
    if not rows:
        return None
    fields = ("eventos", "ediciones", "creaciones", "eventos_bot", "eventos_humanos", "editores_humanos", "reversiones")
    return {f: sum(getattr(r, f) or 0 for r in rows) for f in fields}


def from_cassandra(session, start: datetime) -> dict:
    now, prev = _hour_totals(session, start), _hour_totals(session, start - timedelta(hours=1))
    if not now:
        return {}
    growth = _pct(now["eventos"] - prev["eventos"], prev["eventos"]) if prev else None
    return {
        "eventos_procesados": (now["eventos"], None),
        "crecimiento_pct": (growth, None if prev else "sin hora anterior"),
        "tasa_automatizacion_pct": (_pct(now["eventos_bot"], now["eventos"]), None),
        "actividad_por_editor": (
            round(now["eventos_humanos"] / now["editores_humanos"], 2) if now["editores_humanos"] else None, None),
    }


def from_mongo(db, start: datetime, end: datetime) -> dict:
    pipeline = [
        {"$match": {"derived.event_dt": {"$gte": start, "$lt": end}, "type": {"$in": ["edit", "new"]}}},
        {"$group": {
            "_id": None,
            "ediciones": {"$sum": 1},
            "creaciones": {"$sum": {"$cond": [{"$eq": ["$type", "new"]}, 1, 0]}},
            "reversiones": {"$sum": {"$cond": [{"$ifNull": ["$derived.revert_target", False]}, 1, 0]}},
            "delta": {"$sum": "$derived.delta_bytes"},
        }},
    ]
    agg = next(db.events.aggregate(pipeline), None) or {"ediciones": 0, "creaciones": 0, "reversiones": 0, "delta": 0}
    return {
        "tasa_creacion_pct": (_pct(agg["creaciones"], agg["ediciones"]), None),
        "volumen_neto_bytes": (agg["delta"], None),
        "tasa_reversion_pct": (_pct(agg["reversiones"], agg["ediciones"]), f"{agg['reversiones']} reversiones"),
        "total_eventos_acumulados": (db.events.estimated_document_count(), None),
    }


Q_PAGINA = """
MATCH (p:Pagina) WHERE p.ultima_edicion >= datetime($start)
MATCH (e:Editor)-[:EDITO]->(p)
WITH p, count(e) AS editores ORDER BY editores DESC LIMIT 1
RETURN p.key AS nombre, editores AS valor
"""
Q_CONECTADO = """
MATCH (e:Editor) WHERE e.ultima_actividad >= datetime($start) AND e.tipo <> 'bot'
WITH e, COUNT { (e)-[:COEDITA]-() } AS coeditores
WHERE coeditores > 0
RETURN e.user AS nombre, coeditores AS valor ORDER BY valor DESC LIMIT 1
"""
Q_REVERTIDO = """
MATCH (:Editor)-[r:REVIRTIO]->(b:Editor) WHERE r.ultima_vez >= datetime($start)
WITH DISTINCT b
MATCH (a:Editor)-[r:REVIRTIO]->(b)
WITH b, sum(r.veces) AS reversiones, count(DISTINCT a) AS patrulleros
RETURN b.user AS nombre, reversiones AS valor, patrulleros ORDER BY valor DESC, patrulleros DESC LIMIT 1
"""


def from_neo4j(driver, start: datetime) -> dict:
    out = {}
    with driver.session() as session:
        for kpi, query in (("pagina_mas_disputada", Q_PAGINA), ("editor_mas_conectado", Q_CONECTADO),
                           ("editor_mas_revertido", Q_REVERTIDO)):
            rec = session.run(query, start=start.isoformat()).single()
            if rec is None:
                out[kpi] = (None, None)
            elif kpi == "editor_mas_revertido":
                n = rec["patrulleros"]
                out[kpi] = (rec["valor"], f"{rec['nombre']} (revertido por {n} {'editor' if n == 1 else 'editores'})")
            else:
                out[kpi] = (rec["valor"], rec["nombre"])
    return out


def compute(start: datetime, end: datetime, clean_stats: dict, cass_session, mongo_db, neo_driver) -> dict:
    kpis = {"calidad_datos_pct": (clean_stats.get("quality_pct"), None)}
    kpis.update(from_cassandra(cass_session, start))
    kpis.update(from_mongo(mongo_db, start, end))
    kpis.update(from_neo4j(neo_driver, start))
    log.info("KPIs de %s: %s", start.isoformat(), kpis)
    return kpis
