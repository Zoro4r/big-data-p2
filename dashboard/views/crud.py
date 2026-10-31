"""Página 5 · Operaciones CRUD sobre las tres bases (usa las mismas funciones que wikipipe.crud)."""

from datetime import datetime, timezone

import streamlit as st
from pymongo.errors import DuplicateKeyError, WriteError

import data
from wikipipe import crud

st.title("Operaciones CRUD")
st.caption("Crear, consultar, actualizar y eliminar en MongoDB, Cassandra y Neo4j. "
           "Sugerencia para la demo: usar nombres que empiecen con «Demo_» y borrarlos al final.")


def listo(resultado=None, mensaje="Operación realizada."):
    st.cache_data.clear()  # que las demás páginas vean el cambio
    st.success(mensaje)
    if resultado is not None:
        st.json(resultado)


mongo_tab, cass_tab, neo_tab = st.tabs(["MongoDB · events", "Cassandra · actividad_editor", "Neo4j · grafo"])

# ================================================================ MongoDB
with mongo_tab:
    db = data.mongo_db()
    op = st.radio("Operación", ["Crear", "Consultar", "Actualizar", "Eliminar"], horizontal=True, key="m_op")
    if op == "Crear":
        with st.form("m_crear"):
            c = st.columns(3)
            event_id = c[0].text_input("_id", f"demo-{datetime.now(timezone.utc):%Y%m%d%H%M%S}")
            titulo = c[1].text_input("Título de la página", "Demo CRUD")
            editor = c[2].text_input("Editor", "Demo_Editor")
            comentario = st.text_input("Comentario", "Edición creada desde el dashboard")
            if st.form_submit_button("Insertar documento"):
                doc = crud.evento_demo(event_id)
                doc.update(title=titulo, user=editor, comment=comentario)
                doc["derived"]["page_key"] = f"enwiki:{titulo}"
                try:
                    listo(crud.mongo_consultar(db, crud.mongo_crear(db, doc)), "Documento insertado.")
                except DuplicateKeyError:
                    st.error("Ya existe un documento con ese _id.")
                except WriteError as exc:
                    st.error(f"MongoDB rechazó el documento: {exc.details.get('errmsg')}")
    elif op == "Consultar":
        event_id = st.text_input("_id del documento", key="m_read")
        if event_id:
            doc = crud.mongo_consultar(db, event_id)
            if doc:
                st.json(doc)
            else:
                st.warning("No existe un documento con ese _id.")
    elif op == "Actualizar":
        with st.form("m_upd"):
            event_id = st.text_input("_id del documento")
            c = st.columns(2)
            campo = c[0].text_input("Campo", "comment")
            valor = c[1].text_input("Nuevo valor", "Comentario actualizado desde el dashboard")
            if st.form_submit_button("Actualizar ($set)"):
                n = crud.mongo_actualizar(db, event_id, {campo: valor})
                if n:
                    listo(crud.mongo_consultar(db, event_id), f"{n} documento(s) modificado(s).")
                else:
                    st.warning("No se modificó nada (¿_id inexistente o mismo valor?).")
    else:
        with st.form("m_del"):
            event_id = st.text_input("_id del documento")
            if st.form_submit_button("Eliminar", type="primary"):
                n = crud.mongo_eliminar(db, event_id)
                if n:
                    listo(mensaje=f"{n} documento(s) eliminado(s).")
                else:
                    st.warning("No existe ese _id.")

