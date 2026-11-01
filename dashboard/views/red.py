"""Página 4 · Red de editores (Neo4j): tamaño del grafo, rankings y vecindario interactivo de un editor."""

import plotly.graph_objects as go
import streamlit as st
import streamlit.components.v1 as components
from pyvis.network import Network

import data
import ui
from style import OTRO, TIPO_EDITOR_COLOR, estilo

conteo = data.conteo_grafo()
nodos, rels = conteo["nodos"], conteo["relaciones"]
ui.hero("Grafo · Neo4j", "Red de editores",
        "Quién edita qué y, sobre todo, quién interactúa con quién: reversiones, mensajes, agradecimientos y "
        "bloqueos entre editores. Aquí aparecen los patrulleros, los vándalos y las páginas en disputa.",
        [f"{sum(nodos.values()):,} nodos", f"{sum(rels.values()):,} relaciones", "11 tipos de relación"])

ui.seccion("Tamaño del grafo", "Conteos leídos de los contadores internos de Neo4j")
ui.kpi_grid([
    ui.kpi_card("Editores", f"{nodos['Editor']:,}", acento=ui.BLUE, sub="nodos :Editor"),
    ui.kpi_card("Páginas", f"{nodos['Pagina']:,}", acento=ui.BLUE, sub="nodos :Pagina"),
    ui.kpi_card("Categorías", f"{nodos['Categoria']:,}", acento=ui.BLUE, sub="nodos :Categoria"),
    ui.kpi_card("Ediciones (EDITO)", f"{rels['EDITO']:,}", acento=ui.BLUE, sub="editor → página"),
    ui.kpi_card("Reversiones", f"{rels['REVIRTIO']:,}", acento=ui.ORANGE, sub="pares editor → editor (REVIRTIO)"),
    ui.kpi_card("Mensajes", f"{rels['MENSAJE_A']:,}", acento=ui.ORANGE, sub="avisos en discusión (MENSAJE_A)"),
    ui.kpi_card("Agradecimientos", f"{rels['AGRADECIO']:,}", acento=ui.AQUA, sub="AGRADECIO"),
    ui.kpi_card("Coedición", f"{rels['COEDITA']:,}", acento=ui.AQUA, sub="humanos con páginas en común"),
])


