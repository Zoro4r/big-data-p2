"""Página 1 · Resumen: KPIs de la última hora procesada y su evolución."""

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import data
from style import KPIS, WIKI_COLOR, estilo, formato

st.title("Wikipedia en vivo")
st.caption("Monitoreo de la actividad colaborativa en enwiki y eswiki · KPIs calculados cada hora por el DAG")

kpis = data.kpis(horas=72)
if kpis.empty:
    st.info("Todavía no hay KPIs: el DAG aún no completó su primera hora.")
    st.stop()

ultima = kpis["ventana"].max()
st.markdown(f"**Última hora procesada:** {ultima:%Y-%m-%d %H:00}–{ultima:%H}:59 UTC")


def serie(kpi: str) -> pd.DataFrame:
    return kpis[kpis["kpi"] == kpi].sort_values("ventana")


def tarjeta(col, kpi: str, invertir: bool = False, delta: bool = True) -> None:
    """Valor de la última hora y diferencia con la hora anterior."""
    meta, s = KPIS[kpi], serie(kpi)
    actual = s[s["ventana"] == ultima]
    valor = actual["valor"].iloc[0] if not actual.empty else None
    previa = s[s["ventana"] < ultima]
    dif = None
    if delta and valor is not None and not previa.empty and previa["valor"].iloc[-1] is not None:
        d = valor - previa["valor"].iloc[-1]
        if meta["unidad"] == "%":
            dif = f"{d:+,.2f} pp"
        elif meta["unidad"] == "bytes":
            dif = formato(d, "bytes")
        else:
            dif = f"{d:+,.0f}" if float(d).is_integer() else f"{d:+,.2f}"
    col.metric(meta["nombre"], formato(valor, meta["unidad"]), dif,
               delta_color="inverse" if invertir else "off" if kpi != "eventos_procesados" else "normal",
               help=f"{meta['formula']} · Fuente: {meta['fuente']}")


c = st.columns(4)
tarjeta(c[0], "eventos_procesados")
tarjeta(c[1], "tasa_automatizacion_pct")
tarjeta(c[2], "tasa_reversion_pct", invertir=True)
tarjeta(c[3], "total_eventos_acumulados", delta=False)
c = st.columns(4)
tarjeta(c[0], "actividad_por_editor")
tarjeta(c[1], "tasa_creacion_pct")
tarjeta(c[2], "volumen_neto_bytes")
tarjeta(c[3], "calidad_datos_pct", delta=False)

# KPIs de grafo: el valor es una entidad (página o editor), no solo un número.
c = st.columns(3)
for col, kpi in zip(c, ("pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido")):
    meta, s = KPIS[kpi], serie(kpi)
    fila = s[s["ventana"] == ultima]
    if fila.empty or fila["valor"].iloc[0] is None:
        col.metric(meta["nombre"], "—")
        continue
    nombre = fila["detalle"].iloc[0] or ""
    # Sin delta: el número acompaña a la entidad, no es un cambio respecto de la hora anterior.
    col.metric(meta["nombre"], nombre.split(" (")[0], help=f"{meta['formula']} · Fuente: {meta['fuente']}")
    # El nombre completo va también en el texto: títulos largos se cortan en la tarjeta.
    col.caption(f"{nombre.split(' (')[0]} · {formato(fila['valor'].iloc[0], '')} {meta['unidad']}")

st.divider()

# ---------------------------------------------------------------- evolución por hora
st.subheader("Eventos por hora y wiki")
resumen = data.resumen_por_hora(dias=4)
if not resumen.empty:
    fig = go.Figure()
    for wiki in ("enwiki", "eswiki"):
        d = resumen[resumen["wiki"] == wiki]
        fig.add_trace(go.Scatter(
            x=d["hora_utc"], y=d["eventos"], name=wiki, mode="lines+markers",
            line=dict(color=WIKI_COLOR[wiki], width=2), marker=dict(size=6),
            hovertemplate="%{y:,} eventos<extra>" + wiki + "</extra>"))
    fig.update_layout(hovermode="x unified")
    fig.update_xaxes(tickformat="%d %b<br>%H:%M", dtick=3600000 * max(1, len(resumen) // 24))
    st.plotly_chart(estilo(fig), use_container_width=True)
    st.caption("Fuente: Cassandra · resumen_por_hora. enwiki concentra la mayor parte de la actividad.")

st.subheader("Evolución de un KPI")
numericos = [k for k in KPIS if k not in ("pagina_mas_disputada", "editor_mas_conectado", "editor_mas_revertido")]
elegido = st.selectbox("KPI", numericos, format_func=lambda k: KPIS[k]["nombre"], index=1)
s = serie(elegido).dropna(subset=["valor"])
if len(s) < 2:
    st.info("Hace falta más de una hora con este KPI para ver su evolución.")
else:
    meta = KPIS[elegido]
    fig = go.Figure(go.Scatter(
        x=s["ventana"], y=s["valor"], mode="lines+markers", name=meta["nombre"],
        line=dict(color=WIKI_COLOR["enwiki"], width=2), marker=dict(size=6),
        hovertemplate="%{x|%Y-%m-%d %H:00} UTC<br>%{y:,.2f} " + meta["unidad"] + "<extra></extra>"))
    fig.update_xaxes(tickformat="%d %b<br>%H:%M")
    st.plotly_chart(estilo(fig, alto=300, leyenda=False), use_container_width=True)
    st.caption(f"**{meta['nombre']}** ({meta['unidad']}) · {meta['formula']} · {meta['lectura']}")

# ---------------------------------------------------------------- definiciones
with st.expander("Definición, fórmula e interpretación de los 12 KPIs"):
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