# ================================================================ Cassandra
with cass_tab:
    s = data.cassandra()
    st.caption("Clave primaria: ((editor), fecha, hora, wiki). La partición es el editor.")
    op = st.radio("Operación", ["Insertar", "Consultar", "Actualizar", "Eliminar"], horizontal=True, key="c_op")
    ahora = datetime.now(timezone.utc)
    if op in ("Insertar", "Actualizar", "Eliminar"):
        with st.form(f"c_{op}"):
            c = st.columns(4)
            editor = c[0].text_input("editor", "Demo_Editor")
            fecha = c[1].date_input("fecha", ahora.date())
            hora = c[2].number_input("hora", 0, 23, ahora.hour)
            wiki = c[3].selectbox("wiki", ["enwiki", "eswiki"])
            if op != "Eliminar":
                c = st.columns(2)
                eventos = c[0].number_input("eventos", 0, 100000, 10)
                ediciones = c[1].number_input("ediciones", 0, 100000, 8)
            boton = {"Insertar": "INSERT", "Actualizar": "UPDATE", "Eliminar": "DELETE"}[op]
            if st.form_submit_button(boton, type="primary" if op == "Eliminar" else "secondary"):
                if op == "Insertar":
                    crud.cassandra_insertar(s, {
                        "editor": editor, "fecha": fecha, "hora": int(hora), "wiki": wiki, "tipo_editor": "registrado",
                        "eventos": int(eventos), "ediciones": int(ediciones), "paginas": 1, "delta_bytes": 0,
                        "reversiones_hechas": 0, "reversiones_recibidas": 0})
                elif op == "Actualizar":
                    crud.cassandra_actualizar(s, editor, fecha, int(hora), wiki, int(eventos), int(ediciones))
                else:
                    crud.cassandra_eliminar(s, editor, fecha, int(hora), wiki)
                listo([r._asdict() for r in crud.cassandra_consultar(s, editor)],
                      f"{boton} ejecutado. Filas actuales de la partición «{editor}»:")
    else:
        editor = st.text_input("editor", "Demo_Editor", key="c_read")
        filas = crud.cassandra_consultar(s, editor, limite=50)
        if filas:
            st.dataframe([r._asdict() for r in filas], use_container_width=True)
        else:
            st.info("La partición no tiene filas.")

# ================================================================ Neo4j
with neo_tab:
    drv = data.neo4j()
    op = st.radio("Operación", ["Crear nodo", "Crear relación", "Consultar", "Actualizar propiedades",
                                "Eliminar relación", "Eliminar nodo"], horizontal=True, key="n_op")
    tipos_rel = ["REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO"]
    if op == "Crear nodo":
        with st.form("n_nodo"):
            c = st.columns(2)
            user = c[0].text_input("user", "Demo_Patrullero")
            tipo = c[1].selectbox("tipo", ["registrado", "temporal", "bot"])
            if st.form_submit_button("CREATE (MERGE) nodo Editor"):
                listo(crud.neo4j_crear_editor(drv, user, tipo), "Nodo creado.")
    elif op == "Crear relación":
        with st.form("n_rel"):
            c = st.columns(3)
            origen = c[0].text_input("origen", "Demo_Patrullero")
            tipo = c[1].selectbox("tipo", tipos_rel)
            destino = c[2].text_input("destino", "Demo_Vandalo")
            veces = st.number_input("veces", 1, 1000, 1)
            if st.form_submit_button("CREATE relación"):
                r = crud.neo4j_crear_relacion(drv, origen, destino, tipo, {"veces": int(veces)})
                if r is not None:
                    listo(r, f"({origen})-[:{tipo}]->({destino})")
                else:
                    st.error("Alguno de los dos editores no existe: créalos primero.")
    elif op == "Consultar":
        user = st.text_input("user", "Demo_Patrullero", key="n_read")
        res = crud.neo4j_consultar_editor(drv, user)
        if res:
            st.json(res)
        else:
            st.warning("Ese editor no existe.")
    elif op == "Actualizar propiedades":
        with st.form("n_upd"):
            c = st.columns(3)
            user = c[0].text_input("user", "Demo_Patrullero")
            clave = c[1].text_input("propiedad", "rol")
            valor = c[2].text_input("valor", "patrullero")
            if st.form_submit_button("SET propiedad"):
                if clave in ("user",):
                    st.error("La clave única no se puede cambiar.")
                else:
                    r = crud.neo4j_actualizar_editor(drv, user, {clave: valor})
                    if r:
                        listo(r, "Propiedad actualizada.")
                    else:
                        st.warning("Ese editor no existe.")
    elif op == "Eliminar relación":
        with st.form("n_delrel"):
            c = st.columns(3)
            origen = c[0].text_input("origen", "Demo_Patrullero")
            tipo = c[1].selectbox("tipo", tipos_rel)
            destino = c[2].text_input("destino", "Demo_Vandalo")
            if st.form_submit_button("DELETE relación", type="primary"):
                listo(mensaje=f"{crud.neo4j_eliminar_relacion(drv, origen, destino, tipo)} relación(es) eliminada(s).")
    else:
        with st.form("n_delnodo"):
            user = st.text_input("user", "Demo_Patrullero")
            if st.form_submit_button("DETACH DELETE nodo", type="primary"):
                listo(mensaje=f"{crud.neo4j_eliminar_nodo(drv, 'Editor', 'user', user)} nodo(s) eliminado(s) "
                              "junto con sus relaciones.")
