"""Coordinación entre streaming y consolidación sobre una misma hora de Cassandra."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
import time
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


class WindowLease:
    def __init__(self, collection, document, owner):
        self.collection = collection
        self.document = document
        self.owner = owner
        self.stopped = Event()
        self.lost = Event()
        self.thread = Thread(target=self.renew, daemon=True)

    @property
    def timestamp(self):
        return self.document["write_us"]

    @property
    def query(self):
        return {"_id": self.document["_id"], "owner": self.owner}

    def renew(self):
        while not self.stopped.wait(15):
            try:
                result = self.collection.update_one(self.query, {"$set": {
                    "lease_until": datetime.now(timezone.utc) + timedelta(seconds=60)}})
                if result.matched_count != 1:
                    self.lost.set()
                    return
            except Exception:
                self.lost.set()
                return

    def check(self):
        if self.lost.is_set():
            raise RuntimeError("Se perdió el bloqueo de la ventana; la operación se debe reintentar")


@contextmanager
def lock_hour(db, start):
    """Lease renovable y timestamp creciente para descartar escrituras de un dueño vencido.

    El documento conserva también el manifiesto de editores escritos por la carga horaria.
    Las eliminaciones usan timestamp y las inserciones timestamp + 1.
    """
    collection = db.pipeline_windows
    key = start.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()
    try:
        collection.update_one({"_id": key}, {"$setOnInsert": {
            "lease_until": datetime(1970, 1, 1, tzinfo=timezone.utc), "write_us": 0}}, upsert=True)
    except DuplicateKeyError:
        pass  # Otro escritor creó el mismo documento de coordinación.

    owner = uuid4().hex
    deadline = time.monotonic() + 180
    document = None
    while document is None:
        now = datetime.now(timezone.utc)
        document = collection.find_one_and_update(
            {"_id": key, "$or": [{"lease_until": {"$lte": now}}, {"lease_until": {"$exists": False}}]},
            [{"$set": {"owner": owner, "lease_until": now + timedelta(seconds=60),
                        "write_us": {"$add": [{"$max": [{"$ifNull": ["$write_us", 0]}, int(now.timestamp() * 1_000_000)]}, 2]}}}],
            return_document=ReturnDocument.AFTER)
        if document is None:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"La ventana {key} sigue ocupada")
            time.sleep(0.25)
    lease = WindowLease(collection, document, owner)
    lease.thread.start()
    try:
        yield lease
        lease.check()
    finally:
        lease.stopped.set()
        lease.thread.join(timeout=5)
        collection.update_one(lease.query, {"$set": {"lease_until": datetime.now(timezone.utc)},
                                            "$unset": {"owner": ""}})
