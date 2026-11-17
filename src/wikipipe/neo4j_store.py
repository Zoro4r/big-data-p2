"""Neo4j: grafo de editores, páginas, wikis y categorías (ver docs/justificacion-dataset.md).

Nodos: Editor, Pagina, Wiki, Categoria.
Relaciones: EDITO, CREO, SUBIO, REVIRTIO, MENSAJE_A, AGRADECIO, BLOQUEO, MOVIDA_A,
PERTENECE_A, EN_CATEGORIA y COEDITA (derivada de dos EDITO a la misma página).

Las relaciones de actividad conservan wiki y ventana UTC. Una transacción reemplaza la hora
completa y reconstruye el estado acumulado afectado, también al corregir o eliminar eventos.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from neo4j import Driver, GraphDatabase

from wikipipe import config
from wikipipe.clean import user_type

log = logging.getLogger(__name__)
BATCH = 2000
MAX_EDITORS_COEDIT = 50  # páginas con más editores no generan COEDITA (evita explosión de pares)


def connect() -> Driver:
    return GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD))


def ensure_schema(driver: Driver) -> None:
    text = (config.DB_DIR / "neo4j" / "constraints.cypher").read_text()
    lines = [line for line in text.splitlines() if not line.strip().startswith("//")]
    with driver.session() as session:
        for stmt in "\n".join(lines).split(";"):
            if stmt.strip():
                session.run(stmt).consume()
        current = session.run("MATCH (m:PipelineModelo {id:'wikipipe'}) RETURN m.version AS version").single()
        if current and current["version"] == 2:
            return
        legacy = session.run("MATCH ()-[r:EDITO|REVIRTIO|MENSAJE_A|AGRADECIO]->() "
                             "WHERE r.ventana IS NULL AND coalesce(r.manual, false) = false RETURN count(r) AS n").single()["n"]
        if legacy:
            raise RuntimeError("El grafo usa el modelo anterior. Reconstruye con python -m wikipipe.rebuild --reset-graph")


def _guess_type(name: str) -> str:
    """Tipo de un editor que solo aparece como destino (no sabemos si es bot)."""
    return user_type({"user": name, "bot": False})


def build_rows(events) -> dict:
    """Convierte los eventos de la ventana en filas para cada consulta de carga."""
    wikis, editores, paginas, categorias = set(), {}, {}, {}
    actividad = {}
    edito = defaultdict(lambda: {"n": 0, "delta": 0, "last": None})
    creo, subio, bloqueo, movida, cat_state = {}, {}, {}, {}, {}
    pares = {k: defaultdict(lambda: {"n": 0, "last": None, "wiki": None}) for k in ("REVIRTIO", "MENSAJE_A", "AGRADECIO")}

    def editor(name, tipo, t):
        prev = editores.get(name)
        if prev is None or (t and (prev["t"] is None or t > prev["t"])):
            editores[name] = {"user": name, "tipo": tipo or (prev or {}).get("tipo"), "t": t or (prev or {}).get("t")}

    def pagina(wiki, title, ns=None, size=None, t=None):
        key = f"{wiki}:{title}"
        p = paginas.setdefault(key, {"key": key, "wiki": wiki, "titulo": title, "ns": ns, "size": size, "t": t})
        if t and (p["t"] is None or t > p["t"]):
            p.update(t=t, size=size if size is not None else p["size"])
        if ns is not None:
            p["ns"] = ns
        return key

    for e in events:
        d, wiki, user, etype, t = e["derived"], e["wiki"], e["user"], e["type"], e["derived"]["event_time"]
        wikis.add(wiki)
        editor(user, d["user_type"], t)
        activity_key = (user, wiki)
        if activity_key not in actividad or t > actividad[activity_key]["t"]:
            actividad[activity_key] = {"user": user, "wiki": wiki, "tipo": d["user_type"], "t": t}

        if etype in ("edit", "new"):
            key = pagina(wiki, e["title"], e.get("namespace"), (e.get("length") or {}).get("new"), t)
            rel = edito[(user, key)]
            rel["n"] += 1
            rel["delta"] += d.get("delta_bytes", 0)
            rel["last"] = max(rel["last"] or t, t)
            rel["tipo"] = d["user_type"]
            rel["size"] = (e.get("length") or {}).get("new")
            if etype == "new":
                creo[(user, key)] = {"user": user, "key": key, "fecha": t, "size": (e.get("length") or {}).get("new")}
            for rel_type, target in (("REVIRTIO", d.get("revert_target")), ("MENSAJE_A", d.get("message_target"))):
                if target:
                    editor(target, _guess_type(target), None)
                    p = pares[rel_type][(user, target, wiki)]
                    p["n"] += 1
                    p["last"], p["wiki"] = t, wiki

        elif etype == "categorize" and d.get("categorized_page"):
            key = pagina(wiki, d["categorized_page"])
            cat_key = f"{wiki}:{d['category']}"
            categorias[cat_key] = {"key": cat_key, "wiki": wiki, "nombre": d["category"]}
            cat_state[(key, cat_key)] = d.get("category_action") or "added"  # gana la última acción de la hora

        elif etype == "log":
            if d.get("thanks_target"):
                editor(d["thanks_target"], _guess_type(d["thanks_target"]), None)
                p = pares["AGRADECIO"][(user, d["thanks_target"], wiki)]
                p["n"] += 1
                p["last"], p["wiki"] = t, wiki
            if d.get("block_target"):
                editor(d["block_target"], _guess_type(d["block_target"]), None)
                bloqueo[(user, d["block_target"], wiki)] = {"src": user, "dst": d["block_target"], "fecha": t,
                                                      "duracion": d.get("block_duration"), "wiki": wiki}
            if d.get("move_target"):
                src = pagina(wiki, e["title"], e.get("namespace"))
                dst = pagina(wiki, d["move_target"])
                movida[(src, dst)] = {"src": src, "dst": dst, "fecha": t, "editor": user}
            if d.get("uploaded_file"):
                key = pagina(wiki, d["uploaded_file"], 6, None, t)
                subio[(user, key)] = {"user": user, "key": key, "fecha": t}

    return {
        "actividad": list(actividad.values()),
        "wikis": [{"nombre": w} for w in wikis],
        "editores": list(editores.values()),
        "paginas": list(paginas.values()),
        "categorias": list(categorias.values()),
        "edito": [{"user": u, "key": k, **v} for (u, k), v in edito.items()],
        "creo": list(creo.values()),
        "subio": list(subio.values()),
        "pares": {k: [{"src": s, "dst": d, **v} for (s, d, _wiki), v in rows.items()] for k, rows in pares.items()},
        "bloqueo": list(bloqueo.values()),
        "movida": list(movida.values()),
        "cat_add": [{"page": p, "cat": c} for (p, c), a in cat_state.items() if a == "added"],
        "cat_remove": [{"page": p, "cat": c} for (p, c), a in cat_state.items() if a == "removed"],
    }


Q_WIKIS = "UNWIND $rows AS row MERGE (:Wiki {nombre: row.nombre})"
Q_EDITORES = """
UNWIND $rows AS row
MERGE (e:Editor {user: row.user})
ON CREATE SET e.tipo = row.tipo
"""
Q_ACTIVIDAD = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (w:Wiki {nombre: row.wiki})
MERGE (e)-[r:ACTIVO_EN {ventana: $ventana, wiki: row.wiki}]->(w)
SET r.ultima_vez = datetime(row.t), r.tipo = row.tipo, r.version = 2
"""
Q_PAGINAS = """
UNWIND $rows AS row
MERGE (p:Pagina {key: row.key})
SET p.wiki = row.wiki, p.titulo = row.titulo, p.namespace = coalesce(row.ns, p.namespace)
FOREACH (_ IN CASE WHEN row.t IS NOT NULL AND (p.ultima_edicion IS NULL OR p.ultima_edicion < datetime(row.t))
                   THEN [1] ELSE [] END | SET p.ultima_edicion = datetime(row.t), p.tamano = coalesce(row.size, p.tamano))
WITH p, row
MATCH (w:Wiki {nombre: row.wiki})
MERGE (p)-[:PERTENECE_A]->(w)
"""
Q_CATEGORIAS = """
UNWIND $rows AS row
MERGE (c:Categoria {key: row.key})
SET c.nombre = row.nombre, c.wiki = row.wiki
WITH c, row
MATCH (w:Wiki {nombre: row.wiki})
MERGE (c)-[:PERTENECE_A]->(w)
"""
Q_EDITO = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (p:Pagina {key: row.key})
MERGE (e)-[r:EDITO {ventana: $ventana, wiki: p.wiki}]->(p)
SET r.ediciones = row.n, r.delta_bytes = row.delta, r.ultima_vez = datetime(row.last),
    r.tipo = row.tipo, r.tamano = row.size, r.version = 2
