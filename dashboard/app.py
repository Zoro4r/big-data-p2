"""Dashboard del proyecto: Wikipedia Recent Changes en MongoDB, Cassandra y Neo4j.

Uso: streamlit run dashboard/app.py   (en Docker: servicio `dashboard`, puerto 8501)
"""

import os

import streamlit as st

import ui

st.set_page_config(page_title="Wikipedia en vivo · Big Data P2", page_icon="📡", layout="wide")
ui.aplicar_estilo()


def acceso() -> bool:
    """Contraseña opcional (DASHBOARD_PASSWORD). En la VM se activa porque la página permite escribir."""
    clave = os.getenv("DASHBOARD_PASSWORD")
    if not clave or st.session_state.get("autenticado"):
        return True
    ui.hero("Acceso", "Wikipedia en vivo", "Dashboard del Proyecto Grupal II de Big Data. Ingresa la contraseña del equipo.")
    intento = st.text_input("Contraseña del dashboard", type="password")
    if intento:
        if intento == clave:
            st.session_state["autenticado"] = True
            st.rerun()
        st.error("Contraseña incorrecta.")
    return False


if acceso():
    ui.marca_sidebar()
    pages = st.navigation([
        st.Page("views/resumen.py", title="Resumen y KPIs", icon=":material/monitoring:", default=True),
        st.Page("views/actividad.py", title="Actividad en el tiempo", icon=":material/timeline:"),
        st.Page("views/explorador.py", title="Explorador de eventos", icon=":material/manage_search:"),
        st.Page("views/red.py", title="Red de editores", icon=":material/hub:"),
        st.Page("views/crud.py", title="Operaciones CRUD", icon=":material/edit_note:"),
    ])
    st.sidebar.caption("Datos de enwiki y eswiki · horas en UTC · se actualiza cada hora (DAG de Airflow)")
    pages.run()
