"""Neo4j: grafo de editores, páginas, wikis y categorías (ver docs/justificacion-dataset.md).

Nodos: Editor, Pagina, Wiki, Categoria.
Relaciones: EDITO, CREO, SUBIO, REVIRTIO, MENSAJE_A, AGRADECIO, BLOQUEO, MOVIDA_A,
PERTENECE_A, EN_CATEGORIA y COEDITA (derivada de dos EDITO a la misma página).

Idempotencia: todo se crea con MERGE. Las relaciones que acumulan conteos (EDITO, REVIRTIO,
MENSAJE_A, AGRADECIO) guardan en `ventanas` las horas ya sumadas y no vuelven a sumarlas.
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
                session.run(stmt)


def _run_batches(driver: Driver, cypher: str, rows: list, **params) -> int:
    with driver.session() as session:
        for i in range(0, len(rows), BATCH):
            session.execute_write(lambda tx, chunk: tx.run(cypher, rows=chunk, **params).consume(), rows[i:i + BATCH])
    return len(rows)


def _guess_type(name: str) -> str:
    """Tipo de un editor que solo aparece como destino (no sabemos si es bot)."""
    return user_type({"user": name, "bot": False})


def build_rows(events) -> dict:
    """Convierte los eventos de la ventana en filas para cada consulta de carga."""
    wikis, editores, paginas, categorias = set(), {}, {}, {}
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

        if etype in ("edit", "new"):
            key = pagina(wiki, e["title"], e.get("namespace"), (e.get("length") or {}).get("new"), t)
            rel = edito[(user, key)]
            rel["n"] += 1
            rel["delta"] += d.get("delta_bytes", 0)
            rel["last"] = t
            if etype == "new":
                creo[(user, key)] = {"user": user, "key": key, "fecha": t, "size": (e.get("length") or {}).get("new")}
            for rel_type, target in (("REVIRTIO", d.get("revert_target")), ("MENSAJE_A", d.get("message_target"))):
                if target:
                    editor(target, _guess_type(target), None)
                    p = pares[rel_type][(user, target)]
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
                p = pares["AGRADECIO"][(user, d["thanks_target"])]
                p["n"] += 1
                p["last"], p["wiki"] = t, wiki
            if d.get("block_target"):
                editor(d["block_target"], _guess_type(d["block_target"]), None)
                bloqueo[(user, d["block_target"])] = {"src": user, "dst": d["block_target"], "fecha": t,
                                                      "duracion": d.get("block_duration"), "wiki": wiki}
            if d.get("move_target"):
                src = pagina(wiki, e["title"], e.get("namespace"))
                dst = pagina(wiki, d["move_target"])
                movida[(src, dst)] = {"src": src, "dst": dst, "fecha": t, "editor": user}
            if d.get("uploaded_file"):
                key = pagina(wiki, d["uploaded_file"], 6, None, t)
                subio[(user, key)] = {"user": user, "key": key, "fecha": t}

    return {
        "wikis": [{"nombre": w} for w in wikis],
        "editores": list(editores.values()),
        "paginas": list(paginas.values()),
        "categorias": list(categorias.values()),
        "edito": [{"user": u, "key": k, **v} for (u, k), v in edito.items()],
        "creo": list(creo.values()),
        "subio": list(subio.values()),
        "pares": {k: [{"src": s, "dst": d, **v} for (s, d), v in rows.items()] for k, rows in pares.items()},
        "bloqueo": list(bloqueo.values()),
        "movida": list(movida.values()),
        "cat_add": [{"page": p, "cat": c} for (p, c), a in cat_state.items() if a == "added"],
        "cat_remove": [{"page": p, "cat": c} for (p, c), a in cat_state.items() if a == "removed"],
    }


Q_WIKIS = "UNWIND $rows AS row MERGE (:Wiki {nombre: row.nombre})"
Q_EDITORES = """
UNWIND $rows AS row
MERGE (e:Editor {user: row.user})
// Con eventos propios (row.t) el tipo es seguro; si solo aparece como destino, es una suposición
// por el nombre y no debe pisar un tipo ya conocido (p. ej. un bot revertido).
SET e.tipo = CASE WHEN row.t IS NOT NULL THEN row.tipo ELSE coalesce(e.tipo, row.tipo) END
FOREACH (_ IN CASE WHEN row.t IS NOT NULL AND (e.ultima_actividad IS NULL OR e.ultima_actividad < datetime(row.t))
                   THEN [1] ELSE [] END | SET e.ultima_actividad = datetime(row.t))
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
MERGE (e)-[r:EDITO]->(p)
WITH r, row WHERE NOT $ventana IN coalesce(r.ventanas, [])
SET r.ediciones = coalesce(r.ediciones, 0) + row.n,
    r.delta_bytes = coalesce(r.delta_bytes, 0) + row.delta,
    r.ultima_vez = datetime(row.last),
    r.ventanas = coalesce(r.ventanas, []) + $ventana
