"""Página 2 · Actividad en el tiempo (Cassandra): serie por minuto, top de páginas e historial de un editor."""

from datetime import datetime, timezone

import plotly.graph_objects as go
import streamlit as st

import data
import ui
from style import TIPO_EDITOR_COLOR, WIKI_COLOR, estilo

ui.hero("Series temporales · Cassandra", "Actividad en el tiempo",
        "Ritmo de ediciones minuto a minuto, las páginas más editadas de cada hora y el historial de cualquier "
        "editor. Cada vista lee una tabla de Cassandra diseñada para esa consulta.",
        ["eventos_por_minuto", "paginas_top_por_hora", "actividad_editor"])

with st.container(border=True):
    f1, f2 = st.columns([1, 1])
    wiki = f1.segmented_control("Wiki", ["enwiki", "eswiki"], default="enwiki") or "enwiki"
    # Por defecto, el último día con datos (al comienzo de un día UTC todavía puede no haber ninguno).
    resumen = data.resumen_por_hora(dias=4)
    ultimo_dia = resumen["hora_utc"].max().date() if not resumen.empty else datetime.now(timezone.utc).date()
    fecha = f2.date_input("Fecha (UTC)", ultimo_dia)

# ---------------------------------------------------------------- por minuto
m = data.eventos_por_minuto(wiki, fecha)
ui.seccion(f"Pulso de {wiki}", f"Eventos por minuto el {fecha:%d/%m/%Y} · partición ({wiki}, {fecha})")
if m.empty:
    st.info("Sin datos para esa fecha.")
else:
    pico = m.loc[m["eventos"].idxmax()]
    ui.kpi_grid([
        ui.kpi_card("Eventos del día", f"{m['eventos'].sum():,}", serie=m.sort_values("minuto")["eventos"].tolist()[-120:],
                    acento=WIKI_COLOR[wiki], sub=f"{len(m):,} minutos con datos"),
        ui.kpi_card("Promedio por minuto", f"{m['eventos'].mean():,.0f}", acento=WIKI_COLOR[wiki],
                    sub=f"pico de {pico['eventos']:,} a las {pico['minuto']:%H:%M}"),
        ui.kpi_card("Hechos por bots", f"{100 * m['eventos_bot'].sum() / max(m['eventos'].sum(), 1):,.1f}%",
                    acento=ui.AQUA, sub=f"{m['eventos_bot'].sum():,} eventos"),
        ui.kpi_card("Reversiones", f"{m['reversiones'].sum():,}", acento=ui.ORANGE,
                    serie=m.sort_values("minuto")["reversiones"].tolist()[-120:], sub="ediciones que revierten a otro"),
    ])
    with st.container(border=True):
        ui.leyenda({"todos los eventos": WIKI_COLOR[wiki], "de bots": TIPO_EDITOR_COLOR["bot"]})
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=m["minuto"], y=m["eventos"], name="todos los eventos", mode="lines",
                                 line=dict(color=WIKI_COLOR[wiki], width=1.8), fill="tozeroy",
                                 fillcolor="rgba(42,120,214,0.08)" if wiki == "enwiki" else "rgba(235,104,52,0.08)"))
        fig.add_trace(go.Scatter(x=m["minuto"], y=m["eventos_bot"], name="de bots", mode="lines",
                                 line=dict(color=TIPO_EDITOR_COLOR["bot"], width=1.8)))
        fig.update_layout(hovermode="x unified")
        fig.update_traces(hovertemplate="%{y:,}")
        st.plotly_chart(estilo(fig, alto=320, leyenda=False), use_container_width=True)

# ---------------------------------------------------------------- top de páginas
ui.seccion("Páginas más editadas por hora", "Ordenadas por editores distintos y luego por ediciones · top 10")
top = data.paginas_top(wiki, fecha)
if top.empty:
    st.info("Sin datos para esa fecha.")
else:
    with st.container(border=True):
        horas = sorted(top["hora"].unique())
        hora = st.select_slider("Hora (UTC)", options=horas, value=int(max(horas)),
                                format_func=lambda h: f"{h:02d}:00")
        t = top[top["hora"] == hora].sort_values("posicion").head(10)
        fig = go.Figure(go.Bar(
            x=t["editores"], y=t["pagina"], orientation="h", marker=dict(color=WIKI_COLOR[wiki], cornerradius=4),
            text=t["editores"], textposition="outside", cliponaxis=False,
            customdata=t[["ediciones", "delta_bytes"]],
            hovertemplate="%{y}<br>%{x} editores · %{customdata[0]} ediciones · %{customdata[1]:+,} bytes<extra></extra>"))
        fig.update_yaxes(autorange="reversed")
        fig.update_xaxes(showticklabels=False)
        st.plotly_chart(estilo(fig, alto=400, leyenda=False), use_container_width=True)

# ---------------------------------------------------------------- historial de un editor
ui.seccion("Historial de un editor", "Partición de actividad_editor: todas sus horas, de la más reciente a la más antigua")
with st.container(border=True):
    editor = st.text_input("Nombre de usuario (exacto)", placeholder="p. ej. ClueBot NG, Celjski Grad")
if editor:
    h = data.actividad_editor(editor)
    if h.empty:
        st.warning("No hay actividad registrada para ese editor.")
    else:
        tipo = h["tipo_editor"].iloc[0]
        color = TIPO_EDITOR_COLOR.get(tipo, ui.BLUE)
        porhora = h.groupby("hora_utc", as_index=False)["eventos"].sum().sort_values("hora_utc")
        ui.kpi_grid([
            ui.kpi_card("Tipo de editor", tipo, acento=color, sub=f"{h['wiki'].nunique()} wiki(s)"),
            ui.kpi_card("Ediciones", f"{h['ediciones'].sum():,}", acento=color, serie=porhora["eventos"].tolist(),
                        sub=f"{len(porhora)} horas activas"),
            ui.kpi_card("Reversiones hechas", f"{h['reversiones_hechas'].sum():,}", acento=ui.BLUE,
                        sub="revirtió a otros"),
            ui.kpi_card("Reversiones recibidas", f"{h['reversiones_recibidas'].sum():,}", acento=ui.ORANGE,
                        sub="lo revirtieron otros"),
        ])
        with st.container(border=True):
            fig = go.Figure(go.Bar(x=porhora["hora_utc"], y=porhora["eventos"], marker=dict(color=color, cornerradius=3),
                                   hovertemplate="%{x|%d %b %H:00} UTC · %{y} eventos<extra></extra>"))
            fig.update_xaxes(tickformat="%d %b<br>%H:%M")
            st.plotly_chart(estilo(fig, alto=260, leyenda=False), use_container_width=True)
            st.dataframe(h.drop(columns=["hora_utc"]), hide_index=True, use_container_width=True)