def barras(df, x, titulo_hover):
    """Barras horizontales coloreadas por tipo de editor (mismo código de color que el grafo)."""
    colores = [TIPO_EDITOR_COLOR.get(t, OTRO) for t in df["tipo"]]
    fig = go.Figure(go.Bar(x=df[x], y=df["editor"], orientation="h", marker=dict(color=colores, cornerradius=4),
                           text=df[x], textposition="outside", cliponaxis=False, customdata=df["tipo"],
                           hovertemplate="%{y} (%{customdata})<br>%{x} " + titulo_hover + "<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(showticklabels=False)
    return estilo(fig, alto=380, leyenda=False)


ui.seccion("Patrulla y vandalismo", "Rankings sobre la relación REVIRTIO · color = tipo de editor")
ui.leyenda({"registrado": TIPO_EDITOR_COLOR["registrado"], "cuenta temporal": TIPO_EDITOR_COLOR["temporal"],
            "bot": TIPO_EDITOR_COLOR["bot"]})
rev, pat = data.ranking_revertidos(10), data.ranking_patrulleros(10)
c1, c2 = st.columns(2)
with c1, st.container(border=True):
    st.markdown("**Editores más revertidos** · posible vandalismo")
    if not rev.empty:
        st.plotly_chart(barras(rev, "reversiones", "reversiones recibidas"), use_container_width=True)
        with st.expander("Ver tabla"):
            st.dataframe(rev, hide_index=True, use_container_width=True)
with c2, st.container(border=True):
    st.markdown("**Patrulleros más activos** · editores y bots que revierten")
    if not pat.empty:
        st.plotly_chart(barras(pat, "reversiones", "reversiones hechas"), use_container_width=True)
        with st.expander("Ver tabla"):
            st.dataframe(pat, hide_index=True, use_container_width=True)

ui.seccion("Páginas más disputadas", "Editadas en las últimas 24 h · ordenadas por editores distintos en toda su historia")
disp = data.paginas_disputadas(24, 15)
if not disp.empty:
    st.dataframe(disp, hide_index=True, use_container_width=True,
                 column_config={
                     "pagina": st.column_config.TextColumn("página", width="large"),
                     "editores": st.column_config.ProgressColumn(
                         "editores distintos", min_value=0, max_value=int(disp["editores"].max()), format="%d"),
                     "humanos": st.column_config.NumberColumn("humanos"),
                     "ediciones": st.column_config.NumberColumn("ediciones"),
                 })

# ---------------------------------------------------------------- vecindario de un editor
ui.seccion("Conexiones de un editor", "Vecindario en el grafo: REVIRTIO, MENSAJE_A, AGRADECIO, BLOQUEO y COEDITA")
# Por defecto, el patrullero más activo: suele tener la red más rica (revierte y avisa a muchos editores).
sugerido = pat["editor"].iloc[0] if not pat.empty else (rev["editor"].iloc[0] if not rev.empty else "")
with st.container(border=True):
    k1, k2 = st.columns([2, 1])
    user = k1.text_input("Editor (exacto)", value=sugerido)
    limite = k2.slider("Máximo de relaciones", 10, 100, 25, step=5)
if user:
    red = data.ego_red(user, limite)
    if red["centro"] is None:
        st.warning("Ese editor no existe en el grafo.")
    elif not red["relaciones"]:
        st.info("Ese editor no tiene relaciones con otros editores.")
    else:
        net = Network(height="600px", width="100%", directed=True, cdn_resources="remote", bgcolor="#ffffff")
        # Resortes cortos: el grafo ocupa menos y al ajustarse a la vista los nombres quedan legibles.
        net.barnes_hut(gravity=-2500, spring_length=70, spring_strength=0.05)
        con_etiquetas = len(red["relaciones"]) <= 12  # con muchas flechas, el texto va solo al pasar el mouse

        def color(tipo):
            return TIPO_EDITOR_COLOR.get(tipo, OTRO)

        centro = red["centro"]
        net.add_node(centro["user"], label=centro["user"], color=color(centro["tipo"]), size=28,
                     title=f"{centro['user']} · {centro['tipo']}",
                     font={"size": 26, "face": "system-ui", "strokeWidth": 4})
        for r in red["relaciones"]:
            if r["vecino"] not in net.get_nodes():
                net.add_node(r["vecino"], label=r["vecino"], color=color(r["tipo_vecino"]), size=14,
                             title=f"{r['vecino']} · {r['tipo_vecino']}",
                             font={"size": 20, "face": "system-ui", "strokeWidth": 4})
            net.add_edge(r["origen"], r["destino"], label=f"{r['tipo']} ({r['peso']})" if con_etiquetas else None,
                         title=f"{r['origen']} → {r['destino']} · {r['tipo']} ({r['peso']})", color="#898781",
                         width=1 + min(r["peso"], 10) / 3, arrows="" if r["tipo"] == "COEDITA" else "to",
                         font={"size": 16, "face": "system-ui", "color": "#52514e", "strokeWidth": 4})
        components.html(net.generate_html(notebook=False), height=620, scrolling=False)
        st.caption("Colores por tipo de editor: azul = registrado · naranja = cuenta temporal · aqua = bot · "
                   "gris = otro. Flechas: quién hace la acción; pasa el mouse sobre una flecha para ver el tipo "
                   "de relación y cuántas veces ocurrió. Rueda del mouse para acercar; arrastra los nodos.")
        st.dataframe(red["relaciones"], hide_index=True, use_container_width=True)
