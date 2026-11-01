"""Página 3 · Explorador de eventos (MongoDB): búsqueda con filtros y documento completo."""

import plotly.graph_objects as go
import streamlit as st

import data
import ui
from style import WIKI_COLOR, estilo

total = data.total_eventos()
ui.hero("Documentos · MongoDB", "Explorador de eventos",
        "Cada cambio de Wikipedia se guarda completo como documento JSON, con sus campos originales y los "
        "campos derivados que agrega la limpieza. Busca, filtra y abre cualquier evento.",
        [f"{total:,} documentos en events", "validador $jsonSchema", "5 índices"])

# ---------------------------------------------------------------- distribución por tipo
dist = data.tipos_por_wiki(24)
ui.seccion("Qué tipo de cambios ocurren", "Eventos por tipo y wiki en las últimas 24 horas · agregación $group en MongoDB")
if not dist.empty:
    por_tipo = dist.groupby("tipo")["eventos"].sum()
    total_24 = int(por_tipo.sum())
    nombres = {"edit": "Ediciones", "categorize": "Categorizaciones", "log": "Acciones de registro", "new": "Páginas nuevas"}
    ui.kpi_grid([ui.kpi_card(nombres.get(t, t), f"{int(n):,}", acento=ui.BLUE, sub=f"{100 * n / total_24:.1f}% del total")
                 for t, n in por_tipo.sort_values(ascending=False).items()])
    with st.container(border=True):
        orden = por_tipo.sort_values(ascending=False).index.tolist()
        ui.leyenda({w: WIKI_COLOR[w] for w in ("enwiki", "eswiki")})
        fig = go.Figure()
        for wiki in ("enwiki", "eswiki"):
            d = dist[dist["wiki"] == wiki].set_index("tipo").reindex(orden).fillna(0)
            fig.add_trace(go.Bar(x=[nombres.get(t, t) for t in orden], y=d["eventos"], name=wiki,
                                 marker=dict(color=WIKI_COLOR[wiki], cornerradius=4),
                                 text=d["eventos"].astype(int), texttemplate="%{text:,}", textposition="outside",
                                 cliponaxis=False, hovertemplate="%{x} · %{y:,} eventos<extra>" + wiki + "</extra>"))
        fig.update_layout(barmode="group", bargroupgap=0.08)
        fig.update_yaxes(showticklabels=False, showgrid=False)
        st.plotly_chart(estilo(fig, alto=320, leyenda=False), use_container_width=True)

# ---------------------------------------------------------------- búsqueda
ui.seccion("Buscar eventos", "Consulta find() con filtros y orden por fecha descendente (índice por_wiki_tipo_fecha)")
with st.container(border=True):
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

st.dataframe(eventos.drop(columns=["_id"]), hide_index=True, use_container_width=True, height=380,
             column_config={
                 "fecha_utc": st.column_config.DatetimeColumn("fecha (UTC)", format="DD/MM HH:mm:ss"),
                 "Δbytes": st.column_config.NumberColumn(format="%+d"),
                 "comentario": st.column_config.TextColumn(width="large"),
             })

# ---------------------------------------------------------------- documento completo
ui.seccion("Documento completo", "Campos originales del stream + subdocumento derived agregado por la limpieza")
with st.container(border=True):
    opciones = eventos["_id"].tolist()
    elegido = st.selectbox("Evento", opciones, label_visibility="collapsed",
                           format_func=lambda i: " · ".join(str(v) for v in eventos.loc[eventos["_id"] == i,
                                                                                     ["wiki", "tipo", "título", "editor"]].iloc[0]))
    doc = data.documento(elegido)
    if doc:
        st.json(doc, expanded=2)
