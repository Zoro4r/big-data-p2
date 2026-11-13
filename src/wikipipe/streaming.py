"""Capa rápida (streaming): lee el stream de Wikipedia sin parar y guarda cada evento en segundos.

Arquitectura Lambda del proyecto:
- Capa rápida (este módulo, servicio `stream`): cada ~2 s guarda los eventos nuevos en MongoDB y
  actualiza los contadores por minuto de Cassandra. Así el dashboard ve la actividad casi en vivo.
- Capa por lotes (DAG de Airflow, cada hora): toma la hora completa, la valida, construye el grafo,
  los agregados por hora y los KPIs, y reescribe los contadores por minuto. Lee la hora de MongoDB si
  este servicio la cubrió sin interrupciones; si no, la vuelve a pedir a EventStreams (ver fuente.py).

No hay duplicados: las dos capas guardan cada evento con el mismo `_id` (meta.id).
El último evento leído se guarda como marcador en MongoDB (`stream_state`): al reiniciar, el
servicio retoma desde ahí con el encabezado Last-Event-ID.

Cobertura (`stream_cobertura`): cada tramo es un periodo leído sin huecos, de `inicio` a `fin`
(fechas de los eventos). Un reinicio que retoma con Last-Event-ID sigue el mismo tramo; uno que
arranca en vivo abre un tramo nuevo. `fin` solo avanza con eventos que llegan en vivo (menos de
EN_VIVO de retraso): mientras el servicio se pone al día tras un corte, los dos centros de datos de
Wikimedia llegan a distinto ritmo y la hora todavía podría estar incompleta.

Además, cada evento guarda `received_at` (cuándo llegó) y los eventos de enwiki/eswiki que no pasan
la validación se guardan en `events_rejected`, para que la capa por lotes mida la calidad igual.

Uso: python -m wikipipe.streaming
"""

from __future__ import annotations

import hashlib
import json
import logging
import signal
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests
from pymongo import ReplaceOne

from wikipipe import cassandra_store, config, mongo
from wikipipe.clean import derive, validate
from wikipipe.extract import iter_sse

log = logging.getLogger(__name__)

FLUSH_SEGUNDOS = 2.0      # cada cuánto se escribe lo acumulado
FLUSH_EVENTOS = 200       # o antes, si se juntan tantos eventos
MINUTOS_EN_MEMORIA = 15   # contadores por minuto que se conservan para reescribirlos
MARCADOR_ID = "recentchange"
MARCADOR_MAX_EDAD = timedelta(hours=24)  # un marcador más viejo se ignora y se empieza en vivo
EN_VIVO = timedelta(seconds=60)          # retraso máximo para que un evento avance la cobertura


class Contadores:
    """Contadores por (wiki, minuto) de los últimos minutos, como los de la tabla eventos_por_minuto."""

    def __init__(self):
        self.minutos = defaultdict(lambda: {"eventos": 0, "ediciones": 0, "eventos_bot": 0, "reversiones": 0})
        self.tocados: set = set()

    def sumar(self, evento: dict) -> None:
        d = evento["derived"]
        clave = (evento["wiki"], d["date"], d["minute"])
        c = self.minutos[clave]
        c["eventos"] += 1
        c["ediciones"] += 1 if evento["type"] in ("edit", "new") else 0
        c["eventos_bot"] += 1 if d["user_type"] == "bot" else 0
        c["reversiones"] += 1 if d.get("revert_target") else 0
        self.tocados.add(clave)

    def filas_para_escribir(self) -> list[tuple]:
        """Filas (wiki, fecha, minuto, eventos, ediciones, bots, reversiones) de los minutos tocados."""
        filas = []
        for clave in sorted(self.tocados):
            wiki, fecha, minuto = clave
            c = self.minutos[clave]
            filas.append((wiki, datetime.fromisoformat(fecha).date(),
                          datetime.fromisoformat(minuto).replace(tzinfo=timezone.utc),
                          c["eventos"], c["ediciones"], c["eventos_bot"], c["reversiones"]))
        self.tocados.clear()
        return filas

    def podar(self, ahora: datetime) -> None:
        limite = (ahora - timedelta(minutes=MINUTOS_EN_MEMORIA)).strftime("%Y-%m-%dT%H:%M")
        for clave in [k for k in self.minutos if k[2] < limite]:
            del self.minutos[clave]


