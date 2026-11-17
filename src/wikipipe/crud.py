"""Operaciones CRUD de las tres bases (sección 4 de las instrucciones) y una demo para la exposición.

MongoDB   : crear, consultar, actualizar y eliminar un documento de la colección `events`.
Cassandra : insertar, consultar, actualizar y eliminar filas de la tabla `kpis`.
Neo4j     : crear nodos, crear una relación, actualizar propiedades y eliminar relaciones y nodos.

Las funciones las reutiliza la página de CRUD del dashboard. La demo usa entidades marcadas
como "demo" que crea y luego borra, así no altera los datos reales del pipeline.

Uso (dentro del contenedor de Airflow, que tiene las conexiones configuradas):
    docker compose exec airflow python -m wikipipe.crud mongo
    docker compose exec airflow python -m wikipipe.crud cassandra
    docker compose exec airflow python -m wikipipe.crud neo4j
    docker compose exec airflow python -m wikipipe.crud todo
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone

from pymongo.errors import WriteError

# ============================== MongoDB ==============================


def mongo_crear(db, documento: dict) -> str:
    """Inserta un documento en `events`. El validador $jsonSchema rechaza los que no cumplen."""
    return db.events.insert_one(documento).inserted_id


def mongo_consultar(db, event_id: str) -> dict | None:
    return db.events.find_one({"_id": event_id})


def mongo_buscar(db, filtro: dict, limite: int = 5) -> list[dict]:
    return list(db.events.find(filtro).sort("derived.event_dt", -1).limit(limite))


def mongo_actualizar(db, event_id: str, cambios: dict) -> int:
    """Modifica campos con $set. Devuelve cuántos documentos cambiaron."""
    return db.events.update_one({"_id": event_id}, {"$set": cambios}).modified_count


def mongo_eliminar(db, event_id: str) -> int:
    return db.events.delete_one({"_id": event_id}).deleted_count


CAMPOS_TEXTO = ("_id", "wiki", "title", "user")
TIPOS = ("edit", "new", "categorize", "log")


def preparar_evento(documento: dict) -> tuple[dict, list[str]]:
    """Prepara un evento escrito a mano (página CRUD) para insertarlo en `events`.

    Calcula `derived` con la misma función que usa el pipeline (clean.derive). Si faltan campos,
    no inventa nada: devuelve el documento sin `derived` y la lista de lo que falta, y al insertarlo
    el validador $jsonSchema de MongoDB lo rechaza.
    """
    from wikipipe import mongo
    from wikipipe.clean import derive

    doc = {k: v for k, v in documento.items() if k != "derived"}
    faltan = [k for k in CAMPOS_TEXTO if not isinstance(doc.get(k), str) or not doc[k].strip()]
    if doc.get("type") not in TIPOS:
        faltan.append("type")
    if not isinstance(doc.get("namespace"), int) or isinstance(doc.get("namespace"), bool):
        faltan.append("namespace")
    meta = doc.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("dt"), str):
        faltan.append("meta.dt")
    else:
        meta.setdefault("id", doc.get("_id"))
        if meta["id"] != doc.get("_id"):
            faltan.append("meta.id (debe coincidir con _id)")
    if faltan:
        return mongo.sanitize(doc), faltan
    try:
        doc["derived"] = derive(doc)
    except (KeyError, TypeError, ValueError, AttributeError):
        return mongo.sanitize(doc), ["derived (revisa meta.dt)"]
    return mongo.to_document(doc), []


PROTEGIDOS = ("_id", "derived", "meta.id")


def preparar_actualizacion(actual: dict, cambios: dict) -> tuple[dict, dict, list[str], list[str]]:
    """Arma el update_one de la página CRUD: los campos que cambió la persona más los de `derived` que
    hay que recalcular para que el documento siga siendo coherente (p. ej. delta_bytes si cambian los bytes).

    Devuelve ($set, $unset, campos recalculados, campos que faltarían). `cambios` usa rutas con punto
    ("length.new"); `_id`, `meta.id` y `derived` no se pueden cambiar a mano.
    """
    import copy

    for ruta in cambios:
        if any(ruta == field or ruta.startswith(field + ".") for field in PROTEGIDOS) or ruta.startswith("$"):
            raise ValueError(f"El campo «{ruta}» no se puede modificar")
    nuevo = copy.deepcopy(actual)
    for ruta, valor in cambios.items():
        *padres, hoja = ruta.split(".")
        destino = nuevo
        for p in padres:
            if not isinstance(destino.get(p), dict):
                destino[p] = {}
            destino = destino[p]
        destino[hoja] = valor
    preparado, faltan = preparar_evento(nuevo)
    if faltan:
        return {}, {}, [], faltan

    antes, despues = actual.get("derived") or {}, preparado["derived"]
    normal = lambda v: v.replace(tzinfo=None) if isinstance(v, datetime) else v  # noqa: E731
    poner = {f"derived.{k}": v for k, v in despues.items() if normal(antes.get(k)) != normal(v)}
    quitar = {f"derived.{k}": "" for k in antes if k not in despues}
    return {**cambios, **poner}, quitar, sorted([*poner, *quitar]), []


def evento_demo(event_id: str) -> dict:
    """Documento con la misma estructura que un evento real del stream (pasa el validador)."""
    ahora = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "_id": event_id,
        "meta": {"id": event_id, "dt": ahora.isoformat().replace("+00:00", "Z"), "domain": "demo"},
        "type": "edit",
        "wiki": "enwiki",
        "title": "Demo CRUD",
        "namespace": 0,
        "user": "Demo_Editor",
        "bot": False,
        "comment": "Edición creada para la demostración del CRUD",
        "length": {"old": 1000, "new": 1200},
        "derived": {
            "event_dt": ahora,
            "event_time": ahora.isoformat().replace("+00:00", "Z"),
            "date": ahora.strftime("%Y-%m-%d"),
            "hour": ahora.hour,
            "minute": ahora.strftime("%Y-%m-%dT%H:%M"),
            "user_type": "registrado",
            "page_key": "enwiki:Demo CRUD",
            "delta_bytes": 200,
        },
    }


# ============================== Cassandra ==============================
# El CRUD trabaja sobre la tabla `kpis`, clave ((kpi), ventana): cada fila es el valor ya calculado de un KPI en
# una hora. Para no alterar los KPIs reales, solo se escribe sobre KPIs de demostración («demo_…»), que el
# dashboard no muestra porque no tienen tarjeta.

PREFIJO_KPI_DEMO = "demo_"


def es_kpi_demo(kpi: str) -> bool:
    return kpi.startswith(PREFIJO_KPI_DEMO)


def kpi_insertar(session, kpi: str, ventana: datetime, valor: float | None, detalle: str | None) -> None:
    """INSERT de una fila completa. Si la clave ya existe, Cassandra la reemplaza (no hay error de duplicado)."""
    session.execute("INSERT INTO kpis (kpi, ventana, valor, detalle) VALUES (%s, %s, %s, %s)", (kpi, ventana, valor, detalle))


def kpi_fila(session, kpi: str, ventana: datetime):
    """Una fila por su clave primaria completa, o None."""
    return session.execute("SELECT * FROM kpis WHERE kpi = %s AND ventana = %s", (kpi, ventana)).one()


def kpi_consultar(session, kpi: str, desde: datetime | None = None, hasta: datetime | None = None, limite: int = 24) -> list:
    """Serie de un KPI (una partición), de la hora más reciente a la más antigua; opcionalmente, un rango."""
    if desde and hasta:
        return list(session.execute("SELECT * FROM kpis WHERE kpi = %s AND ventana >= %s AND ventana < %s LIMIT %s",
                                    (kpi, desde, hasta, limite)))
    return list(session.execute("SELECT * FROM kpis WHERE kpi = %s LIMIT %s", (kpi, limite)))


def kpi_nombres(session) -> list[str]:
    """Los KPIs que tienen filas: SELECT DISTINCT sobre la clave de partición."""
    return sorted(r.kpi for r in session.execute("SELECT DISTINCT kpi FROM kpis"))


def kpi_ultimas(session, n: int = 5) -> list:
    """Las n filas más recientes de la tabla: la última de cada partición (KPI), de la más nueva a la más antigua."""
    filas = []
    for kpi in kpi_nombres(session):
        filas += kpi_consultar(session, kpi, limite=n)
    return sorted(filas, key=lambda r: r.ventana, reverse=True)[:n]


def kpi_actualizar(session, kpi: str, ventana: datetime, cambios: dict) -> None:
    """UPDATE solo de las columnas que cambian (la clave no se puede cambiar: sería otra fila)."""
    if not cambios or any(c not in ("valor", "detalle") for c in cambios):
        raise ValueError("Solo se pueden cambiar el valor y el detalle")
    if "valor" in cambios and cambios["valor"] is not None:
        import math
        value = cambios["valor"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("El valor debe ser un número finito o null")
    if "detalle" in cambios and cambios["detalle"] is not None and not isinstance(cambios["detalle"], str):
        raise ValueError("El detalle debe ser texto o null")
    # Los nombres de columna se validan contra una lista fija antes de entrar a la consulta.
    sets = ", ".join(f"{c} = %s" for c in cambios)
    session.execute(f"UPDATE kpis SET {sets} WHERE kpi = %s AND ventana = %s", (*cambios.values(), kpi, ventana))


def kpi_eliminar(session, kpi: str, ventana: datetime | None = None) -> None:
    """Borra una fila (clave completa) o la partición entera del KPI (solo `kpi`)."""
    if ventana is None:
        session.execute("DELETE FROM kpis WHERE kpi = %s", (kpi,))
    else:
        session.execute("DELETE FROM kpis WHERE kpi = %s AND ventana = %s", (kpi, ventana))


# ============================== Neo4j ==============================

RELACIONES_EDITOR = {"REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO"}


def neo4j_crear_editor(driver, user: str, tipo: str) -> dict:
    with driver.session() as s:
        return s.run("MERGE (e:Editor {user: $user}) SET e.tipo = $tipo RETURN properties(e) AS e",
                     user=user, tipo=tipo).single()["e"]


def neo4j_crear_pagina(driver, wiki: str, titulo: str) -> dict:
    with driver.session() as s:
        return s.run(
            "MERGE (w:Wiki {nombre: $wiki}) "
            "MERGE (p:Pagina {key: $wiki + ':' + $titulo}) SET p.wiki = $wiki, p.titulo = $titulo "
            "MERGE (p)-[:PERTENECE_A]->(w) RETURN properties(p) AS p", wiki=wiki, titulo=titulo).single()["p"]


def neo4j_asegurar_editor(driver, user: str, tipo: str = "registrado") -> bool:
    """Crea el editor si no existe (sin tocar su tipo si ya existía). Devuelve True si lo creó."""
    with driver.session() as s:
        return s.run("MERGE (e:Editor {user: $user}) ON CREATE SET e.tipo = $tipo",
                     user=user, tipo=tipo).consume().counters.nodes_created > 0


def neo4j_buscar_editores(driver, prefijo: str, tipo: str | None, limite: int) -> list[dict]:
    """Editores cuyo nombre empieza con el prefijo (usa el índice único de user), con su cantidad de relaciones."""
    filtro = "AND e.tipo = $tipo " if tipo else ""
    with driver.session() as s:
        return [dict(r) for r in s.run(
            "MATCH (e:Editor) WHERE e.user STARTS WITH $p " + filtro +
            "RETURN e.user AS user, e.tipo AS tipo, COUNT { (e)--() } AS relaciones ORDER BY user LIMIT $limite",
            p=prefijo, tipo=tipo, limite=limite)]


def neo4j_ultimos_editores(driver, n: int = 5) -> list[dict]:
    """Los n editores con actividad más reciente (usa el índice de ultima_actividad)."""
    with driver.session() as s:
        return [_plano(dict(r)) for r in s.run(
            "MATCH (e:Editor) WHERE e.ultima_actividad IS NOT NULL "
            "WITH e ORDER BY e.ultima_actividad DESC LIMIT $n "
            "RETURN e.user AS user, e.tipo AS tipo, COUNT { (e)--() } AS relaciones, e.ultima_actividad AS actividad", n=n)]


def _plano(v):
    """Fechas de Neo4j (DateTime, Date) a texto ISO, para poder enviarlas como JSON."""
    if hasattr(v, "iso_format"):
        return v.iso_format()
    if isinstance(v, dict):
        return {k: _plano(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plano(x) for x in v]
    return v


def neo4j_detalle_editor(driver, user: str, limite: int = 40) -> dict | None:
    """Detalle con relaciones manuales y editables primero, seguido del contenido."""
    query = """
    MATCH (e:Editor {user: $u})
    CALL (e) {
      OPTIONAL MATCH (e)-[r]->(x)
      WHERE type(r) <> 'ACTIVO_EN'
      WITH r,x ORDER BY CASE WHEN r.manual THEN 0 WHEN type(r) IN $editables THEN 1 ELSE 2 END,
                        coalesce(r.ultima_vez,r.fecha) DESC
      RETURN collect(CASE WHEN r IS NULL THEN null ELSE {
        id:elementId(r), tipo:type(r), con:coalesce(x.user,x.titulo,x.key,x.nombre),
        etiqueta:labels(x)[0], props:properties(r)} END)[..$l] AS salientes
    }
    CALL (e) {
      OPTIONAL MATCH (e)<-[r]-(x)
      WITH r,x ORDER BY CASE WHEN r.manual THEN 0 ELSE 1 END, coalesce(r.ultima_vez,r.fecha) DESC
      RETURN collect(CASE WHEN r IS NULL THEN null ELSE {
        id:elementId(r), tipo:type(r), con:coalesce(x.user,x.titulo,x.key,x.nombre),
        etiqueta:labels(x)[0], props:properties(r)} END)[..$l] AS entrantes
    }
    RETURN properties(e) AS editor, COUNT { (e)-->() } AS n_salientes,
           COUNT { (e)<--() } AS n_entrantes, salientes, entrantes
    """
    with driver.session() as session:
        rec = session.run(query, u=user, l=limite, editables=sorted(RELACIONES_EDITOR)).single()
    return _plano(dict(rec)) if rec else None


def neo4j_crear_relacion(driver, origen: str, destino: str, tipo: str, props: dict | None = None) -> dict:
    """Relación entre editores (REVIRTIO, MENSAJE_A, AGRADECIO o BLOQUEO) o Editor -EDITO-> Pagina."""
    if tipo in RELACIONES_EDITOR:
        match = "MATCH (a:Editor {user: $origen}), (b:Editor {user: $destino})"
    elif tipo == "EDITO":
        match = "MATCH (a:Editor {user: $origen}), (b:Pagina {key: $destino})"
    else:
        raise ValueError(f"Tipo de relación no permitido: {tipo}")
    # El tipo se valida contra una lista fija antes de insertarlo en la consulta.
    query = f"{match} MERGE (a)-[r:{tipo} {{manual: true, wiki: $wiki}}]->(b) SET r += $props RETURN properties(r) AS r"
    with driver.session() as s:
        rec = s.run(query, origen=origen, destino=destino, props=props or {}, wiki=(props or {}).get("wiki") or "enwiki").single()
        return rec["r"] if rec else None


def neo4j_consultar_editor(driver, user: str) -> dict | None:
    with driver.session() as s:
        rec = s.run(
            "MATCH (e:Editor {user: $user}) "
            "OPTIONAL MATCH (e)-[r]->(x) "
            "RETURN properties(e) AS editor, "
            "collect(CASE WHEN r IS NULL THEN NULL ELSE {tipo: type(r), hacia: coalesce(x.user, x.key), props: properties(r)} END) AS salientes",
            user=user).single()
        return None if rec is None or rec["editor"] is None else {"editor": rec["editor"], "salientes": rec["salientes"]}


def neo4j_actualizar_editor(driver, user: str, props: dict) -> dict | None:
    with driver.session() as s:
        rec = s.run("MATCH (e:Editor {user: $user}) SET e += $props RETURN properties(e) AS e",
                    user=user, props=props).single()
        return _plano(rec["e"]) if rec else None


def neo4j_eliminar_relacion(driver, origen: str, destino: str, tipo: str, relacion_id: str | None = None) -> int:
    if tipo not in RELACIONES_EDITOR | {"EDITO"}:
        raise ValueError(f"Tipo de relación no permitido: {tipo}")
    with driver.session() as s:
        match = f"MATCH (a:Editor {{user: $origen}})-[r:{tipo}]->(b) "
        where = "WHERE (b.user = $destino OR b.key = $destino) AND ($id IS NULL OR elementId(r) = $id) "
        params = {"origen": origen, "destino": destino, "id": relacion_id}
        def remove(tx):
            count = tx.run(match + where + "RETURN count(r) AS n", **params).single()["n"]
            if relacion_id is None and count > 1:
                raise ValueError("Hay varias relaciones. Selecciona su identificador para eliminar una sola")
            return tx.run(match + where + "DELETE r", **params).consume().counters.relationships_deleted
        return s.execute_write(remove)



def neo4j_eliminar_nodo(driver, label: str, clave: str, valor: str) -> int:
    """DETACH DELETE: borra el nodo y todas sus relaciones."""
    claves = {"Editor": "user", "Pagina": "key", "Categoria": "key"}
    if claves.get(label) != clave:
        raise ValueError("Etiqueta o clave no permitida")
    with driver.session() as s:
        return s.run(f"MATCH (n:{label} {{{clave}: $valor}}) DETACH DELETE n", valor=valor).consume().counters.nodes_deleted


# ============================== Demo para la exposición ==============================


def _titulo(texto: str) -> None:
    print(f"\n{'=' * 70}\n{texto}\n{'=' * 70}")


def _paso(texto: str, valor=None) -> None:
    print(f"\n>> {texto}")
    if valor is not None:
        print(json.dumps(valor, indent=2, ensure_ascii=False, default=str))


def demo_mongo() -> None:
    from wikipipe import mongo

    db = mongo.get_db()
    _titulo("CRUD en MongoDB · colección events")
    real = mongo_buscar(db, {"wiki": "eswiki", "derived.revert_target": {"$exists": True}}, limite=1)
    if real:
        _paso("Consulta de un documento real (última reversión en eswiki):",
              {k: real[0][k] for k in ("_id", "type", "wiki", "title", "user", "comment", "derived")})
    print(f"\nTotal de documentos en events: {db.events.estimated_document_count():,}")

    event_id = f"demo-crud-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    _paso("CREATE · insertar un documento nuevo:", {"_id": mongo_crear(db, evento_demo(event_id))})
    _paso("READ · consultarlo por _id:", mongo_consultar(db, event_id))

    _paso("CREATE inválido · el validador $jsonSchema rechaza un documento sin 'derived':")
    try:
        mongo_crear(db, {"_id": event_id + "-invalido", "type": "edit", "wiki": "enwiki", "title": "x", "user": "x",
                         "meta": {}})
    except WriteError as exc:
        print(f"   Rechazado por MongoDB: {exc.details.get('errmsg')}")

    _paso("UPDATE · cambiar el comentario y marcarlo como revisado:",
          {"modificados": mongo_actualizar(db, event_id, {"comment": "Comentario actualizado en la demo",
                                                          "revisado": True})})
    doc = mongo_consultar(db, event_id)
    _paso("READ · documento después del UPDATE:", {k: doc.get(k) for k in ("_id", "comment", "revisado")})
    _paso("DELETE · eliminarlo:", {"eliminados": mongo_eliminar(db, event_id)})
    _paso("READ · ¿sigue existiendo?", {"encontrado": mongo_consultar(db, event_id) is not None})


def demo_cassandra() -> None:
    from wikipipe import cassandra_store, config

    cluster, session = cassandra_store.connect()
    session.set_keyspace(config.CASSANDRA_KEYSPACE)
    try:
        _titulo("CRUD en Cassandra · tabla kpis (partición = kpi)")
        _paso("Consulta real · últimas 3 horas de eventos_procesados:",
              [r._asdict() for r in kpi_consultar(session, "eventos_procesados", limite=3)])
        kpi = "demo_kpi"
        ventana = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        kpi_insertar(session, kpi, ventana, 42.0, "valor de demostración")
        _paso(f"INSERT · nueva fila de {kpi}:", [r._asdict() for r in kpi_consultar(session, kpi)])
        kpi_actualizar(session, kpi, ventana, {"valor": 84.0})
        _paso("UPDATE · valor 42 → 84:", [r._asdict() for r in kpi_consultar(session, kpi)])
        kpi_eliminar(session, kpi, ventana)
        _paso("DELETE · borrar la fila (clave primaria completa). Filas restantes:", len(kpi_consultar(session, kpi)))
    finally:
        cluster.shutdown()


def demo_neo4j() -> None:
    from wikipipe import neo4j_store

    driver = neo4j_store.connect()
    try:
        _titulo("CRUD en Neo4j · nodos Editor y Pagina, relaciones REVIRTIO y EDITO")
        with driver.session() as s:
            rec = s.run("MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor) RETURN a.user AS patrullero, b.user AS revertido, "
                        "r.veces AS veces ORDER BY r.veces DESC LIMIT 3").data()
        _paso("Consulta real · reversiones más repetidas:", rec)

        _paso("CREATE nodo · Demo_Patrullero:", neo4j_crear_editor(driver, "Demo_Patrullero", "registrado"))
        _paso("CREATE nodo · Demo_Vandalo:", neo4j_crear_editor(driver, "Demo_Vandalo", "temporal"))
        _paso("CREATE nodo · página enwiki:Demo CRUD:", neo4j_crear_pagina(driver, "enwiki", "Demo CRUD"))
        _paso("CREATE relación · Demo_Vandalo -[:EDITO]-> enwiki:Demo CRUD:",
              neo4j_crear_relacion(driver, "Demo_Vandalo", "enwiki:Demo CRUD", "EDITO", {"ediciones": 1}))
        _paso("CREATE relación · Demo_Patrullero -[:REVIRTIO]-> Demo_Vandalo:",
              neo4j_crear_relacion(driver, "Demo_Patrullero", "Demo_Vandalo", "REVIRTIO", {"veces": 1}))
        _paso("READ · Demo_Patrullero y sus relaciones:", neo4j_consultar_editor(driver, "Demo_Patrullero"))
        _paso("UPDATE · propiedades del nodo (rol) y de la relación (veces 1 → 3):", {
            "nodo": neo4j_actualizar_editor(driver, "Demo_Patrullero", {"rol": "patrullero", "verificado": True}),
            "relacion": neo4j_crear_relacion(driver, "Demo_Patrullero", "Demo_Vandalo", "REVIRTIO", {"veces": 3}),
        })
        _paso("DELETE relación · REVIRTIO:",
              {"relaciones_borradas": neo4j_eliminar_relacion(driver, "Demo_Patrullero", "Demo_Vandalo", "REVIRTIO")})
        _paso("DELETE nodos · DETACH DELETE de los tres nodos de la demo:", {
            "nodos_borrados": sum(neo4j_eliminar_nodo(driver, *args) for args in (
                ("Editor", "user", "Demo_Patrullero"), ("Editor", "user", "Demo_Vandalo"),
                ("Pagina", "key", "enwiki:Demo CRUD")))
        })
        _paso("READ · ¿sigue existiendo Demo_Patrullero?",
              {"encontrado": neo4j_consultar_editor(driver, "Demo_Patrullero") is not None})
    finally:
        driver.close()


if __name__ == "__main__":
    demos = {"mongo": demo_mongo, "cassandra": demo_cassandra, "neo4j": demo_neo4j}
    elegido = sys.argv[1] if len(sys.argv) > 1 else "todo"
    for nombre, demo in demos.items():
        if elegido in (nombre, "todo"):
            demo()
