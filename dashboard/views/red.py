"""Página 4 · Red de editores (Neo4j): tamaño del grafo, rankings y vecindario interactivo de un editor."""

import plotly.graph_objects as go
import streamlit as st
import streamlit.components.v1 as components
from pyvis.network import Network

import data
from style import OTRO, TIPO_EDITOR_COLOR, WIKI_COLOR, estilo

st.title("Red de editores")
st.caption("Fuente: Neo4j · nodos Editor, Pagina, Categoria y Wiki · relaciones entre editores derivadas del stream")

conteo = data.conteo_grafo()
c = st.columns(4)
c[0].metric("Editores", f"{conteo['nodos']['Editor']:,}")
c[1].metric("Páginas", f"{conteo['nodos']['Pagina']:,}")
c[2].metric("Categorías", f"{conteo['nodos']['Categoria']:,}")
c[3].metric("Relaciones EDITO", f"{conteo['relaciones']['EDITO']:,}")
c = st.columns(4)
c[0].metric("REVIRTIO", f"{conteo['relaciones']['REVIRTIO']:,}", help="Editor que revierte a otro editor")
c[1].metric("MENSAJE_A", f"{conteo['relaciones']['MENSAJE_A']:,}", help="Edición en la página de discusión de otro usuario")
c[2].metric("AGRADECIO", f"{conteo['relaciones']['AGRADECIO']:,}", help="Agradecimiento (log thanks)")
c[3].metric("COEDITA", f"{conteo['relaciones']['COEDITA']:,}", help="Editores humanos que editaron las mismas páginas (derivada)")

st.divider()


def barras(df, x, y, color, titulo_hover):
    fig = go.Figure(go.Bar(x=df[x], y=df[y], orientation="h", marker_color=color, text=df[x],
                           textposition="outside", cliponaxis=False,
                           hovertemplate="%{y}<br>%{x} " + titulo_hover + "<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    return estilo(fig, alto=360, leyenda=False)


c1, c2 = st.columns(2)
with c1:
    st.subheader("Editores más revertidos")
    rev = data.ranking_revertidos(10)
    if not rev.empty:
        st.plotly_chart(barras(rev, "reversiones", "editor", WIKI_COLOR["enwiki"], "reversiones recibidas"),
                        use_container_width=True)
        st.caption("Posible vandalismo. La columna revertido_por cuenta patrulleros distintos.")
        st.dataframe(rev, hide_index=True, use_container_width=True)
with c2:
    st.subheader("Patrulleros más activos")
    pat = data.ranking_patrulleros(10)
    if not pat.empty:
        st.plotly_chart(barras(pat, "reversiones", "editor", WIKI_COLOR["enwiki"], "reversiones hechas"),
                        use_container_width=True)
        st.caption("Editores (y bots antivandalismo) que más revierten.")
        st.dataframe(pat, hide_index=True, use_container_width=True)

st.subheader("Páginas más disputadas (últimas 24 h)")
disp = data.paginas_disputadas(24, 15)
if not disp.empty:
    st.dataframe(disp, hide_index=True, use_container_width=True,
                 column_config={"editores": st.column_config.ProgressColumn(
                     "editores distintos", min_value=0, max_value=int(disp["editores"].max()), format="%d")})

# ---------------------------------------------------------------- vecindario de un editor
st.divider()
st.subheader("Conexiones de un editor")
# Por defecto, el patrullero más activo: suele tener la red más rica (revierte y avisa a muchos editores).
sugerido = pat["editor"].iloc[0] if not pat.empty else (rev["editor"].iloc[0] if not rev.empty else "")
user = st.text_input("Editor (exacto)", value=sugerido)
limite = st.slider("Máximo de relaciones", 10, 100, 25, step=5)
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
