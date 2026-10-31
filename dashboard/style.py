"""Colores, estilo de los gráficos y definición de los KPIs que muestra el dashboard."""

import plotly.graph_objects as go

# Paleta categórica validada (orden fijo; el color sigue a la entidad, nunca al ranking).
WIKI_COLOR = {"enwiki": "#2a78d6", "eswiki": "#eb6834"}
TIPO_EDITOR_COLOR = {"registrado": "#2a78d6", "temporal": "#eb6834", "bot": "#1baf7a"}
OTRO = "#898781"           # gris neutro: "otros", referencias
GRID = "rgba(137,135,129,0.25)"
FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'


def estilo(fig: go.Figure, alto: int = 340, leyenda: bool = True) -> go.Figure:
    """Ejes y grilla discretos, una sola escala, hover unificado en series de tiempo."""
    fig.update_layout(
        height=alto,
        margin=dict(l=8, r=8, t=36, b=8),
        font=dict(family=FONT, size=13),
        showlegend=leyenda,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0, title=None),
        hoverlabel=dict(font_family=FONT),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        bargap=0.25,
    )
    fig.update_xaxes(showgrid=False, linecolor=GRID, title=None)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, title=None)
    return fig


# Definición, fórmula, fuente e interpretación de cada KPI (sección 6 de las instrucciones).
KPIS = {
    "eventos_procesados": dict(
        nombre="Eventos procesados", unidad="eventos/hora", fuente="Cassandra · resumen_por_hora",
        formula="count(eventos en la hora)",
        lectura="Volumen y salud del pipeline. Una caída brusca puede ser un problema del stream."),
    "crecimiento_pct": dict(
        nombre="Crecimiento de actividad", unidad="%", fuente="Cassandra · resumen_por_hora",
        formula="(eventos h − eventos h−1) / eventos h−1 × 100",
        lectura="Picos o caídas respecto de la hora anterior (ciclo día/noche, noticias)."),
    "tasa_automatizacion_pct": dict(
        nombre="Tasa de automatización", unidad="%", fuente="Cassandra · resumen_por_hora",
        formula="eventos de bots / eventos × 100",
        lectura="Cuánto del trabajo hacen bots. Bots: marca bot=true o 'bot' en el nombre."),
    "actividad_por_editor": dict(
        nombre="Actividad por editor humano", unidad="eventos/editor", fuente="Cassandra · resumen_por_hora",
        formula="eventos humanos / editores humanos distintos",
        lectura="Intensidad de la participación humana en la hora."),
    "tasa_creacion_pct": dict(
        nombre="Tasa de creación de contenido", unidad="%", fuente="MongoDB · events",
        formula="eventos new / (edit + new) × 100",
        lectura="Crecimiento (páginas nuevas) frente a mantenimiento (ediciones)."),
    "volumen_neto_bytes": dict(
        nombre="Volumen neto de contenido", unidad="bytes", fuente="MongoDB · events",
        formula="Σ (length.new − length.old)",
        lectura="Bytes agregados menos eliminados. Muy negativo puede indicar borrados masivos o vandalismo."),
    "tasa_reversion_pct": dict(
        nombre="Tasa de reversión", unidad="%", fuente="MongoDB · events",
        formula="ediciones que revierten a otro editor / ediciones × 100",
        lectura="Calidad de las ediciones: si sube, hay más vandalismo o conflicto."),
    "total_eventos_acumulados": dict(
        nombre="Eventos acumulados", unidad="eventos", fuente="MongoDB · events",
        formula="documentos en la colección events",
        lectura="Tamaño total del dataset almacenado."),
    "pagina_mas_disputada": dict(
        nombre="Página más disputada", unidad="editores distintos", fuente="Neo4j · EDITO",
        formula="página editada en la hora con más editores distintos (histórico)",
        lectura="Posibles guerras de ediciones o temas de actualidad."),
    "editor_mas_conectado": dict(
        nombre="Editor humano más conectado", unidad="coeditores", fuente="Neo4j · COEDITA",
        formula="editor humano activo en la hora con más relaciones COEDITA",
        lectura="Editores centrales de la comunidad (suelen ser patrulleros)."),
    "editor_mas_revertido": dict(
        nombre="Editor más revertido", unidad="reversiones", fuente="Neo4j · REVIRTIO",
        formula="editor con más reversiones recibidas, entre los revertidos en la hora",
        lectura="Candidato a vandalismo; la señal es más fuerte si lo revierten varios editores."),
    "calidad_datos_pct": dict(
        nombre="Calidad de datos", unidad="%", fuente="Limpieza (DAG)",
        formula="eventos válidos / eventos extraídos × 100",
        lectura="Porcentaje de eventos que pasaron la validación."),
}


def formato(valor, unidad: str) -> str:
    if valor is None:
        return "—"
    if unidad == "%":
        return f"{valor:,.2f}%"
    if unidad == "bytes":
        signo = "+" if valor > 0 else ""
        return f"{signo}{valor / 1e6:,.2f} MB" if abs(valor) >= 1e6 else f"{signo}{valor:,.0f} B"
    return f"{valor:,.0f}" if float(valor).is_integer() else f"{valor:,.2f}"
