"""API del dashboard (FastAPI): lectura de las tres bases y operaciones CRUD.

Autenticación opcional: si DASHBOARD_PASSWORD está definida, todas las rutas /api (salvo /api/login,
/api/session y /api/health) exigen la cookie de sesión que entrega /api/login.

Uso local: uvicorn main:app --reload --port 8000   (con PYTHONPATH apuntando a ../src)
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import date, datetime, timedelta, timezone

from fastapi import Body, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError, WriteError

import queries as q
from wikipipe import config, crud

app = FastAPI(title="Wikipedia en vivo · API", docs_url="/api/docs", openapi_url="/api/openapi.json")

CLAVE = os.getenv("DASHBOARD_PASSWORD", "")
COOKIE = "wp_session"
PUBLICAS = {"/api/login", "/api/session", "/api/health"}


def _token() -> str:
    return hmac.new(CLAVE.encode(), b"wikipipe-dashboard", hashlib.sha256).hexdigest()


@app.middleware("http")
async def autenticacion(request: Request, call_next):
    ruta = request.url.path
    if CLAVE and ruta.startswith("/api") and ruta not in PUBLICAS and not ruta.startswith("/api/docs") \
            and ruta != "/api/openapi.json":
        if not hmac.compare_digest(request.cookies.get(COOKIE, ""), _token()):
            return JSONResponse({"detail": "No autenticado"}, status_code=401)
    return await call_next(request)


class Login(BaseModel):
    password: str


@app.post("/api/login")
def login(body: Login, response: Response):
    if not CLAVE or hmac.compare_digest(body.password, CLAVE):
        response.set_cookie(COOKIE, _token() if CLAVE else "", httponly=True, samesite="lax", max_age=60 * 60 * 24 * 7)
        return {"ok": True}
    raise HTTPException(401, "Contraseña incorrecta")


@app.get("/api/session")
def session(request: Request):
    return {"requiere_clave": bool(CLAVE),
            "autenticado": not CLAVE or hmac.compare_digest(request.cookies.get(COOKIE, ""), _token())}


@app.get("/api/health")
def health():
    return {"ok": True, "hora": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------- lectura
# El filtro global del dashboard envía wiki=ambas|enwiki|eswiki; "ambas" combina las dos wikis.


def wikis_de(wiki: str) -> list[str]:
    if wiki in ("ambas", "todas", ""):
        return sorted(config.WIKIS)
    if wiki not in config.WIKIS:
        raise HTTPException(400, f"Wiki no válida: {wiki}")
    return [wiki]


def sumar_por(filas: list[dict], clave: str, campos: tuple[str, ...]) -> list[dict]:
    """Suma campos numéricos de filas que comparten la misma clave (p. ej. el mismo minuto)."""
    acumulado: dict = {}
    for f in filas:
        a = acumulado.setdefault(f[clave], {clave: f[clave], **{c: 0 for c in campos}})
        for c in campos:
            a[c] += f.get(c) or 0
    return sorted(acumulado.values(), key=lambda x: x[clave])


@app.get("/api/resumen")
def resumen(wiki: str = "ambas"):
    w = None if wiki == "ambas" else wikis_de(wiki)[0]
    series = q.kpis(72, w)
    latest = series["eventos_procesados"][0]["ventana"] if series["eventos_procesados"] else None
    end = (datetime.fromisoformat(latest) + timedelta(hours=1)).isoformat() if latest else None
    return {"kpis": series, "horas": q.resumen_por_hora(2), "ejecuciones": q.ejecuciones(2),
            "total": q.total_eventos(), "desde": q.primer_evento(), "wiki": wiki,
            "intervalo": {"inicio": latest, "fin": end}, "corte": end,
            "acumulado": q.resumen_acumulado(end, w) if end else None}


@app.get("/api/resumen/acumulado/protagonistas")
def protagonistas_acumulados(corte: datetime, wiki: str = "ambas"):
    if corte.tzinfo is None:
        raise HTTPException(status_code=400, detail="El corte debe incluir su zona horaria")
    w = None if wiki == "ambas" else wikis_de(wiki)[0]
    return q.protagonistas_acumulados(corte.isoformat(), w)


@app.get("/api/estado")
def estado():
    """Estado de las dos capas para la cabecera del dashboard (consulta liviana)."""
    return q.estado()


@app.get("/api/vivo")
def vivo(minutos: int = 30, wiki: str = "ambas"):
    return q.vivo(min(max(minutos, 5), 120), wikis_de(wiki))


@app.get("/api/serie10")
def serie10(wiki: str = "ambas", fecha: date | None = None):
    fechas = q.fechas_con_datos()
    fecha = fecha or (date.fromisoformat(fechas[0]) if fechas else datetime.now(timezone.utc).date())
    filas = [f for w in wikis_de(wiki) for d in q.fechas_utc(fecha) for f in q.serie_10min(w, d)
             if datetime.fromisoformat(f["t"]).astimezone(q.ZONA).date() == fecha]
    return {"fecha": fecha.isoformat(), "serie": sumar_por(filas, "t", ("eventos", "eventos_bot", "reversiones"))}


@app.get("/api/actividad")
def actividad(wiki: str = "ambas", fecha: date | None = None):
    wikis = wikis_de(wiki)
    fechas = q.fechas_con_datos()
    completed = q.completed_runs(0)
    fecha = fecha or (datetime.fromisoformat(completed[0]["window_start"]).astimezone(q.ZONA).date() if completed
                      else date.fromisoformat(fechas[0]) if fechas else datetime.now(q.ZONA).date())
    fechas = sorted(set([*fechas, fecha.isoformat()]), reverse=True)
    # `fecha` es un día en UTC−5: se leen las dos fechas UTC que lo cubren, se quedan las filas de ese día
    # y la hora se devuelve en UTC−5.
    def del_dia(f: date, h: int):
        local = q.a_zona(f, h)
        return local.hour if local.date() == fecha else None

    horas = [{**h, "hora": hl} for h in q.resumen_por_hora(30)
             if h["wiki"] in wikis and (hl := del_dia(h["fecha"], h["hora"])) is not None]
    minutos = [{**m, "wiki": w} for w in wikis for d in q.fechas_utc(fecha) for m in q.serie_minuto(w, d)
               if datetime.fromisoformat(m["t"]).astimezone(q.ZONA).date() == fecha]
    runs = [run for run in completed
            if datetime.fromisoformat(run["window_start"]).astimezone(q.ZONA).date() == fecha]
    stable = q.stable_windows(runs)

    def hour_key(iso: str) -> str:
        return datetime.fromisoformat(iso).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()

    horas = [h for h in horas if hour_key(h["hora_utc"]) in stable]
    covered = {(h["wiki"], hour_key(h["hora_utc"])) for h in horas}
    pending = [m for m in minutos if (m["wiki"], hour_key(m["t"])) not in covered]
    minutos = [m for m in minutos if (m["wiki"], hour_key(m["t"])) in covered]
    # Top de páginas: con "ambas" se juntan los dos rankings de cada hora y se vuelve a ordenar.
    top = []
    por_hora: dict = {}
    for t in (t for w in wikis for d in q.fechas_utc(fecha) for t in q.paginas_top(w, d)):
        start = datetime.combine(t["fecha"], datetime.min.time(), timezone.utc).replace(hour=t["hora"])
        if (t["wiki"], start.isoformat()) in covered and (hl := del_dia(t["fecha"], t["hora"])) is not None:
            por_hora.setdefault(hl, []).append({**t, "hora": hl})
    for hora, filas in por_hora.items():
        filas.sort(key=lambda t: (-t["editores"], -t["ediciones"]))
        top += [{**t, "posicion": i} for i, t in enumerate(filas[:20], start=1)]
    return {"fecha": fecha.isoformat(), "fechas": fechas,
            "minutos": sumar_por(minutos, "t", ("eventos", "eventos_bot", "reversiones")),
            "horas": sumar_por(horas, "hora", ("eventos", "eventos_bot", "eventos_humanos", "reversiones")),
            "top": top, "alcance": "consolidado",
            "corte": (max(datetime.fromisoformat(start) for _, start in covered) + timedelta(hours=1)).isoformat() if covered else None,
            "pendientes": {"eventos": sum(m["eventos"] or 0 for m in pending), "horas": len({hour_key(m["t"]) for m in pending})}}


@app.get("/api/editor/{nombre}")
def editor(nombre: str):
    return q.actividad_editor(nombre)


@app.get("/api/eventos")
def eventos(wiki: str = "ambas", tipo: str = "todos", editor: str = "", titulo: str = "",
            limite: int = 50):
    w = None if wiki == "ambas" else wikis_de(wiki)[0]
    return {**q.dataset_eventos(w),
            "eventos": q.buscar_eventos("todas" if w is None else w, tipo, editor.strip(), titulo.strip(), min(limite, 500))}


@app.get("/api/eventos/{event_id}")
def evento(event_id: str):
    doc = q.documento(event_id)
    if doc is None:
        raise HTTPException(404, "No existe ese evento")
    return doc


@app.get("/api/arquitectura")
def arquitectura():
    return q.arquitectura()


@app.get("/api/arquitectura/ejemplo")
def arquitectura_ejemplo(tipo: str | None = None):
    if tipo not in (None, "edit", "new", "categorize", "log"):
        raise HTTPException(400, "Tipo no válido")
    doc = q.ejemplo_evento(tipo)
    if doc is None:
        raise HTTPException(404, "No hay eventos de ese tipo")
    return doc


@app.get("/api/red")
def red(wiki: str = "ambas"):
    w = None if wiki == "ambas" else wikis_de(wiki)[0]
    return {"tarjetas": q.tarjetas_red(24, w), "revertidos": q.ranking_revertidos(10, w),
            "patrulleros": q.ranking_patrulleros(10, w), "conectados": q.ranking_conectados(10, 24, w),
            "disputadas": q.paginas_disputadas(24, 12, w)}


@app.get("/api/red/ego/{nombre}")
def ego(nombre: str, limite: int = 30, wiki: str = "ambas"):
    selected = None if wiki == "ambas" else wikis_de(wiki)[0]
    return q.ego_red(nombre, min(max(limite, 1), 150), selected)


# ---------------------------------------------------------------- CRUD (reutiliza wikipipe.crud)


class CambiosMongo(BaseModel):
    """Campos a cambiar con su nuevo valor, por ruta con punto: {"comment": "…", "length.new": 1350}."""
    cambios: dict[str, str | int | float | bool | None]


@app.post("/api/crud/mongo/previa")
def mongo_previa(doc: dict = Body(...)):
    """Lo que se guardaría: el bloque derived calculado y los campos que el validador echaría en falta."""
    preparado, faltan = crud.preparar_evento(doc)
    return {"derived": preparado.get("derived"), "faltan": faltan}


@app.post("/api/crud/mongo")
def mongo_crear(doc: dict = Body(...)):
    """Inserta el documento tal como viene, con derived calculado por el servidor.

    Si le faltan campos, se envía igual: el validador $jsonSchema de MongoDB lo rechaza y la
    respuesta lo indica con rechazado=True (no es un error de la API, es la demostración del validador).
    """
    preparado, faltan = crud.preparar_evento(doc)
    try:
        crud.mongo_crear(q.mongo_db(), preparado)
    except DuplicateKeyError:
        raise HTTPException(409, "Ya existe un documento con ese _id")
    except WriteError as exc:
        return {"rechazado": True, "faltan": faltan, "motivo": exc.details.get("errmsg")}
    q.limpiar_cache()
    return {"rechazado": False, "documento": crud.mongo_consultar(q.mongo_db(), preparado["_id"])}


PERIODOS = {"hora": 1, "dia": 24, "semana": 168, "todo": None}


@app.get("/api/crud/mongo/buscar")
def mongo_buscar(wiki: str = "enwiki", tipo: str = "todos", periodo: str = "dia", editor: str = "", titulo: str = "",
                 demo: bool = False, id: str = "", antes: datetime | None = None, limite: int = 10, antes_id: str = ""):
    if wiki not in ("enwiki", "eswiki") or tipo not in ("todos", "edit", "new", "categorize", "log") or periodo not in PERIODOS:
        raise HTTPException(400, "Filtro no válido")
    return q.crud_buscar(wiki, tipo, PERIODOS[periodo], editor.strip(), titulo.strip(), demo, id.strip(),
                         antes, min(max(limite, 1), 50), antes_id)


@app.get("/api/crud/mongo/{event_id}")
def mongo_leer(event_id: str):
    doc = crud.mongo_consultar(q.mongo_db(), event_id)
    if doc is None:
        raise HTTPException(404, "No existe ese documento")
    return doc


@app.patch("/api/crud/mongo/{event_id}")
def mongo_actualizar(event_id: str, body: CambiosMongo):
    """update_one con $set de los campos cambiados y de los derived que haya que recalcular."""
    actual = crud.mongo_consultar(q.mongo_db(), event_id)
    if actual is None:
        raise HTTPException(404, "No existe ese documento")
    if not body.cambios:
        raise HTTPException(400, "No hay cambios que guardar")
    try:
        poner, quitar, recalculados, faltan = crud.preparar_actualizacion(actual, body.cambios)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if faltan:
        raise HTTPException(422, f"El documento quedaría incompleto: falta {', '.join(faltan)}")
    operacion = {"$set": poner, **({"$unset": quitar} if quitar else {})}
    try:
        n = q.mongo_db().events.update_one({"_id": event_id}, operacion).modified_count
    except WriteError as exc:
        raise HTTPException(422, f"MongoDB rechazó el cambio: {exc.details.get('errmsg')}")
    q.limpiar_cache()
    return {"modificados": n, "recalculados": recalculados, "documento": crud.mongo_consultar(q.mongo_db(), event_id)}


@app.delete("/api/crud/mongo/{event_id}")
def mongo_eliminar(event_id: str):
    n = crud.mongo_eliminar(q.mongo_db(), event_id)
    q.limpiar_cache()
    return {"eliminados": n}


def _fila_kpi(r) -> dict:
    return {"kpi": r.kpi, "ventana": r.ventana.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            "valor": r.valor, "detalle": r.detalle}


def _hora(ventana: datetime) -> datetime:
    """La ventana de un KPI es el inicio de una hora en UTC."""
    v = ventana.astimezone(timezone.utc) if ventana.tzinfo else ventana.replace(tzinfo=timezone.utc)
    return v.replace(minute=0, second=0, microsecond=0)


class FilaKpi(BaseModel):
    kpi: str = Field(min_length=1)
    ventana: datetime
    valor: float | None = None
    detalle: str | None = None


class CambiosKpi(BaseModel):
    kpi: str
    ventana: datetime
    cambios: dict[str, float | str | None]


@app.get("/api/crud/cassandra/kpis")
def cassandra_kpis():
    """Los KPIs que se pueden consultar: los 12 reales y los de demostración que existan."""
    nombres = crud.kpi_nombres(q.cassandra())
    return {"reales": q.KPIS, "demo": [n for n in nombres if crud.es_kpi_demo(n)]}


@app.get("/api/crud/cassandra/ultimas")
def cassandra_ultimas():
    """Las 5 filas más recientes de la tabla kpis, para elegir datos de prueba."""
    return [_fila_kpi(r) for r in crud.kpi_ultimas(q.cassandra())]


@app.post("/api/crud/cassandra")
def cassandra_insertar(f: FilaKpi):
    """INSERT de una fila completa. En Cassandra, si la clave ya existe la fila se reemplaza (upsert)."""
    s, v = q.cassandra(), _hora(f.ventana)
    existia = crud.kpi_fila(s, f.kpi, v) is not None
    crud.kpi_insertar(s, f.kpi, v, f.valor, f.detalle)
    q.limpiar_cache()
    return {"reemplazo": existia, "fila": _fila_kpi(crud.kpi_fila(s, f.kpi, v))}


@app.get("/api/crud/cassandra/fila")
def cassandra_una_fila(kpi: str, ventana: datetime):
    r = crud.kpi_fila(q.cassandra(), kpi, _hora(ventana))
    if r is None:
        raise HTTPException(404, "No hay una fila con esa clave")
    return _fila_kpi(r)


@app.get("/api/crud/cassandra")
def cassandra_leer(kpi: str, fecha: date | None = None, hora: int | None = None, limite: int = 48):
    """SELECT por partición (el KPI), opcionalmente de un día y una hora (UTC). Con día y hora, el rango de
    ventana cubre una sola fila; con hora sin día, se filtran las últimas filas de esa hora."""
    if hora is not None and not 0 <= hora <= 23:
        raise HTTPException(400, "La hora va de 0 a 23")
    desde = datetime.combine(fecha, datetime.min.time(), timezone.utc) if fecha else None
    hasta = desde + timedelta(days=1) if desde else None
    if desde and hora is not None:
        desde += timedelta(hours=hora)
        hasta = desde + timedelta(hours=1)
    filas = crud.kpi_consultar(q.cassandra(), kpi, desde, hasta, min(max(limite, 1), 500))
    if hora is not None and not fecha:
        filas = [r for r in filas if r.ventana.hour == hora]
    return [_fila_kpi(r) for r in filas]


@app.patch("/api/crud/cassandra")
def cassandra_actualizar(body: CambiosKpi):
    s, v = q.cassandra(), _hora(body.ventana)
    if crud.kpi_fila(s, body.kpi, v) is None:
        raise HTTPException(404, "No hay una fila con esa clave (en Cassandra, UPDATE la crearía)")
    try:
        crud.kpi_actualizar(s, body.kpi, v, body.cambios)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    q.limpiar_cache()
    return _fila_kpi(crud.kpi_fila(s, body.kpi, v))


@app.delete("/api/crud/cassandra")
def cassandra_eliminar(kpi: str, ventana: datetime | None = None):
    """Sin ventana borra la partición entera del KPI; con ventana, una sola fila."""
    s = q.cassandra()
    if ventana is None:
        n = len(crud.kpi_consultar(s, kpi, limite=100000))
        crud.kpi_eliminar(s, kpi)
    else:
        v = _hora(ventana)
        n = 1 if crud.kpi_fila(s, kpi, v) is not None else 0
        crud.kpi_eliminar(s, kpi, v)
    q.limpiar_cache()
    return {"filas_eliminadas": n}


TIPOS_EDITOR = ("registrado", "temporal", "ip", "bot")


class NodoEditor(BaseModel):
    user: str = Field(min_length=1)
    tipo: str = "registrado"


class Relacion(BaseModel):
    origen: str = Field(min_length=1)
    destino: str = Field(min_length=1)
    tipo: str
    veces: int = Field(1, ge=1)
    wiki: str | None = None


class CambiosNodo(BaseModel):
    cambios: dict[str, str | int | float | bool]


@app.post("/api/crud/neo4j/editor")
def neo_crear_editor(n: NodoEditor):
    n.user = n.user.strip()
    if not n.user:
        raise HTTPException(400, "El nombre del editor es obligatorio")
    if n.tipo not in TIPOS_EDITOR:
        raise HTTPException(400, "Tipo de editor no válido")
    existia = crud.neo4j_detalle_editor(q.neo4j(), n.user, 0) is not None
    editor = crud.neo4j_crear_editor(q.neo4j(), n.user, n.tipo)
    q.limpiar_cache()
    return {"creado": not existia, "editor": editor}


@app.post("/api/crud/neo4j/relacion")
def neo_crear_relacion(r: Relacion):
    """MERGE de la relación; si alguno de los dos editores no existe, se crea con él."""
    if not r.origen.strip() or not r.destino.strip():
        raise HTTPException(400, "Los nombres de los editores son obligatorios")
    if r.wiki is not None and r.wiki not in config.WIKIS:
        raise HTTPException(400, "Wiki no válida")
    if r.tipo not in crud.RELACIONES_EDITOR:
        raise HTTPException(400, "Tipo de relación no permitido")
    d = q.neo4j()
    nuevos = [u for u in (r.origen, r.destino) if crud.neo4j_asegurar_editor(d, u)]
    props = {"veces": r.veces, **({"wiki": r.wiki} if r.wiki else {})}
    res = crud.neo4j_crear_relacion(d, r.origen, r.destino, r.tipo, props)
    q.limpiar_cache()
    return {"relacion": res, "nodos_nuevos": nuevos}


@app.get("/api/crud/neo4j/ultimos")
def neo_ultimos():
    """Los 5 editores con actividad más reciente, para elegir datos de prueba."""
    return crud.neo4j_ultimos_editores(q.neo4j())


@app.get("/api/crud/neo4j/editores")
def neo_buscar(prefijo: str, tipo: str | None = None, limite: int = 10):
    if not prefijo.strip():
        raise HTTPException(400, "Escribe el comienzo del nombre del editor")
    return crud.neo4j_buscar_editores(q.neo4j(), prefijo.strip(), tipo if tipo in TIPOS_EDITOR else None, min(max(limite, 1), 50))


@app.get("/api/crud/neo4j/editor/{user}")
def neo_leer(user: str):
    res = crud.neo4j_detalle_editor(q.neo4j(), user)
    if res is None:
        raise HTTPException(404, "Ese editor no existe")
    return res


@app.patch("/api/crud/neo4j/editor/{user}")
def neo_actualizar(user: str, body: CambiosNodo):
    if "user" in body.cambios:
        raise HTTPException(400, "La clave única (user) no se puede cambiar")
    if "tipo" in body.cambios and body.cambios["tipo"] not in TIPOS_EDITOR:
        raise HTTPException(400, "Tipo de editor no válido")
    res = crud.neo4j_actualizar_editor(q.neo4j(), user, body.cambios)
    if res is None:
        raise HTTPException(404, "Ese editor no existe")
    q.limpiar_cache()
    return res


@app.delete("/api/crud/neo4j/relacion")
def neo_eliminar_relacion(origen: str, destino: str, tipo: str, relacion_id: str | None = None):
    try:
        n = crud.neo4j_eliminar_relacion(q.neo4j(), origen, destino, tipo, relacion_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    q.limpiar_cache()
    return {"relaciones_eliminadas": n}


@app.delete("/api/crud/neo4j/editor/{user}")
def neo_eliminar_editor(user: str):
    d = crud.neo4j_detalle_editor(q.neo4j(), user, 0)
    n = crud.neo4j_eliminar_nodo(q.neo4j(), "Editor", "user", user)
    q.limpiar_cache()
    return {"nodos_eliminados": n, "relaciones_eliminadas": (d["n_salientes"] + d["n_entrantes"]) if d else 0}