"""
Q_CREO = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (p:Pagina {key: row.key})
MERGE (e)-[r:CREO]->(p)
SET r.fecha = datetime(row.fecha), r.tamano_inicial = row.size
"""
Q_SUBIO = """
UNWIND $rows AS row
MATCH (e:Editor {user: row.user}), (p:Pagina {key: row.key})
MERGE (e)-[r:SUBIO]->(p)
SET r.fecha = datetime(row.fecha)
"""
Q_PAR = """
UNWIND $rows AS row
MATCH (a:Editor {user: row.src}), (b:Editor {user: row.dst})
MERGE (a)-[r:%s]->(b)
WITH r, row WHERE NOT $ventana IN coalesce(r.ventanas, [])
SET r.veces = coalesce(r.veces, 0) + row.n,
    r.ultima_vez = datetime(row.last),
    r.wiki = row.wiki,
    r.ventanas = coalesce(r.ventanas, []) + $ventana
"""
Q_BLOQUEO = """
UNWIND $rows AS row
MATCH (a:Editor {user: row.src}), (b:Editor {user: row.dst})
MERGE (a)-[r:BLOQUEO]->(b)
SET r.fecha = datetime(row.fecha), r.duracion = row.duracion, r.wiki = row.wiki
"""
Q_MOVIDA = """
UNWIND $rows AS row
MATCH (a:Pagina {key: row.src}), (b:Pagina {key: row.dst})
MERGE (a)-[r:MOVIDA_A]->(b)
SET r.fecha = datetime(row.fecha), r.editor = row.editor
"""
Q_CAT_ADD = """
UNWIND $rows AS row
MATCH (p:Pagina {key: row.page}), (c:Categoria {key: row.cat})
MERGE (p)-[:EN_CATEGORIA]->(c)
"""
Q_CAT_REMOVE = """
UNWIND $rows AS row
MATCH (:Pagina {key: row.page})-[r:EN_CATEGORIA]->(:Categoria {key: row.cat})
DELETE r
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
    """Carga en Neo4j los eventos de una ventana. `ventana` = inicio de la ventana (ISO)."""
    ensure_schema(driver)
    rows = build_rows(events)
    stats = {
        "wikis": _run_batches(driver, Q_WIKIS, rows["wikis"]),
        "editores": _run_batches(driver, Q_EDITORES, rows["editores"]),
        "paginas": _run_batches(driver, Q_PAGINAS, rows["paginas"]),
        "categorias": _run_batches(driver, Q_CATEGORIAS, rows["categorias"]),
        "EDITO": _run_batches(driver, Q_EDITO, rows["edito"], ventana=ventana),
        "CREO": _run_batches(driver, Q_CREO, rows["creo"]),
        "SUBIO": _run_batches(driver, Q_SUBIO, rows["subio"]),
        "BLOQUEO": _run_batches(driver, Q_BLOQUEO, rows["bloqueo"]),
        "MOVIDA_A": _run_batches(driver, Q_MOVIDA, rows["movida"]),
        "EN_CATEGORIA+": _run_batches(driver, Q_CAT_ADD, rows["cat_add"]),
        "EN_CATEGORIA-": _run_batches(driver, Q_CAT_REMOVE, rows["cat_remove"]),
    }
    for rel_type, rel_rows in rows["pares"].items():
        stats[rel_type] = _run_batches(driver, Q_PAR % rel_type, rel_rows, ventana=ventana)
    edited_pages = sorted({r["key"] for r in rows["edito"]})
    _run_batches(driver, Q_COEDITA, edited_pages, max_editores=MAX_EDITORS_COEDIT)
    log.info("Carga en Neo4j (filas por consulta): %s", stats)
    return stats


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
