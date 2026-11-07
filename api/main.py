"""API del dashboard (FastAPI): lectura de las tres bases y operaciones CRUD.

Autenticación opcional: si DASHBOARD_PASSWORD está definida, todas las rutas /api (salvo /api/login,
/api/session y /api/health) exigen la cookie de sesión que entrega /api/login.

Uso local: uvicorn main:app --reload --port 8000   (con PYTHONPATH apuntando a ../src)
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import date, datetime, timezone

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
    return {"kpis": q.kpis(72, w), "horas": q.resumen_por_hora(2), "ejecuciones": q.ejecuciones(2),
            "total": q.total_eventos()}


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
    filas = [f for w in wikis_de(wiki) for f in q.serie_10min(w, fecha)]
    return {"fecha": fecha.isoformat(), "serie": sumar_por(filas, "t", ("eventos", "eventos_bot", "reversiones"))}


@app.get("/api/actividad")
def actividad(wiki: str = "ambas", fecha: date | None = None):
    wikis = wikis_de(wiki)
    fechas = q.fechas_con_datos()
    fecha = fecha or (date.fromisoformat(fechas[0]) if fechas else datetime.now(timezone.utc).date())
    horas = [h for h in q.resumen_por_hora(30) if h["wiki"] in wikis and h["fecha"] == fecha]
    minutos = [m for w in wikis for m in q.serie_minuto(w, fecha)]
    # Top de páginas: con "ambas" se juntan los dos rankings de cada hora y se vuelve a ordenar.
    top = []
    por_hora: dict = {}
    for t in (t for w in wikis for t in q.paginas_top(w, fecha)):
        por_hora.setdefault(t["hora"], []).append(t)
    for hora, filas in por_hora.items():
        filas.sort(key=lambda t: (-t["editores"], -t["ediciones"]))
        top += [{**t, "posicion": i} for i, t in enumerate(filas[:20], start=1)]
    return {"fecha": fecha.isoformat(), "fechas": fechas,
            "minutos": sumar_por(minutos, "t", ("eventos", "eventos_bot", "reversiones")),
            "horas": sumar_por(horas, "hora", ("eventos", "eventos_bot", "eventos_humanos", "reversiones")),
            "top": top}


@app.get("/api/editor/{nombre}")
def editor(nombre: str):
    return q.actividad_editor(nombre)


@app.get("/api/eventos")
def eventos(wiki: str = "ambas", tipo: str = "todos", editor: str = "", titulo: str = "",
            solo_reversiones: bool = False, limite: int = 50):
    return {"total": q.total_eventos(), "tipos": q.tipos_por_wiki(24),
            "eventos": q.buscar_eventos("todas" if wiki == "ambas" else wikis_de(wiki)[0], tipo, editor.strip(), titulo.strip(), solo_reversiones, min(limite, 500))}


@app.get("/api/eventos/{event_id}")
def evento(event_id: str):
    doc = q.documento(event_id)
    if doc is None:
        raise HTTPException(404, "No existe ese evento")
    return doc


@app.get("/api/red")
def red(wiki: str = "ambas"):
    w = None if wiki == "ambas" else wikis_de(wiki)[0]
    return {"conteo": q.conteo_grafo() if w is None else q.conteo_grafo_wiki(w), "revertidos": q.ranking_revertidos(10, w),
            "patrulleros": q.ranking_patrulleros(10, w), "disputadas": q.paginas_disputadas(24, 12, w)}


@app.get("/api/red/ego/{nombre}")
def ego(nombre: str, limite: int = 30):
    return q.ego_red(nombre, min(limite, 150))


# ---------------------------------------------------------------- CRUD (reutiliza wikipipe.crud)


class CambioMongo(BaseModel):
    campo: str
    valor: str | int | float | bool


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
                 demo: bool = False, id: str = "", antes: datetime | None = None, limite: int = 10):
    if wiki not in ("enwiki", "eswiki") or tipo not in ("todos", "edit", "new", "categorize", "log") or periodo not in PERIODOS:
        raise HTTPException(400, "Filtro no válido")
    return q.crud_buscar(wiki, tipo, PERIODOS[periodo], editor.strip(), titulo.strip(), demo, id.strip(),
                         antes, min(max(limite, 1), 50))


@app.get("/api/crud/mongo/{event_id}")
def mongo_leer(event_id: str):
    doc = crud.mongo_consultar(q.mongo_db(), event_id)
    if doc is None:
        raise HTTPException(404, "No existe ese documento")
    return doc


@app.patch("/api/crud/mongo/{event_id}")
def mongo_actualizar(event_id: str, body: CambioMongo):
    if body.campo in ("_id",):
        raise HTTPException(400, "El _id no se puede modificar")
    n = crud.mongo_actualizar(q.mongo_db(), event_id, {body.campo: body.valor})
    q.limpiar_cache()
    return {"modificados": n, "documento": crud.mongo_consultar(q.mongo_db(), event_id)}


@app.delete("/api/crud/mongo/{event_id}")
def mongo_eliminar(event_id: str):
    n = crud.mongo_eliminar(q.mongo_db(), event_id)
    q.limpiar_cache()
    return {"eliminados": n}


class FilaCassandra(BaseModel):
    editor: str
    fecha: date
    hora: int = Field(ge=0, le=23)
    wiki: str
    eventos: int = 0
    ediciones: int = 0


@app.post("/api/crud/cassandra")
def cassandra_insertar(f: FilaCassandra):
    crud.cassandra_insertar(q.cassandra(), {
        "editor": f.editor, "fecha": f.fecha, "hora": f.hora, "wiki": f.wiki, "tipo_editor": "registrado",
        "eventos": f.eventos, "ediciones": f.ediciones, "paginas": 1, "delta_bytes": 0,
        "reversiones_hechas": 0, "reversiones_recibidas": 0})
    q.limpiar_cache()
    return cassandra_leer(f.editor)


@app.get("/api/crud/cassandra")
def cassandra_leer(editor: str):
    return [q._fila(r) for r in crud.cassandra_consultar(q.cassandra(), editor, limite=50)]


@app.patch("/api/crud/cassandra")
def cassandra_actualizar(f: FilaCassandra):
    crud.cassandra_actualizar(q.cassandra(), f.editor, f.fecha, f.hora, f.wiki, f.eventos, f.ediciones)
    q.limpiar_cache()
    return cassandra_leer(f.editor)


@app.delete("/api/crud/cassandra")
def cassandra_eliminar(editor: str, fecha: date, hora: int, wiki: str):
    crud.cassandra_eliminar(q.cassandra(), editor, fecha, hora, wiki)
    q.limpiar_cache()
    return cassandra_leer(editor)


class NodoEditor(BaseModel):
    user: str
    tipo: str = "registrado"


class Relacion(BaseModel):
    origen: str
    destino: str
    tipo: str
    veces: int = 1


class Propiedad(BaseModel):
    clave: str
    valor: str | int | float | bool


@app.post("/api/crud/neo4j/editor")
def neo_crear_editor(n: NodoEditor):
    q.limpiar_cache()
    return crud.neo4j_crear_editor(q.neo4j(), n.user, n.tipo)


@app.post("/api/crud/neo4j/relacion")
def neo_crear_relacion(r: Relacion):
    try:
        res = crud.neo4j_crear_relacion(q.neo4j(), r.origen, r.destino, r.tipo, {"veces": r.veces})
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if res is None:
        raise HTTPException(404, "Alguno de los dos editores no existe")
    q.limpiar_cache()
    return res


@app.get("/api/crud/neo4j/editor/{user}")
def neo_leer(user: str):
    res = crud.neo4j_consultar_editor(q.neo4j(), user)
    if res is None:
        raise HTTPException(404, "Ese editor no existe")
    return res


@app.patch("/api/crud/neo4j/editor/{user}")
def neo_actualizar(user: str, p: Propiedad):
    if p.clave == "user":
        raise HTTPException(400, "La clave única no se puede cambiar")
    res = crud.neo4j_actualizar_editor(q.neo4j(), user, {p.clave: p.valor})
    if res is None:
        raise HTTPException(404, "Ese editor no existe")
    q.limpiar_cache()
    return res


@app.delete("/api/crud/neo4j/relacion")
def neo_eliminar_relacion(origen: str, destino: str, tipo: str):
    try:
        n = crud.neo4j_eliminar_relacion(q.neo4j(), origen, destino, tipo)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    q.limpiar_cache()
    return {"relaciones_eliminadas": n}


@app.delete("/api/crud/neo4j/editor/{user}")
def neo_eliminar_editor(user: str):
    n = crud.neo4j_eliminar_nodo(q.neo4j(), "Editor", "user", user)
    q.limpiar_cache()
    return {"nodos_eliminados": n}
