"""MongoDB: guarda los eventos completos (documentos semiestructurados) y el registro de ejecuciones.

MongoDB es la fuente de verdad del pipeline: Cassandra y Neo4j leen de aquí la ventana de cada hora.
La carga usa upserts por `_id` (= meta.id), así que re-ejecutar una hora no duplica documentos.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient, ReplaceOne
from pymongo.database import Database

from wikipipe import config
from wikipipe.clean import read_events

log = logging.getLogger(__name__)
BATCH = 1000


def get_db() -> Database:
    return MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=10_000)[config.MONGO_DB]


def ensure_schema(db: Database) -> None:
    """Crea las colecciones, el validador y los índices definidos en db/mongo/schema.json."""
    spec = json.loads((config.DB_DIR / "mongo" / "schema.json").read_text())
    existing = set(db.list_collection_names())
    for name, coll in spec["collections"].items():
        validator = coll.get("validator")
        if name not in existing:
            db.create_collection(name, **({"validator": validator, "validationLevel": "moderate"} if validator else {}))
        elif validator:
            db.command("collMod", name, validator=validator, validationLevel="moderate")
        for index in coll.get("indexes", []):
            db[name].create_index(
                [tuple(k) for k in index["keys"]], name=index["name"], sparse=index.get("sparse", False)
            )


def sanitize(value):
    """MongoDB no acepta claves que empiezan con '$' ni que contienen '.' (p. ej. "$schema")."""
    if isinstance(value, dict):
        return {k.replace(".", "_").lstrip("$") or "_": sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    return value


def to_document(event: dict) -> dict:
    doc = sanitize(event)
    doc["derived"]["event_dt"] = datetime.fromisoformat(doc["derived"]["event_time"].replace("Z", "+00:00"))
    return doc


def load_events(db: Database, clean_path: Path, rejected_path: Path | None = None) -> dict:
    """Inserta o reemplaza los eventos limpios de un archivo. Devuelve cuántos fueron nuevos."""
    ensure_schema(db)
    stats = {"processed": 0, "inserted": 0, "updated": 0, "rejected_stored": 0}
    ops = []

    def flush():
        if ops:
            result = db.events.bulk_write(ops, ordered=False)
            stats["inserted"] += result.upserted_count
            stats["updated"] += result.matched_count
            ops.clear()

    for event in read_events(clean_path):
        ops.append(ReplaceOne({"_id": event["_id"]}, to_document(event), upsert=True))
        stats["processed"] += 1
        if len(ops) >= BATCH:
            flush()
    flush()

    if rejected_path and rejected_path.exists():
        rejected_ops = []
        for row in read_events(rejected_path):
            # Mismo criterio de idempotencia: el id del evento, o un hash si el evento no lo tiene.
            meta = (row.get("event") or {}).get("meta") or {}
            row_id = meta.get("id") or hashlib.sha1(json.dumps(row, sort_keys=True).encode()).hexdigest()
            doc = {"_id": row_id, **sanitize(row)}
            # Fecha del evento, para leer los rechazados de una hora (la usa fuente.volcar_desde_mongo).
            try:
                doc["ventana_dt"] = datetime.fromisoformat(str(meta.get("dt")).replace("Z", "+00:00"))
            except ValueError:
                pass
            rejected_ops.append(ReplaceOne({"_id": row_id}, doc, upsert=True))
        if rejected_ops:
            db.events_rejected.bulk_write(rejected_ops, ordered=False)
            stats["rejected_stored"] = len(rejected_ops)

    log.info("Carga en MongoDB: %s", stats)
    return stats


def events_in_window(db: Database, start: datetime, end: datetime, projection: dict | None = None):
    """Eventos con start <= event_dt < end, ordenados por fecha (lo usan Cassandra y Neo4j)."""
    query = {"derived.event_dt": {"$gte": start, "$lt": end}, "wiki": {"$in": sorted(config.WIKIS)}}
    return db.events.find(query, projection).sort("derived.event_dt", 1)


def record_run(db: Database, summary: dict) -> None:
    """Guarda el resumen de una ejecución del DAG (una por ventana horaria)."""
    summary = dict(summary)
    summary["window_start_dt"] = datetime.fromisoformat(summary["window_start"])
    summary["recorded_at"] = datetime.now(timezone.utc)
    db.pipeline_runs.replace_one({"_id": summary["window_start"]}, summary, upsert=True)
