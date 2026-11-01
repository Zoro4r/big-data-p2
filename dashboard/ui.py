"""Componentes visuales del dashboard: estilos, cabecera, tarjetas de KPI con sparkline y secciones.

Streamlit no trae tarjetas con tendencia, así que se dibujan con HTML/CSS y un SVG pequeño.
Todo el texto que viene de los datos se escapa antes de insertarlo en el HTML.
"""

from __future__ import annotations

import html

import streamlit as st

BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
GOOD, BAD, NEUTRAL = "#0f7a3e", "#c0392b", "#6b6a65"

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

html, body, [class*="css"], .stMarkdown, .stText, button, input, textarea, select {
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif !important;
}
.stApp { background: #f6f7f9; }
.block-container { padding-top: 3.2rem; padding-bottom: 4rem; max-width: 1320px; }
h1, h2, h3 { letter-spacing: -0.02em; }

/* Sidebar */
section[data-testid="stSidebar"] { background: #0f172a; }
section[data-testid="stSidebar"] * { color: #cbd5e1 !important; }
section[data-testid="stSidebar"] a[aria-current="page"], section[data-testid="stSidebar"] a:hover {
  background: rgba(42,120,214,0.22) !important; border-radius: 8px;
}
section[data-testid="stSidebar"] a[aria-current="page"] span { color: #ffffff !important; font-weight: 600; }
.side-brand { padding: 6px 4px 14px; border-bottom: 1px solid rgba(148,163,184,0.2); margin-bottom: 6px; }
.side-brand .t { font-size: 1.05rem; font-weight: 800; color: #fff !important; letter-spacing: -0.01em; }
.side-brand .s { font-size: 0.78rem; color: #94a3b8 !important; margin-top: 2px; }

/* Cabecera */
.hero {
  background: linear-gradient(120deg, #0f172a 0%, #1e3a8a 55%, #2a78d6 100%);
  border-radius: 18px; padding: 26px 30px; color: #fff; margin-bottom: 22px;
  box-shadow: 0 10px 30px -12px rgba(15,23,42,0.45); position: relative; overflow: hidden;
}
.hero:after {
  content: ""; position: absolute; right: -60px; top: -60px; width: 260px; height: 260px;
  border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.16), rgba(255,255,255,0));
}
.hero .eyebrow { font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: #bfdbfe; font-weight: 600; }
.hero h1 { color: #fff; font-size: 2.1rem; font-weight: 800; margin: 4px 0 6px; padding: 0; }
.hero p { color: #dbeafe; margin: 0; font-size: 0.95rem; max-width: 760px; }
.hero .chips { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px;
  background: rgba(255,255,255,0.12); color: #fff; font-size: 0.8rem; font-weight: 500;
  border: 1px solid rgba(255,255,255,0.18);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,0.25); }

/* Secciones */
.section { margin: 26px 0 10px; }
.section .t { font-size: 1.15rem; font-weight: 700; color: #0f172a; }
.section .s { font-size: 0.85rem; color: #64748b; margin-top: 2px; }

/* Tarjetas de KPI */
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 14px; margin-bottom: 16px; }
.kpi {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px 18px 12px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04); position: relative; overflow: hidden;
}
.kpi:before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--accent, #2a78d6); }
.kpi .lbl { font-size: 0.74rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi .val { font-size: 1.85rem; font-weight: 800; color: #0f172a; margin: 6px 0 4px; letter-spacing: -0.02em; line-height: 1.1; }
.kpi .val.small { font-size: 1.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; }
.kpi .sub { font-size: 0.78rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill { font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.pill.good { color: #0f7a3e; background: #e3f5ea; }
.pill.bad { color: #b42318; background: #fde8e6; }
.pill.neutral { color: #475569; background: #eef2f6; }
.kpi .src { font-size: 0.7rem; color: #94a3b8; margin-top: 6px; }

/* Tarjetas destacadas (entidades del grafo) */
.spot { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px 18px; display: flex; gap: 14px; align-items: center; }
.spot .ic { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex: none; }
.spot .lbl { font-size: 0.75rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.spot .name { font-size: 1.1rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.spot .det { font-size: 0.8rem; color: #64748b; }
.spot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-bottom: 16px; }

/* Contenedores con borde de Streamlit como tarjetas */
[data-testid="stMain"] div[data-testid="stVerticalBlockBorderWrapper"] { background: #fff; border-radius: 14px !important; border-color: #e5e7eb !important; }
div[data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.82rem; color: #475569; margin: 4px 0 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
</style>
"""


def aplicar_estilo() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


def marca_sidebar() -> None:
    st.sidebar.markdown(
        '<div class="side-brand"><div class="t">📡 Wikipedia en vivo</div>'
        '<div class="s">Big Data · Proyecto Grupal II · UTEC</div></div>', unsafe_allow_html=True)


def hero(eyebrow: str, titulo: str, texto: str, chips: list[str] | None = None, en_vivo: bool = False) -> None:
    chips_html = ""
    if chips:
        items = []
        for i, c in enumerate(chips):
            dot = '<span class="dot"></span>' if en_vivo and i == 0 else ""
            items.append(f'<span class="chip">{dot}{html.escape(c)}</span>')
        chips_html = f'<div class="chips">{"".join(items)}</div>'
    st.markdown(
        f'<div class="hero"><div class="eyebrow">{html.escape(eyebrow)}</div><h1>{html.escape(titulo)}</h1>'
        f'<p>{html.escape(texto)}</p>{chips_html}</div>', unsafe_allow_html=True)


def seccion(titulo: str, subtitulo: str = "") -> None:
    sub = f'<div class="s">{html.escape(subtitulo)}</div>' if subtitulo else ""
    st.markdown(f'<div class="section"><div class="t">{html.escape(titulo)}</div>{sub}</div>', unsafe_allow_html=True)


def sparkline(valores: list[float], color: str = BLUE, ancho: int = 110, alto: int = 30) -> str:
    """Mini gráfico de línea en SVG (tendencia de las últimas horas)."""
    vals = [v for v in valores if v is not None]
    if len(vals) < 2:
        return ""
    lo, hi = min(vals), max(vals)
    rango = (hi - lo) or 1
    paso = ancho / (len(vals) - 1)
    pts = [(i * paso, alto - 3 - (v - lo) / rango * (alto - 6)) for i, v in enumerate(vals)]
    linea = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"0,{alto} " + linea + f" {ancho},{alto}"
    x, y = pts[-1]
    return (f'<svg width="{ancho}" height="{alto}" viewBox="0 0 {ancho} {alto}" aria-hidden="true">'
            f'<polygon points="{area}" fill="{color}" fill-opacity="0.10"/>'
            f'<polyline points="{linea}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.8" fill="{color}"/></svg>')


def kpi_card(etiqueta: str, valor: str, delta: str | None = None, tono: str = "neutral",
             serie: list[float] | None = None, acento: str = BLUE, fuente: str = "", sub: str = "",
             pequeno: bool = False) -> str:
    pill = f'<span class="pill {tono}">{html.escape(delta)}</span>' if delta else (
        f'<span class="sub">{html.escape(sub)}</span>' if sub else "<span></span>")
    spark = sparkline(serie or [], acento)
    src = f'<div class="src">{html.escape(fuente)}</div>' if fuente else ""
    clase = "val small" if pequeno else "val"
    return (f'<div class="kpi" style="--accent:{acento}"><div class="lbl" title="{html.escape(etiqueta)}">{html.escape(etiqueta)}</div>'
            f'<div class="{clase}" title="{html.escape(valor)}">{html.escape(valor)}</div>'
            f'<div class="row">{pill}{spark}</div>{src}</div>')


def kpi_grid(tarjetas: list[str]) -> None:
    st.markdown(f'<div class="kpi-grid">{"".join(tarjetas)}</div>', unsafe_allow_html=True)


def spot_card(icono: str, fondo: str, etiqueta: str, nombre: str, detalle: str) -> str:
    return (f'<div class="spot"><div class="ic" style="background:{fondo}">{icono}</div>'
            f'<div style="min-width:0"><div class="lbl">{html.escape(etiqueta)}</div>'
            f'<div class="name" title="{html.escape(nombre)}">{html.escape(nombre)}</div>'
            f'<div class="det">{html.escape(detalle)}</div></div></div>')


def spot_grid(tarjetas: list[str]) -> None:
    st.markdown(f'<div class="spot-grid">{"".join(tarjetas)}</div>', unsafe_allow_html=True)


def leyenda(items: dict[str, str]) -> None:
    partes = "".join(f'<span><i style="background:{c}"></i>{html.escape(n)}</span>' for n, c in items.items())
    st.markdown(f'<div class="legend">{partes}</div>', unsafe_allow_html=True)
