"""Página 1 · Resumen: KPIs de la última hora procesada y su evolución."""

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import data
import ui
from style import KPIS, WIKI_COLOR, estilo, formato

kpis = data.kpis(horas=72)
if kpis.empty:
    ui.hero("Panel principal", "Wikipedia en vivo", "Todavía no hay KPIs: el DAG aún no completó su primera hora.")
    st.stop()

ultima = kpis["ventana"].max()
horas = kpis["ventana"].nunique()
total = kpis[(kpis["kpi"] == "total_eventos_acumulados") & (kpis["ventana"] == ultima)]["valor"]
ui.hero(
    "Panel principal · enwiki + eswiki",
    "Wikipedia en vivo",
    "Monitoreo de la actividad colaborativa en Wikipedia: quién edita, cuánto hacen los bots, "
    "qué se revierte y qué páginas están en disputa. KPIs recalculados cada hora por Airflow.",
    [f"Pipeline activo · última hora {ultima:%d %b %H:00} UTC",
     f"{int(total.iloc[0]):,} eventos almacenados" if not total.empty else "—",
     f"{horas} horas procesadas"],
    en_vivo=True,
)


def serie(kpi: str) -> pd.DataFrame:
    return kpis[kpis["kpi"] == kpi].sort_values("ventana")


def tarjeta(kpi: str, mejor_si_sube: bool | None = True, acento: str = ui.BLUE, con_delta: bool = True,
            sub: str = "") -> str:
    """Valor de la última hora, cambio respecto de la anterior (con color según sea bueno o malo) y tendencia."""
    meta, s = KPIS[kpi], serie(kpi).dropna(subset=["valor"])
    actual = s[s["ventana"] == ultima]
    valor = actual["valor"].iloc[0] if not actual.empty else None
    previa = s[s["ventana"] < ultima]
    delta, tono = None, "neutral"
    if con_delta and valor is not None and not previa.empty:
        d = valor - previa["valor"].iloc[-1]
        if meta["unidad"] == "%":
            delta = f"{'▲' if d >= 0 else '▼'} {abs(d):,.2f} pp"
        elif meta["unidad"] == "bytes":
            delta = f"{'▲' if d >= 0 else '▼'} {formato(abs(d), 'bytes').lstrip('+')}"
        else:
            delta = f"{'▲' if d >= 0 else '▼'} {abs(d):,.0f}" if float(d).is_integer() else f"{'▲' if d >= 0 else '▼'} {abs(d):,.2f}"
        if mejor_si_sube is not None and d != 0:
            tono = "good" if (d > 0) == mejor_si_sube else "bad"
    return ui.kpi_card(meta["nombre"], formato(valor, meta["unidad"]), delta, tono,
                       s["valor"].tail(24).tolist(), acento, fuente=meta["fuente"],
                       sub="" if delta else sub)


ui.seccion("Indicadores de la última hora", "Cambio respecto de la hora anterior · tendencia de las últimas 24 horas")
ui.kpi_grid([
    tarjeta("eventos_procesados"),
    tarjeta("tasa_automatizacion_pct", None, ui.AQUA),
    tarjeta("tasa_reversion_pct", False, ui.ORANGE),
    tarjeta("actividad_por_editor"),
    tarjeta("tasa_creacion_pct"),
    tarjeta("volumen_neto_bytes"),
    tarjeta("crecimiento_pct", None, con_delta=False, sub="respecto de la hora anterior"),
    tarjeta("calidad_datos_pct", True, "#0f7a3e", con_delta=False, sub="eventos válidos / extraídos"),
])

# Entidades destacadas por el grafo (Neo4j)
ui.seccion("Protagonistas de la hora", "Calculados en Neo4j sobre el grafo acumulado")
spots = []
for kpi, icono, fondo in (("pagina_mas_disputada", "🔥", "#fff1e8"),
                          ("editor_mas_conectado", "🕸️", "#e8f1fc"),
                          ("editor_mas_revertido", "↩️", "#fde8e6")):
    meta, s = KPIS[kpi], serie(kpi)
    fila = s[s["ventana"] == ultima]
    if fila.empty or fila["valor"].iloc[0] is None:
        spots.append(ui.spot_card(icono, fondo, meta["nombre"], "—", "sin datos en esta hora"))
        continue
    nombre = (fila["detalle"].iloc[0] or "").split(" (")[0]
    spots.append(ui.spot_card(icono, fondo, meta["nombre"], nombre,
                              f"{formato(fila['valor'].iloc[0], '')} {meta['unidad']}"))
