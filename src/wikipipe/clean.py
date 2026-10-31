"""Validación, limpieza y enriquecimiento de los eventos extraídos.

Entrada: un .jsonl.gz crudo. Salida: un .jsonl.gz de eventos válidos y otro de rechazados
(con el motivo). Cada evento válido conserva todos sus campos originales y agrega:

- `_id`: el `meta.id` del evento (clave para que las cargas sean idempotentes).
- `derived`: campos calculados que usan MongoDB, Cassandra y Neo4j.
"""

from __future__ import annotations

import gzip
import ipaddress
import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

REQUIRED = ("type", "wiki", "title", "namespace", "user", "timestamp")
VALID_TYPES = {"edit", "new", "categorize", "log"}

# Enlace al editor afectado: [[Special:Contributions/X|...]], [[Special:Contribs/X]], [[Especial:Contribuciones/X]]
CONTRIB_LINK = re.compile(r"\[\[(?:Special|Especial):Contrib\w*/([^|\]]+)", re.IGNORECASE)
# Palabras que indican una reversión (inglés y español). "Restored ... by X" enlaza al autor
# restaurado y "Warning"/"Reporting" son avisos de bots: no son reversiones.
REVERT_WORDS = re.compile(r"\b(revert\w*|undid|undo|rollback|revertid\w*|deshech\w*)\b", re.IGNORECASE)
NOT_REVERT = re.compile(r"\b(restored|warning|reporting)\b", re.IGNORECASE)
# Página afectada en un evento categorize: el primer enlace [[:Página]] del comentario.
CATEGORIZE_PAGE = re.compile(r"\[\[:?([^|\]]+)")
CAT_ADDED = re.compile(r"added to category|añadida a la categoría", re.IGNORECASE)
CAT_REMOVED = re.compile(r"removed from category|eliminada de la categoría", re.IGNORECASE)


def user_type(event: dict) -> str:
    """Clasifica al editor: bot, temporal (cuentas ~AAAA-...), ip (formato antiguo) o registrado."""
    user = event.get("user", "")
    if event.get("bot"):
        return "bot"
    if user.startswith("~"):
        return "temporal"
    try:
        ipaddress.ip_address(user)
        return "ip"
    except ValueError:
        return "registrado"


def after_prefix(title: str) -> str:
    """'User talk:Juan/Archivo' -> 'Juan'. Sirve para páginas de usuario en cualquier idioma."""
    return title.split(":", 1)[-1].split("/", 1)[0].strip()


def derive(event: dict) -> dict:
    """Calcula los campos derivados de un evento ya validado."""
    dt = datetime.fromisoformat(event["meta"]["dt"].replace("Z", "+00:00")).astimezone(timezone.utc)
    etype, user, comment = event["type"], event["user"], event.get("comment") or ""
    d = {
        "event_time": dt.isoformat().replace("+00:00", "Z"),
        "date": dt.strftime("%Y-%m-%d"),
        "hour": dt.hour,
        "minute": dt.strftime("%Y-%m-%dT%H:%M"),
        "user_type": user_type(event),
        "page_key": f"{event['wiki']}:{event['title']}",
    }

    if etype in ("edit", "new"):
        length = event.get("length") or {}
        d["delta_bytes"] = (length.get("new") or 0) - (length.get("old") or 0)

        # Reversión: comentario con palabra de reversión y enlace al editor revertido.
        match = CONTRIB_LINK.search(comment)
        if match and REVERT_WORDS.search(comment) and not NOT_REVERT.search(comment):
            target = match.group(1).strip()
            if target and target != user:
                d["revert_target"] = target

        # Mensaje a otro usuario: edición en su página de discusión (namespace 3).
        if event["namespace"] == 3:
            target = after_prefix(event["title"])
            if target and target != user:
                d["message_target"] = target

    elif etype == "categorize":
        match = CATEGORIZE_PAGE.search(comment)
        if match:
            d["category"] = event["title"]
            d["categorized_page"] = match.group(1).strip()
            d["category_action"] = "added" if CAT_ADDED.search(comment) else "removed" if CAT_REMOVED.search(comment) else None

    elif etype == "log":
        log_type = event.get("log_type")
        params = event.get("log_params") if isinstance(event.get("log_params"), dict) else {}
        if log_type == "block" and event.get("log_action") in ("block", "reblock"):
            d["block_target"] = after_prefix(event["title"])
            d["block_duration"] = params.get("duration")
        elif log_type == "thanks":
            d["thanks_target"] = after_prefix(event["title"])
        elif log_type == "move" and params.get("target"):
            d["move_target"] = params["target"]
        elif log_type == "upload":
            d["uploaded_file"] = event["title"]
    return d


def validate(event: dict) -> str | None:
    """Devuelve el motivo de rechazo, o None si el evento es válido."""
    meta = event.get("meta")
    if not isinstance(meta, dict) or not meta.get("id") or not meta.get("dt"):
        return "sin_meta"
    if meta.get("domain") == "canary":
        return "canary"
    for field in REQUIRED:
        if event.get(field) in (None, ""):
            return f"falta_{field}"
    if event["type"] not in VALID_TYPES:
        return "tipo_desconocido"
    try:
        datetime.fromisoformat(meta["dt"].replace("Z", "+00:00"))
    except ValueError:
        return "fecha_invalida"
    return None


def clean_file(raw_path: Path, clean_path: Path, rejected_path: Path) -> dict:
    """Valida y enriquece un archivo crudo. Devuelve estadísticas de calidad de datos."""
    clean_path.parent.mkdir(parents=True, exist_ok=True)
    rejected_path.parent.mkdir(parents=True, exist_ok=True)
    reasons: Counter = Counter()
    seen: set[str] = set()
    stats = {"input": 0, "valid": 0, "duplicates": 0}

    with gzip.open(raw_path, "rt", encoding="utf-8") as src, \
         gzip.open(clean_path, "wt", encoding="utf-8") as ok, \
         gzip.open(rejected_path, "wt", encoding="utf-8") as bad:
        for line in src:
            stats["input"] += 1
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                reasons["json_invalido"] += 1
                bad.write(json.dumps({"reason": "json_invalido", "raw": line.strip()}) + "\n")
                continue
            reason = validate(event)
            if reason:
                reasons[reason] += 1
                bad.write(json.dumps({"reason": reason, "event": event}, ensure_ascii=False) + "\n")
                continue
            event_id = event["meta"]["id"]
            if event_id in seen:
                stats["duplicates"] += 1
                continue
            seen.add(event_id)
            event["_id"] = event_id
            event["derived"] = derive(event)
            ok.write(json.dumps(event, ensure_ascii=False) + "\n")
            stats["valid"] += 1

    stats["rejected"] = sum(reasons.values())
    stats["rejected_by_reason"] = dict(reasons)
    stats["quality_pct"] = round(100 * stats["valid"] / stats["input"], 2) if stats["input"] else None
    log.info("Limpieza terminada: %s", stats)
    return stats


def read_events(path: Path):
    """Recorre los eventos de un .jsonl.gz (lo usan las cargas en las bases)."""
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)
