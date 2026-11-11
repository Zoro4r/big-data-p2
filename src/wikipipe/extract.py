"""Extracción de una ventana de tiempo del stream Wikimedia EventStreams (recentchange).

El stream es Server-Sent Events: cada evento llega como líneas `id: ...` y `data: {json}`.
Pedimos el stream desde el inicio de la ventana con `?since=` y cortamos cuando ya pasamos
el fin de la ventana más un margen. Así cada ventana es reproducible: volver a extraer
la misma hora trae los mismos eventos (mientras Wikimedia los conserve, unos días).
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from wikipipe import config

log = logging.getLogger(__name__)


def parse_dt(value: str) -> datetime:
    """Convierte '2026-10-31T16:02:09.221Z' en un datetime con zona UTC.

    Algunos eventos traen la fecha sin zona horaria; en ese caso se asume UTC.
    """
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def to_utc(value: datetime) -> datetime:
    """Normaliza a un datetime estándar en UTC.

    Airflow entrega fechas de pendulum; al convertirlas con astimezone() y sumarles un
    timedelta pierden la zona horaria. Pasar por el timestamp evita ese problema.
    """
    return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)


def iter_sse(response: requests.Response):
    """Recorre un stream SSE y devuelve tuplas (event_id, data) por cada evento completo."""
    event_id, data_lines = None, []
    for raw in response.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw == "":
            if data_lines:
                yield event_id, "\n".join(data_lines)
            event_id, data_lines = None, []
        elif raw.startswith("data:"):
            data_lines.append(raw[5:].lstrip())
        elif raw.startswith("id:"):
            event_id = raw[3:].strip()
        # Las líneas "event:" y los comentarios ":" no nos interesan.


def extract_window(
    start: datetime,
    end: datetime,
    out_path: Path,
    wikis: frozenset[str] = config.WIKIS,
    grace_seconds: int = config.STREAM_GRACE_SECONDS,
    max_retries: int = 5,
    stop_after_beyond: int = 100,
    quiet_seconds: int = 30,
) -> dict:
    """Guarda en `out_path` (.jsonl.gz) los eventos con start <= meta.dt < end de las wikis pedidas.

    Devuelve estadísticas de la extracción para registrar la ejecución.
    """
    start, end = to_utc(start), to_utc(end)
    stop_at = end + timedelta(seconds=grace_seconds)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    stats = {"read": 0, "kept": 0, "canary": 0, "out_of_window": 0, "other_wikis": 0, "unparseable": 0, "reconnects": 0}
    # Eventos posteriores a stop_at llegados seguidos, por centro de datos (el prefijo de meta.topic:
    # codfw, eqiad). Ver el comentario del corte más abajo.
    beyond_end: dict[str, int] = {}
    seen_ids: set[str] = set()
    last_event_id = None
    t0 = time.monotonic()
    last_in_window = t0  # cuándo llegó el último evento de la ventana (de cualquier wiki)

    with gzip.open(tmp_path, "wt", encoding="utf-8") as fh:
        done, attempt = False, 0
        while not done:
            headers = {"User-Agent": config.USER_AGENT, "Accept": "text/event-stream"}
            params = {}
            if last_event_id:
                # Al reconectar, el servidor retoma desde el último evento recibido.
                headers["Last-Event-ID"] = last_event_id
            else:
                params["since"] = start.strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                with requests.get(config.STREAM_URL, params=params, headers=headers, stream=True, timeout=(10, 60)) as resp:
                    resp.raise_for_status()
                    for event_id, data in iter_sse(resp):
                        last_event_id = event_id or last_event_id
                        stats["read"] += 1
                        try:
                            event = json.loads(data)
                            dt = parse_dt(event["meta"]["dt"])
                        except (ValueError, KeyError, TypeError):
                            stats["unparseable"] += 1
                            continue
                        if event["meta"].get("domain") == "canary":
                            # Eventos de prueba de Wikimedia. El datacenter inactivo los
                            # emite con la hora actual, así que no sirven para decidir el corte.
                            stats["canary"] += 1
                            continue
                        # Cuándo cortar: con ?since= el stream intercala los dos centros de datos de
                        # Wikimedia. Cada uno llega en orden de tiempo, pero a distinto ritmo: el de poco
                        # volumen recorre en segundos todas las horas hasta ahora, mientras el principal
                        # sigue entregando la ventana (sobre todo si se procesa tarde: backfill, trigger
                        # manual). Se corta solo con dos señales a la vez:
                        #  1. cada centro de datos visto lleva `stop_after_beyond` eventos posteriores seguidos;
                        #  2. hace `quiet_seconds` que no llega ningún evento de la ventana (un centro que
                        #     todavía no apareció o que sigue entregándola lo impide).
                        centro = str(event["meta"].get("topic", "")).split(".")[0]
                        if dt >= stop_at:
                            beyond_end[centro] = beyond_end.get(centro, 0) + 1
                            if (all(n >= stop_after_beyond for n in beyond_end.values())
                                    and time.monotonic() - last_in_window >= quiet_seconds):
                                done = True
                                break
                            continue
                        beyond_end[centro] = 0  # este centro todavía no pasó la ventana
                        if dt >= start:
                            last_in_window = time.monotonic()
                        if not (start <= dt < end):
                            stats["out_of_window"] += 1
                            continue
                        if event.get("wiki") not in wikis:
                            stats["other_wikis"] += 1
                            continue
                        meta_id = event["meta"].get("id")
                        if meta_id in seen_ids:  # duplicado por reconexión
                            continue
                        seen_ids.add(meta_id)
                        fh.write(json.dumps(event, ensure_ascii=False) + "\n")
                        stats["kept"] += 1
                attempt = 0
            except (requests.RequestException, OSError) as exc:
                attempt += 1
                stats["reconnects"] += 1
                if attempt > max_retries:
                    raise RuntimeError(f"El stream falló {attempt} veces seguidas") from exc
                wait = min(2**attempt, 30)
                log.warning("Error leyendo el stream (%s). Reintento %d en %ds", exc, attempt, wait)
                time.sleep(wait)

    tmp_path.replace(out_path)  # el archivo final solo aparece si la extracción terminó bien
    stats.update(
        window_start=start.isoformat(),
        window_end=end.isoformat(),
        wikis=sorted(wikis),
        seconds=round(time.monotonic() - t0, 1),
        path=str(out_path),
    )
    log.info("Extracción terminada: %s", stats)
    return stats


def raw_path_for(start: datetime, data_dir: Path = config.DATA_DIR) -> Path:
    """Ruta del archivo crudo de una ventana: data/raw/AAAA-MM-DD/HHMM.jsonl.gz"""
    start = to_utc(start)
    return data_dir / "raw" / start.strftime("%Y-%m-%d") / f"{start:%H%M}.jsonl.gz"


if __name__ == "__main__":
    # Uso: python -m wikipipe.extract 2026-10-31T15:00:00Z 2026-10-31T15:05:00Z
    import sys

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s, e = parse_dt(sys.argv[1]), parse_dt(sys.argv[2])
    print(json.dumps(extract_window(s, e, raw_path_for(s)), indent=2))
