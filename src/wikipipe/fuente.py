"""De dónde lee la capa por lotes cada hora: MongoDB o, como respaldo, EventStreams.

El servicio stream (capa rápida) ya guarda en MongoDB cada evento a los ~2 s, y registra en
`stream_cobertura` los tramos de tiempo en que estuvo conectado sin interrupciones. Si un mismo tramo
cubre toda la hora más un margen, la hora ya está completa en MongoDB y se lee de ahí: es rápido y no
depende de deducir cuándo termina la hora en el stream (EventStreams no tiene parámetro «hasta»).

Si no hay un tramo así (el servicio estuvo caído, se reinició sin poder retomar o va atrasado), la
hora se vuelve a pedir a EventStreams con `extract_window`, como antes. Eso solo es posible mientras
Wikimedia guarde esa hora: unos 9 días.

Las dos fuentes escriben el mismo archivo crudo (.jsonl.gz), así que el resto del DAG no cambia.
Solo entran eventos con inicio <= meta.dt < fin: el margen sirve para saber cuándo es seguro leer,
no agrega eventos de otras horas.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo.database import Database

from wikipipe import config
from wikipipe.extract import extract_window, to_utc

log = logging.getLogger(__name__)

# Cuánto debe haber avanzado el stream después del fin de la hora para dar la hora por completa.
# Hoy los eventos llegan con ~1 s de retraso; el margen cubre demoras raras de Wikimedia.
MARGEN = timedelta(minutes=5)
# Cuánto se espera, como máximo, a que el stream llegue al margen antes de usar el respaldo.
ESPERA_MAX = timedelta(minutes=10)
SONDEO_SEGUNDOS = 15
# Un tramo cuyo último guardado es más viejo que esto se considera detenido: no vale la pena esperarlo.
TRAMO_VIVO = timedelta(minutes=2)


def decidir(tramo: dict | None, start: datetime, end: datetime, ahora: datetime,
            margen: timedelta = MARGEN) -> str:
    """Qué hacer con la hora [start, end) según el tramo de cobertura que empezó antes de ella.

    - "mongodb": el tramo cubre la hora completa más el margen.
    - "esperar": el tramo cubre el inicio de la hora y sigue avanzando; todavía no llega al margen.
    - "eventstreams": no hay tramo que cubra el inicio, o se detuvo antes del margen.
    """
    if not tramo or tramo["inicio"] > start or tramo["fin"] < start:
        return "eventstreams"
    if tramo["fin"] >= end + margen:
        return "mongodb"
    if ahora - tramo["actualizado"] <= TRAMO_VIVO:
        return "esperar"
    return "eventstreams"


def _utc(doc: dict | None) -> dict | None:
    """PyMongo devuelve fechas sin zona; las de este proyecto están en UTC."""
    if doc:
        for k in ("inicio", "fin", "actualizado"):
            doc[k] = doc[k].replace(tzinfo=timezone.utc)
    return doc


def tramo_de_inicio(db: Database, start: datetime) -> dict | None:
    """El tramo de cobertura que empezó en o antes de `start` y llegó más lejos."""
    return _utc(db.stream_cobertura.find_one({"inicio": {"$lte": start}}, sort=[("fin", -1)]))


def esperar_cobertura(db: Database, start: datetime, end: datetime, espera_max: timedelta = ESPERA_MAX) -> dict | None:
    """Devuelve el tramo que cubre la hora, esperando hasta `espera_max` si el stream va llegando."""
    limite = time.monotonic() + espera_max.total_seconds()
    while True:
        tramo = tramo_de_inicio(db, start)
        decision = decidir(tramo, start, end, datetime.now(timezone.utc))
        if decision == "mongodb":
            return tramo
        if decision == "eventstreams" or time.monotonic() >= limite:
            return None
        log.info("El stream va en %s; espero a que pase %s", tramo["fin"], end + MARGEN)
        time.sleep(SONDEO_SEGUNDOS)


def volcar_desde_mongo(db: Database, start: datetime, end: datetime, out_path: Path,
                       wikis: frozenset[str] = config.WIKIS) -> dict:
    """Escribe en `out_path` los eventos de la hora que guardó el streaming, válidos y rechazados.

    Se quitan los campos que agrega el pipeline (`_id`, `derived`) para que el archivo tenga la misma
    forma que uno extraído del stream; la limpieza los vuelve a calcular.
    """
    t0 = time.monotonic()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    stats = {"read": 0, "kept": 0, "rejected_in_mongo": 0}
    rango = {"$gte": start, "$lt": end}
    with gzip.open(tmp_path, "wt", encoding="utf-8") as fh:
        for doc in db.events.find({"derived.event_dt": rango, "wiki": {"$in": sorted(wikis)}}):
            doc.pop("_id", None)
            doc.pop("derived", None)
            fh.write(json.dumps(doc, ensure_ascii=False, default=str) + "\n")
            stats["kept"] += 1
        # Los rechazados también entran, para que la limpieza mida la calidad igual que con el stream.
        for row in db.events_rejected.find({"ventana_dt": rango}):
            event = row.get("event")
            if isinstance(event, dict) and event.get("wiki") in wikis:
                fh.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
                stats["kept"] += 1
                stats["rejected_in_mongo"] += 1
    tmp_path.replace(out_path)
    stats["read"] = stats["kept"]
    stats["seconds"] = round(time.monotonic() - t0, 1)
    return stats


def extraer_hora(start: datetime, end: datetime, out_path: Path, db: Database | None = None) -> dict:
    """Extrae la hora [start, end) de MongoDB si el streaming la cubrió; si no, de EventStreams."""
    from wikipipe import mongo

    start, end = to_utc(start), to_utc(end)
    db = db if db is not None else mongo.get_db()
    t0 = time.monotonic()
    tramo = esperar_cobertura(db, start, end)
    espera = round(time.monotonic() - t0, 1)
    if tramo:
        stats = volcar_desde_mongo(db, start, end, out_path)
        stats.update(fuente="mongodb", tramo=str(tramo["_id"]), espera_s=espera,
                     window_start=start.isoformat(), window_end=end.isoformat(),
                     wikis=sorted(config.WIKIS), path=str(out_path))
        log.info("Hora leída de MongoDB: %s", stats)
    else:
        log.info("El streaming no cubrió la hora %s; se extrae de EventStreams", start.isoformat())
        stats = extract_window(start, end, out_path)
        stats.update(fuente="eventstreams", espera_s=espera)
    return stats