def preparar(evento: dict) -> dict | None:
    """Filtra, valida y enriquece un evento crudo con las mismas reglas que el DAG."""
    meta = evento.get("meta") or {}
    if meta.get("domain") == "canary" or evento.get("wiki") not in config.WIKIS:
        return None
    if validate(evento) is not None:
        return None
    evento["_id"] = meta["id"]
    evento["derived"] = derive(evento)
    return evento


def rechazo(evento: dict) -> dict | None:
    """Fila para `events_rejected` si el evento es de nuestras wikis pero no pasa la validación.

    Mismo formato que guarda la capa por lotes ({_id, reason, event}), más `ventana_dt`, la fecha del
    evento, para encontrarlo por hora. Sin una fecha legible no se guarda: el extractor del stream
    tampoco lo habría considerado.
    """
    meta = evento.get("meta") or {}
    if meta.get("domain") == "canary" or evento.get("wiki") not in config.WIKIS:
        return None
    motivo = validate(evento)
    if motivo is None:
        return None
    try:
        dt = datetime.fromisoformat(str(meta.get("dt")).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None
    fila = {"reason": motivo, "event": evento}
    fila_id = meta.get("id") or hashlib.sha1(json.dumps(fila, sort_keys=True).encode()).hexdigest()
    return {"_id": fila_id, **mongo.sanitize(fila), "ventana_dt": dt}


def rango_en_vivo(eventos: list[dict], ahora: datetime) -> tuple[datetime, datetime] | None:
    """Fechas mínima y máxima de los eventos que llegaron en vivo (retraso < EN_VIVO)."""
    fechas = [e["derived"]["event_dt"] for e in eventos if ahora - e["derived"]["event_dt"] < EN_VIVO]
    return (min(fechas), max(fechas)) if fechas else None


class Streaming:
    def __init__(self):
        self.db = mongo.get_db()
        mongo.ensure_schema(self.db)
        self.cluster, self.cass = cassandra_store.connect()
        cassandra_store.ensure_schema(self.cass)
        self.stmt_minuto = self.cass.prepare(
            "INSERT INTO eventos_por_minuto (wiki, fecha, minuto, eventos, ediciones, eventos_bot, reversiones) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)")
        self.contadores = Contadores()
        self.buffer: list[dict] = []
        self.rechazados: list[dict] = []
        self.tramo_id: str | None = None
        self.ultimo_id: str | None = None
        self.ultimo_dt: str | None = None
        self.activo = True
        self.stats = {"guardados": 0, "descartados": 0, "reconexiones": 0}
        self.ultimo_log = time.monotonic()

    def marcador_inicial(self) -> str | None:
        doc = self.db.stream_state.find_one({"_id": MARCADOR_ID})
        if not doc or not doc.get("last_event_id"):
            return None
        if datetime.now(timezone.utc) - doc["updated_at"].replace(tzinfo=timezone.utc) > MARCADOR_MAX_EDAD:
            log.info("El marcador tiene más de %s; se empieza en vivo", MARCADOR_MAX_EDAD)
            return None
        log.info("Retomando desde el marcador del %s", doc.get("last_dt"))
        return doc["last_event_id"]

    def tramo_anterior(self) -> str | None:
        """Al retomar con el marcador no hay hueco: se continúa el último tramo de cobertura."""
        doc = self.db.stream_cobertura.find_one({}, sort=[("fin", -1)])
        return doc["_id"] if doc else None

    def guardar(self) -> None:
        """Escribe el buffer en MongoDB, los contadores en Cassandra, la cobertura y el marcador."""
        ahora = datetime.now(timezone.utc)
        if self.buffer:
            docs = [mongo.to_document(e) for e in self.buffer]
            self.db.events.bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in docs], ordered=False)
            self.stats["guardados"] += len(docs)
            self.buffer.clear()
            # La cobertura avanza solo después de guardar: si la escritura falla, no se anuncia la hora.
            rango = rango_en_vivo(docs, ahora)
            if rango:
                if self.tramo_id is None:
                    self.tramo_id = rango[0].isoformat()
                    log.info("Nuevo tramo de cobertura desde %s", self.tramo_id)
                self.db.stream_cobertura.update_one(
                    {"_id": self.tramo_id},
                    {"$min": {"inicio": rango[0]}, "$max": {"fin": rango[1]}, "$set": {"actualizado": ahora}},
                    upsert=True)
        if self.rechazados:
            self.db.events_rejected.bulk_write(
                [ReplaceOne({"_id": r["_id"]}, r, upsert=True) for r in self.rechazados], ordered=False)
            self.stats["rechazados"] = self.stats.get("rechazados", 0) + len(self.rechazados)
            self.rechazados.clear()
        for fila in self.contadores.filas_para_escribir():
            self.cass.execute(self.stmt_minuto, fila)
        if self.ultimo_id:
            self.db.stream_state.replace_one(
                {"_id": MARCADOR_ID},
                {"_id": MARCADOR_ID, "last_event_id": self.ultimo_id, "last_dt": self.ultimo_dt,
                 "updated_at": datetime.now(timezone.utc), "stats": self.stats},
                upsert=True)
        self.contadores.podar(datetime.now(timezone.utc))
        if time.monotonic() - self.ultimo_log > 300:
            log.info("Estado: %s · último evento %s", self.stats, self.ultimo_dt)
            self.ultimo_log = time.monotonic()

    def leer(self, ultimo_id: str | None) -> None:
        headers = {"User-Agent": config.USER_AGENT, "Accept": "text/event-stream"}
        if ultimo_id:
            headers["Last-Event-ID"] = ultimo_id
        with requests.get(config.STREAM_URL, headers=headers, stream=True, timeout=(10, 60)) as resp:
            resp.raise_for_status()
            log.info("Conectado al stream")
            ultimo_flush = time.monotonic()
            for event_id, data in iter_sse(resp):
                if not self.activo:
                    break
                self.ultimo_id = event_id or self.ultimo_id
                crudo = None
                try:
                    crudo = json.loads(data)
                    fila = rechazo(crudo) if isinstance(crudo, dict) else None
                    evento = preparar(crudo) if fila is None and isinstance(crudo, dict) else None
                except (ValueError, KeyError, TypeError):
                    evento, fila = None, None
                if fila is not None:
                    self.rechazados.append(fila)
                if evento is None:
                    self.stats["descartados"] += 1
                else:
                    evento["received_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    self.buffer.append(evento)
                    self.contadores.sumar(evento)
                    self.ultimo_dt = evento["derived"]["event_time"]
                if len(self.buffer) >= FLUSH_EVENTOS or time.monotonic() - ultimo_flush >= FLUSH_SEGUNDOS:
                    self.guardar()
                    ultimo_flush = time.monotonic()

    def correr(self) -> None:
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "activo", False))
        ultimo_id, espera = self.marcador_inicial(), 1
        if ultimo_id:
            self.tramo_id = self.tramo_anterior()
        while self.activo:
            try:
                self.leer(ultimo_id or self.ultimo_id)
                espera = 1
            except (requests.RequestException, OSError) as exc:
                self.stats["reconexiones"] += 1
                log.warning("Se cortó el stream (%s); reconecto en %ds", exc, espera)
                time.sleep(espera)
                espera = min(espera * 2, 60)
            finally:
                self.guardar()
                ultimo_id = None  # al reconectar se usa el último id leído
        self.cluster.shutdown()
        log.info("Streaming detenido: %s", self.stats)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for nombre in ("cassandra", "neo4j"):
        logging.getLogger(nombre).setLevel(logging.WARNING)
    Streaming().correr()
