"""Página 2 · Actividad en el tiempo (Cassandra): serie por minuto, top de páginas e historial de un editor."""

from datetime import datetime, timezone

import plotly.graph_objects as go
import streamlit as st

import data
from style import TIPO_EDITOR_COLOR, WIKI_COLOR, estilo

st.title("Actividad en el tiempo")
st.caption("Fuente: Cassandra · tablas eventos_por_minuto, paginas_top_por_hora y actividad_editor")

f1, f2 = st.columns([1, 1])
wiki = f1.segmented_control("Wiki", ["enwiki", "eswiki"], default="enwiki") or "enwiki"
fecha = f2.date_input("Fecha (UTC)", datetime.now(timezone.utc).date())

# ---------------------------------------------------------------- por minuto
st.subheader(f"Eventos por minuto · {wiki}")
m = data.eventos_por_minuto(wiki, fecha)
if m.empty:
    st.info("Sin datos para esa fecha.")
else:
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=m["minuto"], y=m["eventos"], name="todos los eventos", mode="lines",
                             line=dict(color=WIKI_COLOR[wiki], width=2)))
    fig.add_trace(go.Scatter(x=m["minuto"], y=m["eventos_bot"], name="de bots", mode="lines",
                             line=dict(color=TIPO_EDITOR_COLOR["bot"], width=2)))
    fig.update_layout(hovermode="x unified")
    fig.update_traces(hovertemplate="%{y:,}")
    st.plotly_chart(estilo(fig), use_container_width=True)

    c1, c2, c3 = st.columns(3)
    c1.metric("Eventos del día", f"{m['eventos'].sum():,}")
    c2.metric("Promedio por minuto", f"{m['eventos'].mean():,.1f}")
    c3.metric("Reversiones del día", f"{m['reversiones'].sum():,}")

# ---------------------------------------------------------------- top de páginas
st.subheader("Páginas más editadas por hora")
top = data.paginas_top(wiki, fecha)
if top.empty:
    st.info("Sin datos para esa fecha.")
else:
    hora = st.select_slider("Hora (UTC)", options=sorted(top["hora"].unique()), value=int(top["hora"].max()))
    t = top[top["hora"] == hora].sort_values("posicion").head(10)
    fig = go.Figure(go.Bar(
        x=t["editores"], y=t["pagina"], orientation="h", marker_color=WIKI_COLOR[wiki],
        text=t["editores"], textposition="outside", cliponaxis=False,
        customdata=t[["ediciones", "delta_bytes"]],
        hovertemplate="%{y}<br>%{x} editores · %{customdata[0]} ediciones · %{customdata[1]:+,} bytes<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    st.plotly_chart(estilo(fig, alto=380, leyenda=False), use_container_width=True)
    st.caption("Ordenadas por editores distintos y luego por número de ediciones.")

# ---------------------------------------------------------------- historial de un editor
st.subheader("Historial de un editor")
editor = st.text_input("Nombre de usuario (exacto)", placeholder="p. ej. ClueBot NG")
if editor:
    h = data.actividad_editor(editor)
    if h.empty:
        st.warning("No hay actividad registrada para ese editor.")
    else:
        tipo = h["tipo_editor"].iloc[0]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Tipo", tipo)
        c2.metric("Ediciones", f"{h['ediciones'].sum():,}")
        c3.metric("Reversiones hechas", f"{h['reversiones_hechas'].sum():,}")
        c4.metric("Reversiones recibidas", f"{h['reversiones_recibidas'].sum():,}")
        porhora = h.groupby("hora_utc", as_index=False)["eventos"].sum()
        fig = go.Figure(go.Bar(x=porhora["hora_utc"], y=porhora["eventos"],
                               marker_color=TIPO_EDITOR_COLOR.get(tipo, WIKI_COLOR["enwiki"]),
                               hovertemplate="%{x|%Y-%m-%d %H:00} UTC · %{y} eventos<extra></extra>"))
        st.plotly_chart(estilo(fig, alto=260, leyenda=False), use_container_width=True)
        st.dataframe(h.drop(columns=["hora_utc"]), hide_index=True, use_container_width=True)