ui.spot_grid(spots)

# ---------------------------------------------------------------- evolución por hora
ui.seccion("Eventos por hora y wiki", "Fuente: Cassandra · resumen_por_hora")
resumen = data.resumen_por_hora(dias=4)
with st.container(border=True):
    if resumen.empty:
        st.info("Sin datos todavía.")
    else:
        fig = go.Figure()
        for wiki in ("enwiki", "eswiki"):
            d = resumen[resumen["wiki"] == wiki]
            fig.add_trace(go.Scatter(
                x=d["hora_utc"], y=d["eventos"], name=wiki, mode="lines+markers",
                line=dict(color=WIKI_COLOR[wiki], width=2.5, shape="spline", smoothing=0.6),
                marker=dict(size=7, line=dict(width=2, color="white")),
                fill="tozeroy", fillcolor=("rgba(42,120,214,0.10)" if wiki == "enwiki" else "rgba(235,104,52,0.10)"),
                hovertemplate="%{y:,} eventos<extra>" + wiki + "</extra>"))
        fig.update_layout(hovermode="x unified")
        n_horas = resumen["hora_utc"].nunique()
        fig.update_xaxes(tickformat="%d %b<br>%H:%M", dtick=3600000 * max(1, n_horas // 12))
        st.plotly_chart(estilo(fig, alto=330), use_container_width=True)

# ---------------------------------------------------------------- evolución de un KPI
ui.seccion("Evolución de un KPI", "Elige cualquier indicador numérico para ver su serie horaria")
with st.container(border=True):
    numericos = [k for k in KPIS if k not in ("pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido")]
    elegido = st.selectbox("KPI", numericos, format_func=lambda k: KPIS[k]["nombre"], index=2,
                           label_visibility="collapsed")
    s = serie(elegido).dropna(subset=["valor"])
    meta = KPIS[elegido]
    if len(s) < 2:
        st.info("Hace falta más de una hora con este KPI para ver su evolución.")
    else:
        fig = go.Figure(go.Scatter(
            x=s["ventana"], y=s["valor"], mode="lines+markers", name=meta["nombre"],
            line=dict(color=ui.BLUE, width=2.5), marker=dict(size=7, line=dict(width=2, color="white")),
            fill="tozeroy", fillcolor="rgba(42,120,214,0.08)",
            hovertemplate="%{x|%d %b %H:00} UTC<br>%{y:,.2f} " + meta["unidad"] + "<extra></extra>"))
        fig.update_xaxes(tickformat="%d %b<br>%H:%M", dtick=3600000 * max(1, len(s) // 12))
        st.plotly_chart(estilo(fig, alto=280, leyenda=False), use_container_width=True)
    st.caption(f"**Fórmula:** {meta['formula']} · **Interpretación:** {meta['lectura']}")

# ---------------------------------------------------------------- definiciones
ui.seccion("Definición de los KPIs", "Definición, fórmula de cálculo, fuente e interpretación (sección 6 del curso)")
tabla = []
for kpi, meta in KPIS.items():
    fila = serie(kpi)
    fila = fila[fila["ventana"] == ultima]
    valor = fila["valor"].iloc[0] if not fila.empty else None
    detalle = fila["detalle"].iloc[0] if not fila.empty else None
    tabla.append({"KPI": meta["nombre"], "Última hora": formato(valor, meta["unidad"]) + (f" · {detalle}" if detalle else ""),
                  "Fórmula": meta["formula"], "Fuente": meta["fuente"], "Interpretación": meta["lectura"]})
st.dataframe(pd.DataFrame(tabla), hide_index=True, use_container_width=True)

with st.expander("Ejecuciones del pipeline (registros procesados por hora)"):
    ej = data.ejecuciones(dias=3)
    if not ej.empty:
        st.dataframe(ej.rename(columns={"ventana": "hora_utc"}), hide_index=True, use_container_width=True)
