"""Operaciones CRUD de las tres bases (sección 4 de las instrucciones) y una demo para la exposición.

MongoDB   : crear, consultar, actualizar y eliminar un documento de la colección `events`.
Cassandra : insertar, consultar, actualizar y eliminar filas de la tabla `actividad_editor`.
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
        if ruta in PROTEGIDOS or ruta.startswith("derived.") or ruta.startswith("$"):
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

CQL_INSERT = (
    "INSERT INTO actividad_editor (editor, fecha, hora, wiki, tipo_editor, eventos, ediciones, paginas, "
    "delta_bytes, reversiones_hechas, reversiones_recibidas) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
)


def cassandra_insertar(session, fila: dict) -> None:
    session.execute(CQL_INSERT, (
        fila["editor"], fila["fecha"], fila["hora"], fila["wiki"], fila["tipo_editor"], fila["eventos"],
        fila["ediciones"], fila["paginas"], fila["delta_bytes"], fila["reversiones_hechas"],
        fila["reversiones_recibidas"]))


def cassandra_consultar(session, editor: str, fecha: date | None = None, limite: int = 24) -> list:
    """Historial de un editor (una partición). Opcionalmente, solo un día."""
    if fecha:
        rows = session.execute(
            "SELECT * FROM actividad_editor WHERE editor = %s AND fecha = %s LIMIT %s", (editor, fecha, limite))
    else:
        rows = session.execute("SELECT * FROM actividad_editor WHERE editor = %s LIMIT %s", (editor, limite))
    return list(rows)


def cassandra_actualizar(session, editor: str, fecha: date, hora: int, wiki: str, eventos: int, ediciones: int) -> None:
    """UPDATE por clave primaria completa (en Cassandra un UPDATE también inserta si no existe)."""
    session.execute(
        "UPDATE actividad_editor SET eventos = %s, ediciones = %s "
        "WHERE editor = %s AND fecha = %s AND hora = %s AND wiki = %s",
        (eventos, ediciones, editor, fecha, hora, wiki))


def cassandra_eliminar(session, editor: str, fecha: date | None = None, hora: int | None = None,
                       wiki: str | None = None) -> None:
    """Borra una fila (clave completa) o la partición entera de un editor (solo `editor`)."""
    if fecha is None:
        session.execute("DELETE FROM actividad_editor WHERE editor = %s", (editor,))
    else:
        session.execute(
            "DELETE FROM actividad_editor WHERE editor = %s AND fecha = %s AND hora = %s AND wiki = %s",
            (editor, fecha, hora, wiki))


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


def neo4j_crear_relacion(driver, origen: str, destino: str, tipo: str, props: dict | None = None) -> dict:
    """Relación entre editores (REVIRTIO, MENSAJE_A, AGRADECIO o BLOQUEO) o Editor -EDITO-> Pagina."""
    if tipo in RELACIONES_EDITOR:
        match = "MATCH (a:Editor {user: $origen}), (b:Editor {user: $destino})"
    elif tipo == "EDITO":
        match = "MATCH (a:Editor {user: $origen}), (b:Pagina {key: $destino})"
    else:
        raise ValueError(f"Tipo de relación no permitido: {tipo}")
    # El tipo se valida contra una lista fija antes de insertarlo en la consulta.
    query = f"{match} MERGE (a)-[r:{tipo}]->(b) SET r += $props RETURN properties(r) AS r"
    with driver.session() as s:
        rec = s.run(query, origen=origen, destino=destino, props=props or {}).single()
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
        return rec["e"] if rec else None


def neo4j_eliminar_relacion(driver, origen: str, destino: str, tipo: str) -> int:
    if tipo not in RELACIONES_EDITOR | {"EDITO"}:
        raise ValueError(f"Tipo de relación no permitido: {tipo}")
    with driver.session() as s:
        # La etiqueta :Editor permite usar el índice único de user (sin ella, Neo4j recorre todos los nodos).
        return s.run(f"MATCH (a:Editor {{user: $origen}})-[r:{tipo}]->(b) WHERE b.user = $destino OR b.key = $destino "
                     "DELETE r", origen=origen, destino=destino).consume().counters.relationships_deleted


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
    from wikipipe import cassandra_store

    cluster, session = cassandra_store.connect()
    session.set_keyspace("wikipipe")
    try:
        _titulo("CRUD en Cassandra · tabla actividad_editor (partición = editor)")
        top = list(session.execute("SELECT * FROM kpis WHERE kpi = 'editor_mas_revertido' LIMIT 1"))
        if top and top[0].detalle:
            editor_real = top[0].detalle.split(" (")[0]
            _paso(f"Consulta real · historial del editor más revertido ({editor_real}):",
                  [r._asdict() for r in cassandra_consultar(session, editor_real, limite=5)])

        hoy, hora = datetime.now(timezone.utc).date(), datetime.now(timezone.utc).hour
        fila = {"editor": "Demo_Editor", "fecha": hoy, "hora": hora, "wiki": "enwiki", "tipo_editor": "registrado",
                "eventos": 10, "ediciones": 8, "paginas": 3, "delta_bytes": 1500, "reversiones_hechas": 0,
                "reversiones_recibidas": 1}
        cassandra_insertar(session, fila)
        _paso("INSERT · nueva fila para Demo_Editor:", fila)
        _paso("SELECT · consultar la partición de Demo_Editor:",
              [r._asdict() for r in cassandra_consultar(session, "Demo_Editor")])
        cassandra_actualizar(session, "Demo_Editor", hoy, hora, "enwiki", eventos=25, ediciones=20)
        _paso("UPDATE · eventos 10 → 25 y ediciones 8 → 20:",
              [{k: v for k, v in r._asdict().items() if k in ("editor", "hora", "eventos", "ediciones")}
               for r in cassandra_consultar(session, "Demo_Editor")])
        cassandra_eliminar(session, "Demo_Editor", hoy, hora, "enwiki")
        _paso("DELETE · borrar la fila (clave primaria completa). Filas restantes:",
              len(cassandra_consultar(session, "Demo_Editor")))
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
