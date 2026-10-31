"""Página 3 · Explorador de eventos (MongoDB): búsqueda con filtros y documento completo."""

import plotly.graph_objects as go
import streamlit as st

import data
from style import WIKI_COLOR, estilo

st.title("Explorador de eventos")
st.caption(f"Fuente: MongoDB · colección events · {data.total_eventos():,} documentos")

# ---------------------------------------------------------------- distribución por tipo
st.subheader("Eventos por tipo en las últimas 24 horas")
dist = data.tipos_por_wiki(24)
if not dist.empty:
    orden = dist.groupby("tipo")["eventos"].sum().sort_values(ascending=False).index.tolist()
    fig = go.Figure()
    for wiki in ("enwiki", "eswiki"):
        d = dist[dist["wiki"] == wiki].set_index("tipo").reindex(orden).fillna(0)
        fig.add_trace(go.Bar(x=orden, y=d["eventos"], name=wiki, marker_color=WIKI_COLOR[wiki],
                             text=d["eventos"].astype(int), texttemplate="%{text:,}", textposition="outside", cliponaxis=False,
                             hovertemplate="%{x} · %{y:,} eventos<extra>" + wiki + "</extra>"))
    fig.update_layout(barmode="group")
    st.plotly_chart(estilo(fig, alto=320), use_container_width=True)
    st.caption("edit = edición · categorize = página que entra o sale de una categoría · log = acción "
               "administrativa · new = página nueva. Agregación ($group) calculada en MongoDB.")

# ---------------------------------------------------------------- búsqueda
st.subheader("Buscar eventos")
c = st.columns([1, 1, 1.4, 1.4, 1])
wiki = c[0].selectbox("Wiki", ["todas", "enwiki", "eswiki"])
tipo = c[1].selectbox("Tipo", ["todos", "edit", "new", "categorize", "log"])
editor = c[2].text_input("Editor (exacto)")
titulo = c[3].text_input("Título contiene")
limite = c[4].number_input("Máximo", 10, 500, 50, step=10)
solo_rev = st.toggle("Solo ediciones que revierten a otro editor")

eventos = data.buscar_eventos(wiki, tipo, editor.strip(), titulo.strip(), solo_rev, int(limite))
if eventos.empty:
    st.info("Ningún evento coincide con los filtros.")
    st.stop()

st.dataframe(eventos.drop(columns=["_id"]), hide_index=True, use_container_width=True,
             column_config={"comentario": st.column_config.TextColumn(width="large")})

# ---------------------------------------------------------------- documento completo
st.subheader("Documento completo")
opciones = eventos["_id"].tolist()
elegido = st.selectbox("Evento", opciones,
                       format_func=lambda i: " · ".join(str(v) for v in eventos.loc[eventos["_id"] == i,
                                                                                 ["wiki", "tipo", "título", "editor"]].iloc[0]))
doc = data.documento(elegido)
if doc:
    st.caption("Así se guarda en MongoDB: los campos originales del stream más el subdocumento `derived` "
               "que agrega la limpieza.")
    st.json(doc, expanded=2)