"""
Q_CREO = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (p:Pagina {key: row.key})
MERGE (e)-[r:CREO {ventana: $ventana, wiki: p.wiki}]->(p)
SET r.fecha = datetime(row.fecha), r.tamano_inicial = row.size, r.version = 2
"""
Q_SUBIO = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (p:Pagina {key: row.key})
MERGE (e)-[r:SUBIO {ventana: $ventana, wiki: p.wiki}]->(p)
SET r.fecha = datetime(row.fecha), r.version = 2
"""
Q_PAR = """
UNWIND $rows AS row
MATCH (a:Editor {user: row.src}), (b:Editor {user: row.dst})
MERGE (a)-[r:%s {ventana: $ventana, wiki: row.wiki}]->(b)
SET r.veces = row.n, r.ultima_vez = datetime(row.last), r.version = 2
"""
Q_BLOQUEO = """
UNWIND $rows AS row
MATCH (a:Editor {user: row.src}), (b:Editor {user: row.dst})
MERGE (a)-[r:BLOQUEO {ventana: $ventana, wiki: row.wiki}]->(b)
SET r.fecha = datetime(row.fecha), r.duracion = row.duracion, r.version = 2
"""
Q_MOVIDA = """
UNWIND $rows AS row
MATCH (a:Pagina {key: row.src}), (b:Pagina {key: row.dst})
MERGE (a)-[r:MOVIDA_A {ventana: $ventana, wiki: a.wiki}]->(b)
SET r.fecha = datetime(row.fecha), r.editor = row.editor, r.version = 2
"""
Q_CAT_CHANGE = """
UNWIND $rows AS row
MATCH (p:Pagina {key: row.page}), (c:Categoria {key: row.cat})
MERGE (p)-[r:CAMBIO_CATEGORIA {ventana: $ventana, wiki: p.wiki}]->(c)
SET r.accion = row.accion, r.version = 2
"""
Q_REFRESH_CATEGORIES = """
UNWIND $rows AS row
MATCH (p:Pagina {key: row.page}), (c:Categoria {key: row.cat})
OPTIONAL MATCH (p)-[old:EN_CATEGORIA]->(c)
DELETE old
WITH p, c
OPTIONAL MATCH (p)-[change:CAMBIO_CATEGORIA]->(c)
WITH p, c, change ORDER BY change.ventana DESC
WITH p, c, head(collect(change.accion)) AS accion
FOREACH (_ IN CASE WHEN accion = 'added' THEN [1] ELSE [] END | MERGE (p)-[:EN_CATEGORIA]->(c))
"""
# COEDITA: para cada página editada en la ventana, une a sus editores humanos y guarda cuántas
# páginas tienen en común (se recalcula, así que también es idempotente).
Q_COEDITA = """
UNWIND $rows AS key
MATCH (p:Pagina {key: key})<-[:EDITO]-(a:Editor)
WHERE a.tipo <> 'bot'
WITH p, collect(DISTINCT a) AS eds
WHERE size(eds) > 1 AND size(eds) <= $max_editores
UNWIND eds AS a
UNWIND eds AS b
WITH DISTINCT a, b WHERE a.user < b.user
MATCH (a)-[:EDITO]->(q:Pagina)<-[:EDITO]-(b)
WITH a, b, count(DISTINCT q) AS comunes
MERGE (a)-[r:COEDITA]-(b)
SET r.paginas_en_comun = comunes
"""


def load_window(driver: Driver, events, ventana: str) -> dict:
    """Reemplazo atómico de una hora. El mutex del grafo serializa backfills y reintentos."""
    from datetime import datetime, timezone

    ventana = datetime.fromisoformat(ventana.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    ensure_schema(driver)
    rows = build_rows(events)
    categories = [{**r, "accion": action} for key, action in (("cat_add", "added"), ("cat_remove", "removed"))
                  for r in rows[key]]
    queries = [("wikis", Q_WIKIS), ("editores", Q_EDITORES), ("paginas", Q_PAGINAS),
               ("categorias", Q_CATEGORIAS), ("actividad", Q_ACTIVIDAD), ("edito", Q_EDITO),
               ("creo", Q_CREO), ("subio", Q_SUBIO), ("bloqueo", Q_BLOQUEO), ("movida", Q_MOVIDA)]

    def replace(tx):
        # El write lock de este nodo se mantiene hasta commit, incluso para ventanas distintas.
        tx.run("MERGE (m:PipelineModelo {id: 'wikipipe'}) SET m.version = 2, m.lock = coalesce(m.lock, 0) + 1").consume()
        affected = tx.run("MATCH (e:Editor)-[r:ACTIVO_EN]->() WHERE r.ventana = $v "
                          "RETURN collect(DISTINCT e.user) AS users", v=ventana).single()["users"]
        old_categories = tx.run("MATCH (p:Pagina)-[r:CAMBIO_CATEGORIA]->(c:Categoria) WHERE r.ventana = $v "
                               "RETURN p.key AS page, c.key AS cat", v=ventana).data()
        old_pages = tx.run("MATCH ()-[r:EDITO|SUBIO]->(p:Pagina) WHERE r.ventana = $v "
                          "RETURN collect(DISTINCT p.key) AS pages", v=ventana).single()["pages"]
        tx.run("MATCH ()-[r]->() WHERE r.version = 2 AND r.ventana = $v DELETE r", v=ventana).consume()
        for key, query in queries:
            for i in range(0, len(rows[key]), BATCH):
                tx.run(query, rows=rows[key][i:i + BATCH], ventana=ventana).consume()
        for rel_type, values in rows["pares"].items():
            for i in range(0, len(values), BATCH):
                tx.run(Q_PAR % rel_type, rows=values[i:i + BATCH], ventana=ventana).consume()
        tx.run(Q_CAT_CHANGE, rows=categories, ventana=ventana).consume()
        tx.run(Q_REFRESH_CATEGORIES, rows=old_categories + categories).consume()
        users = sorted(set(affected) | {r["user"] for r in rows["editores"]})
        tx.run("UNWIND $users AS u MATCH (e:Editor {user:u}) "
               "OPTIONAL MATCH (e)-[r:ACTIVO_EN]->() WITH e,r ORDER BY r.ultima_vez DESC "
               "WITH e,head(collect(r)) AS last SET e.ultima_actividad=last.ultima_vez, "
               "e.tipo=coalesce(last.tipo,e.tipo)", users=users).consume()
        pages = sorted(set(old_pages) | {r["key"] for r in rows["paginas"]})
        tx.run("UNWIND $pages AS key MATCH (p:Pagina {key:key}) OPTIONAL MATCH ()-[r:EDITO]->(p) "
               "WITH p,r ORDER BY r.ultima_vez DESC WITH p,head(collect(r)) AS last "
               "SET p.ultima_edicion=last.ultima_vez,p.tamano=last.tamano", pages=pages).consume()
        tx.run("UNWIND $users AS u MATCH (:Editor {user:u})-[r:COEDITA]-() DELETE r", users=users).consume()
        # También se revisan las otras páginas de los editores afectados para quitar pares obsoletos.
        page_keys = tx.run("UNWIND $users AS u MATCH (:Editor {user:u})-[:EDITO]->(p:Pagina) "
                           "RETURN collect(DISTINCT p.key) AS keys", users=users).single()["keys"]
        tx.run(Q_COEDITA, rows=page_keys, max_editores=MAX_EDITORS_COEDIT).consume()
        return {key: len(rows[key]) for key, _query in queries}

    with driver.session() as session:
        result = session.execute_write(replace)
    log.info("Grafo reemplazado para %s: %s", ventana, result)
    return result


Q_CONTEO_PAGINAS = """
MATCH (:Wiki {nombre: $wiki})<-[:PERTENECE_A]-(p:Pagina)
RETURN count(p) AS paginas, sum(COUNT { (p)<-[:EDITO]-() }) AS edito, sum(COUNT { (p)<-[:CREO]-() }) AS creo
"""
Q_CONTEO_EDITORES = """
MATCH (:Wiki {nombre: $wiki})<-[:PERTENECE_A]-(:Pagina)<-[:EDITO]-(e:Editor)
RETURN count(DISTINCT e) AS editores
"""
Q_CONTEO_CATEGORIAS = "MATCH (:Wiki {nombre: $wiki})<-[:PERTENECE_A]-(c:Categoria) RETURN count(c) AS n"
Q_CONTEO_PARES = """
MATCH ()-[r:REVIRTIO|MENSAJE_A|AGRADECIO|BLOQUEO]->() WHERE r.wiki = $wiki
RETURN type(r) AS tipo, count(*) AS n
"""


def conteo_por_wiki(driver: Driver) -> dict:
    """Totales del grafo de cada wiki para el dashboard. Recorre las páginas de cada wiki (unos
    segundos), por eso lo calcula el DAG una vez por hora y no la API en cada consulta.
    COEDITA no guarda la wiki, así que no se puede separar."""
    out = {}
    with driver.session() as s:
        for wiki in sorted(config.WIKIS):
            pag = s.run(Q_CONTEO_PAGINAS, wiki=wiki).single()
            rels = {r["tipo"]: r["n"] for r in s.run(Q_CONTEO_PARES, wiki=wiki)}
            out[wiki] = {
                "nodos": {"Editor": s.run(Q_CONTEO_EDITORES, wiki=wiki).single()["editores"],
                          "Pagina": pag["paginas"],
                          "Categoria": s.run(Q_CONTEO_CATEGORIAS, wiki=wiki).single()["n"]},
                "relaciones": {"EDITO": pag["edito"], "CREO": pag["creo"],
                               **{t: rels.get(t, 0) for t in ("REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO")}},
            }
    return out
