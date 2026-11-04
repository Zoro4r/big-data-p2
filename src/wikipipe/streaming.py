"""Capa rápida (streaming): lee el stream de Wikipedia sin parar y guarda cada evento en segundos.

Arquitectura Lambda del proyecto:
- Capa rápida (este módulo, servicio `stream`): cada ~2 s guarda los eventos nuevos en MongoDB y
  actualiza los contadores por minuto de Cassandra. Así el dashboard ve la actividad casi en vivo.
- Capa por lotes (DAG de Airflow, cada hora): vuelve a extraer la hora completa, la valida, construye
  el grafo, los agregados por hora y los KPIs, y reescribe los contadores por minuto. Si la capa
  rápida perdió algo (por ejemplo, por un reinicio), la hora queda exacta igual.

No hay duplicados: las dos capas guardan cada evento con el mismo `_id` (meta.id).
El último evento leído se guarda como marcador en MongoDB (`stream_state`): al reiniciar, el
servicio retoma desde ahí con el encabezado Last-Event-ID.

Uso: python -m wikipipe.streaming
"""

from __future__ import annotations

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

    def guardar(self) -> None:
        """Escribe el buffer en MongoDB, los contadores en Cassandra y el marcador."""
        if self.buffer:
            ops = [ReplaceOne({"_id": e["_id"]}, mongo.to_document(e), upsert=True) for e in self.buffer]
            self.db.events.bulk_write(ops, ordered=False)
            self.stats["guardados"] += len(self.buffer)
            self.buffer.clear()
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
                try:
                    evento = preparar(json.loads(data))
                except (ValueError, KeyError, TypeError):
                    evento = None
                if evento is None:
                    self.stats["descartados"] += 1
                else:
                    self.buffer.append(evento)
                    self.contadores.sumar(evento)
                    self.ultimo_dt = evento["derived"]["event_time"]
                if len(self.buffer) >= FLUSH_EVENTOS or time.monotonic() - ultimo_flush >= FLUSH_SEGUNDOS:
                    self.guardar()
                    ultimo_flush = time.monotonic()

    def correr(self) -> None:
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "activo", False))
        ultimo_id, espera = self.marcador_inicial(), 1
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
