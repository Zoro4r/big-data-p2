"""Cassandra: agregados por ventana de tiempo (series temporales, históricos y KPIs).

Lee de MongoDB los eventos de la ventana, los agrega y escribe tablas pensadas para las consultas
del dashboard (ver db/cassandra/schema.cql). Se escriben valores ya calculados que se sobrescriben,
no contadores: así una re-ejecución de la misma hora deja el mismo resultado.

(El módulo no se llama cassandra.py para no tapar el paquete `cassandra` del driver.)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from cassandra.cluster import Cluster, Session
from cassandra.concurrent import execute_concurrent_with_args
from cassandra.policies import DCAwareRoundRobinPolicy

from wikipipe import config
from wikipipe.clean import user_type

log = logging.getLogger(__name__)
TOP_PAGES = 20


def connect() -> tuple[Cluster, Session]:
    cluster = Cluster(
        config.CASSANDRA_HOSTS,
        protocol_version=5,
        load_balancing_policy=DCAwareRoundRobinPolicy(local_dc="datacenter1"),
        connect_timeout=20,
    )
    return cluster, cluster.connect()


def split_cql(text: str) -> list[str]:
    """Separa un archivo .cql en sentencias, ignorando los comentarios '--'."""
    lines = [line for line in text.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


# Columnas agregadas después de crear las tablas: CREATE TABLE IF NOT EXISTS no las agrega a una tabla
# que ya existe, así que se agregan aquí si faltan.
COLUMNAS_NUEVAS = [("ejecuciones", "fuente", "text")]


def ensure_schema(session: Session) -> None:
    schema = (config.DB_DIR / "cassandra" / "schema.cql").read_text(encoding="utf-8")
    schema = schema.replace("wikipipe", config.CASSANDRA_KEYSPACE)
    for statement in split_cql(schema):
        session.execute(statement)
    for tabla, columna, tipo in COLUMNAS_NUEVAS:
        existe = session.execute(
            "SELECT column_name FROM system_schema.columns WHERE keyspace_name = %s AND table_name = %s AND column_name = %s",
            (config.CASSANDRA_KEYSPACE, tabla, columna)).one()
        if not existe:
            session.execute(f"ALTER TABLE {config.CASSANDRA_KEYSPACE}.{tabla} ADD {columna} {tipo}")
    session.set_keyspace(config.CASSANDRA_KEYSPACE)


def _day(value: str) -> date:
    return date.fromisoformat(value)


def aggregate(events) -> dict:
    """Agrupa los eventos de la ventana en las estructuras de cada tabla."""
    resumen = defaultdict(lambda: defaultdict(int))
    resumen_editores = defaultdict(set)
    resumen_humanos = defaultdict(set)
    minutos = defaultdict(lambda: defaultdict(int))
    editores = defaultdict(lambda: {"tipo": None, "eventos": 0, "ediciones": 0, "paginas": set(),
                                    "delta": 0, "rev_hechas": 0, "rev_recibidas": 0})
    paginas = defaultdict(lambda: {"ediciones": 0, "editores": set(), "delta": 0, "reversiones": 0})

    for e in events:
        d, wiki, user, etype = e["derived"], e["wiki"], e["user"], e["type"]
        fecha, hora = d["date"], d["hour"]
        is_bot = d["user_type"] == "bot"
        is_edit = etype in ("edit", "new")
        reverted = d.get("revert_target")
        delta = d.get("delta_bytes", 0)

        key = (fecha, hora, wiki)
        r = resumen[key]
        r["eventos"] += 1
        r[{"edit": "ediciones", "new": "creaciones", "categorize": "categorizaciones", "log": "logs"}[etype]] += 1
        r["eventos_bot" if is_bot else "eventos_humanos"] += 1
        r["reversiones"] += 1 if reverted else 0
        r["delta_bytes"] += delta
        resumen_editores[key].add(user)
        if not is_bot:
            resumen_humanos[key].add(user)

        m = minutos[(wiki, fecha, d["minute"])]
        m["eventos"] += 1
        m["ediciones"] += 1 if is_edit else 0
        m["eventos_bot"] += 1 if is_bot else 0
        m["reversiones"] += 1 if reverted else 0

        ed = editores[(user, fecha, hora, wiki)]
        ed["tipo"] = d["user_type"]
        ed["eventos"] += 1
        if is_edit:
            ed["ediciones"] += 1
            ed["paginas"].add(d["page_key"])
            ed["delta"] += delta
        if reverted:
            ed["rev_hechas"] += 1
            editores[(reverted, fecha, hora, wiki)]["rev_recibidas"] += 1

        if is_edit:
            p = paginas[(wiki, fecha, hora, e["title"])]
            p["ediciones"] += 1
            p["editores"].add(user)
            p["delta"] += delta
            # Una página en disputa es la que recibe reversiones: alguien deshace lo que hizo otro en ella.
            p["reversiones"] += 1 if reverted else 0

    # Editores que en esta hora solo fueron revertidos: el tipo se deduce por el nombre.
    for (user, *_), ed in editores.items():
        if ed["tipo"] is None:
            ed["tipo"] = user_type({"user": user, "bot": False})

    for key, users in resumen_editores.items():
        resumen[key]["editores"] = len(users)
        resumen[key]["editores_humanos"] = len(resumen_humanos[key])
    return {"resumen": resumen, "minutos": minutos, "editores": editores, "paginas": paginas}


def load_window(session: Session, events, start: datetime, db=None) -> dict:
    """Reemplaza una hora completa, incluso cuando ahora está vacía."""
    from wikipipe import mongo
    from wikipipe.windows import lock_hour

    db = db if db is not None else mongo.get_db()
    with lock_hour(db, start) as lease:
        # El cursor se consume bajo el mismo bloqueo que utiliza el servicio stream.
        return _load_locked(session, events, start, db, lease)


def _load_locked(session, events, start, db, lease):
    """Agrega los eventos de la ventana y escribe las tablas de Cassandra."""
    ensure_schema(session)
    agg = aggregate(events)
    end = start + timedelta(hours=1)
    editors = sorted({key[0] for key in agg["editores"]})
    previous = set(lease.document.get("editors", [])) | set(lease.document.get("pending_editors", []))
    # Se guarda antes de escribir: un reintento también limpia las filas de una carga parcial.
    db.pipeline_windows.update_one(lease.query, {"$set": {"pending_editors": sorted(previous | set(editors))}})
    db.pipeline_runs.update_one({"_id": start.isoformat()}, {"$set": {"reprocessing": True}})
    timestamp = lease.timestamp
    session.execute("DELETE FROM resumen_por_hora USING TIMESTAMP %s WHERE fecha = %s AND hora = %s",
                    (timestamp, start.date(), start.hour))
    for wiki in sorted(config.WIKIS):
        session.execute("DELETE FROM eventos_por_minuto USING TIMESTAMP %s WHERE wiki = %s AND fecha = %s "
                        "AND minuto >= %s AND minuto < %s", (timestamp, wiki, start.date(), start, end))
        for table in ("paginas_top_por_hora", "paginas_disputadas_por_hora"):
            session.execute(f"DELETE FROM {table} USING TIMESTAMP %s WHERE wiki = %s AND fecha = %s AND hora = %s",
                            (timestamp, wiki, start.date(), start.hour))
    delete_editor = session.prepare("DELETE FROM actividad_editor USING TIMESTAMP ? "
                                    "WHERE editor = ? AND fecha = ? AND hora = ?")
    execute_concurrent_with_args(session, delete_editor,
                                 [(timestamp, user, start.date(), start.hour) for user in previous | set(editors)],
                                 concurrency=20, raise_on_first_error=True)

    resumen_rows = [
        (_day(f), h, w, r["eventos"], r["ediciones"], r["creaciones"], r["categorizaciones"], r["logs"],
         r["eventos_bot"], r["eventos_humanos"], r["editores"], r["editores_humanos"], r["reversiones"], r["delta_bytes"])
        for (f, h, w), r in agg["resumen"].items()
    ]
    present = {row[2] for row in resumen_rows}
    resumen_rows += [(start.date(), start.hour, wiki, *([0] * 11)) for wiki in sorted(config.WIKIS) if wiki not in present]
    minuto_rows = [
        (w, _day(f), datetime.fromisoformat(mi).replace(tzinfo=timezone.utc), m["eventos"], m["ediciones"],
         m["eventos_bot"], m["reversiones"])
        for (w, f, mi), m in agg["minutos"].items()
    ]
    editor_rows = [
        (u, _day(f), h, w, ed["tipo"] or "desconocido", ed["eventos"], ed["ediciones"], len(ed["paginas"]),
         ed["delta"], ed["rev_hechas"], ed["rev_recibidas"])
        for (u, f, h, w), ed in agg["editores"].items()
    ]

    # Top de páginas por (wiki, fecha, hora): se borra la hora y se reescribe el ranking completo.
    rankings = defaultdict(list)
    for (w, f, h, title), p in agg["paginas"].items():
        rankings[(w, f, h)].append((title, p))
    pagina_rows = []
    disputa_rows = []
    for (w, f, h), items in rankings.items():
        items.sort(key=lambda it: (-len(it[1]["editores"]), -it[1]["ediciones"], it[0]))
        for pos, (title, p) in enumerate(items[:TOP_PAGES], start=1):
            pagina_rows.append((w, _day(f), h, pos, title, p["ediciones"], len(p["editores"]), p["delta"]))
        # Páginas en disputa: las que más reversiones recibieron en la hora.
        con_reversiones = sorted((it for it in items if it[1]["reversiones"]),
                                 key=lambda it: (-it[1]["reversiones"], -len(it[1]["editores"]), it[0]))
        for pos, (title, p) in enumerate(con_reversiones[:TOP_PAGES], start=1):
            disputa_rows.append((w, _day(f), h, pos, title, p["reversiones"], p["ediciones"], len(p["editores"])))

    statements = {
        "resumen_por_hora": (
            "INSERT INTO resumen_por_hora (fecha, hora, wiki, eventos, ediciones, creaciones, categorizaciones, logs, "
            "eventos_bot, eventos_humanos, editores, editores_humanos, reversiones, delta_bytes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", resumen_rows),
        "eventos_por_minuto": (
            "INSERT INTO eventos_por_minuto (wiki, fecha, minuto, eventos, ediciones, eventos_bot, reversiones) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", minuto_rows),
        "actividad_editor": (
            "INSERT INTO actividad_editor (editor, fecha, hora, wiki, tipo_editor, eventos, ediciones, paginas, "
            "delta_bytes, reversiones_hechas, reversiones_recibidas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", editor_rows),
    }
    statements["paginas_top_por_hora"] = (
        "INSERT INTO paginas_top_por_hora (wiki, fecha, hora, posicion, pagina, ediciones, editores, delta_bytes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", pagina_rows)
    statements["paginas_disputadas_por_hora"] = (
        "INSERT INTO paginas_disputadas_por_hora (wiki, fecha, hora, posicion, pagina, reversiones, ediciones, editores) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", disputa_rows)

    stats = {}
    for table, (cql, rows) in statements.items():
        lease.check()
        versioned = [(*row, timestamp + 1) for row in rows]
        execute_concurrent_with_args(session, session.prepare(cql + " USING TIMESTAMP ?"), versioned,
                                     concurrency=50, raise_on_first_error=True)
        stats[table] = len(rows)
    lease.check()
    db.pipeline_windows.update_one(lease.query, {"$set": {"editors": editors}, "$unset": {"pending_editors": ""}})
    log.info("Carga en Cassandra (filas por tabla): %s", stats)
    return stats


def write_kpis(session: Session, window_start: datetime, kpis: dict, wiki: str | None = None) -> None:
    """kpis = {nombre: (valor, detalle)}. Sin wiki van a `kpis`; con wiki, a `kpis_por_wiki`."""
    if wiki is None:
        stmt = session.prepare("INSERT INTO kpis (kpi, ventana, valor, detalle) VALUES (?, ?, ?, ?)")
        rows = [(name, window_start, None if v is None else float(v), det) for name, (v, det) in kpis.items()]
    else:
        stmt = session.prepare("INSERT INTO kpis_por_wiki (kpi, wiki, ventana, valor, detalle) VALUES (?, ?, ?, ?, ?)")
        rows = [(name, wiki, window_start, None if v is None else float(v), det) for name, (v, det) in kpis.items()]
    execute_concurrent_with_args(session, stmt, rows, concurrency=20, raise_on_first_error=True)


def write_run(session: Session, window_start: datetime, extract: dict, clean: dict) -> None:
    session.execute(
        "INSERT INTO ejecuciones (fecha, ventana, leidos_stream, extraidos, validos, rechazados, calidad_pct, "
        "segundos_extraccion, fuente) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (window_start.date(), window_start, extract.get("read"), extract.get("kept"), clean.get("valid"),
         clean.get("rejected"), clean.get("quality_pct"), extract.get("seconds"), extract.get("fuente")),
    )
