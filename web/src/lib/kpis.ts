import { bytes, entero, numero, porcentaje, compararValores } from "./format"

export type Kpi =
  | "eventos_procesados" | "crecimiento_pct" | "tasa_automatizacion_pct" | "actividad_por_editor"
  | "tasa_creacion_pct" | "volumen_neto_bytes" | "tasa_reversion_pct" | "total_eventos_acumulados"
  | "pagina_mas_disputada" | "editor_mas_conectado" | "editor_mas_revertido" | "calidad_datos_pct"

export interface PuntoKpi {
  ventana: string
  valor: number | null
  detalle: string | null
}

interface Meta {
  periodo: "hora" | "acumulado"
  nombre: string
  /** Qué mide, en una frase */
  definicion: string
  /** Fórmula como fracción: [numerador, denominador, factor] (solo los KPIs que son un cociente) */
  fraccion?: [string, string, string?]
  unidad: "eventos" | "%" | "bytes" | "ratio" | "entidad"
  fuente: string
  formula: string
  lectura: string
  /** true: subir es bueno · false: subir es malo · null: neutro */
  subirEsBueno: boolean | null
}

/** Definición, fórmula, fuente e interpretación de cada KPI (sección 6 del curso). */
export const KPIS: Record<Kpi, Meta> = {
  eventos_procesados: { periodo: "hora", nombre: "Eventos de la hora", definicion: "Cantidad de eventos de Wikipedia (ediciones, páginas nuevas, registros y categorizaciones) procesados en la hora.", unidad: "eventos", fuente: "Cassandra · resumen_por_hora", formula: "count(eventos en la hora)", lectura: "Volumen y salud del pipeline; una caída brusca puede ser un problema del stream.", subirEsBueno: null },
  crecimiento_pct: { periodo: "hora", nombre: "Cambio frente a la hora anterior", definicion: "Variación de los eventos procesados respecto de la hora anterior.", fraccion: ["eventos h − eventos h−1", "eventos h−1", "× 100"], unidad: "%", fuente: "Cassandra · resumen_por_hora", formula: "(eventos h − eventos h−1) / eventos h−1 × 100", lectura: "Picos o caídas respecto de la hora anterior (ciclo día/noche, noticias).", subirEsBueno: null },
  tasa_automatizacion_pct: { periodo: "hora", nombre: "Eventos de bots", definicion: "Porcentaje de los eventos de la hora hechos por bots.", fraccion: ["eventos de bots", "total de eventos", "× 100"], unidad: "%", fuente: "Cassandra · resumen_por_hora", formula: "eventos de bots / eventos × 100", lectura: "Cuánto del trabajo hacen bots (marca bot=true o «bot» en el nombre).", subirEsBueno: null },
  actividad_por_editor: { periodo: "hora", nombre: "Actividad por editor humano", definicion: "Promedio de eventos por cada editor humano distinto que participó en la hora.", fraccion: ["eventos humanos", "editores humanos distintos", undefined], unidad: "ratio", fuente: "MongoDB · events", formula: "eventos humanos / editores humanos distintos", lectura: "Intensidad de la participación humana en la hora.", subirEsBueno: null },
  tasa_creacion_pct: { periodo: "hora", nombre: "Páginas nuevas", definicion: "Porcentaje de páginas nuevas entre todas las ediciones y creaciones de la hora.", fraccion: ["páginas nuevas", "ediciones + páginas nuevas", "× 100"], unidad: "%", fuente: "MongoDB · events", formula: "new / (edit + new) × 100", lectura: "Crecimiento (páginas nuevas) frente a mantenimiento (ediciones).", subirEsBueno: null },
  volumen_neto_bytes: { periodo: "hora", nombre: "Cambio neto de contenido", definicion: "Bytes de contenido agregados menos los eliminados en las ediciones de la hora.", unidad: "bytes", fuente: "MongoDB · events", formula: "Σ (length.new − length.old)", lectura: "Bytes agregados menos eliminados; muy negativo puede indicar borrados masivos o vandalismo.", subirEsBueno: null },
  tasa_reversion_pct: { periodo: "hora", nombre: "Ediciones que revierten", definicion: "Porcentaje de las ediciones de la hora que deshacen el trabajo de otro editor.", fraccion: ["ediciones que revierten a otro editor", "total de ediciones", "× 100"], unidad: "%", fuente: "MongoDB · events", formula: "ediciones que revierten a otro editor / ediciones × 100", lectura: "Frecuencia de reversiones detectadas en los comentarios; permite identificar actividad de revisión.", subirEsBueno: null },
  total_eventos_acumulados: { periodo: "acumulado", nombre: "Eventos acumulados", definicion: "Total de eventos guardados en MongoDB desde el inicio de la recolección hasta el fin de la hora.", unidad: "eventos", fuente: "MongoDB · events", formula: "documentos en events hasta el fin de la hora", lectura: "Tamaño total del dataset almacenado.", subirEsBueno: null },
  pagina_mas_disputada: { periodo: "hora", nombre: "Página más disputada", definicion: "La página que más reversiones recibió en la hora: cambios que un editor hizo y otro deshizo.", unidad: "entidad", fuente: "Cassandra · paginas_disputadas_por_hora", formula: "página con más reversiones recibidas en la hora", lectura: "Una página con muchas reversiones vive una guerra de ediciones o un ataque: es candidata a protegerse.", subirEsBueno: null },
  editor_mas_conectado: { periodo: "hora", nombre: "Editor humano más conectado", definicion: "Editor humano que comparte páginas con más editores humanos distintos durante la hora mostrada.", unidad: "entidad", fuente: "Neo4j · EDITO", formula: "editor con más coeditores humanos en las mismas páginas durante esa hora", lectura: "Editores centrales de la comunidad (suelen ser patrulleros).", subirEsBueno: null },
  editor_mas_revertido: { periodo: "hora", nombre: "Editor más revertido", definicion: "Editor que más reversiones recibió durante la hora mostrada.", unidad: "entidad", fuente: "Neo4j · REVIRTIO", formula: "editor con más reversiones recibidas durante esa hora", lectura: "Permite revisar qué cuenta recibió más reversiones en ese período.", subirEsBueno: null },
  calidad_datos_pct: { periodo: "hora", nombre: "Validación de eventos", definicion: "Porcentaje de los eventos extraídos en la hora que pasaron la validación.", fraccion: ["eventos válidos", "eventos extraídos", "× 100"], unidad: "%", fuente: "Limpieza · DAG", formula: "eventos válidos / eventos extraídos × 100", lectura: "Porcentaje de eventos que pasaron la validación.", subirEsBueno: true },
}

export function formatoKpi(kpi: Kpi, v: number | null | undefined): string {
  const u = KPIS[kpi].unidad
  if (u === "%") return porcentaje(v)
  if (u === "bytes") return bytes(v)
  if (u === "eventos") return entero(v)
  return numero(v)
}

/** Cambio respecto de la hora anterior, con su tono (bueno, malo o neutro). */
export function cambio(kpi: Kpi, serie: PuntoKpi[]) {
  const [actual, previa] = serie
  if (!actual || !previa || actual.valor == null || previa.valor == null) return null
  if (new Date(actual.ventana).getTime() - new Date(previa.ventana).getTime() !== 3_600_000) return null
  const d = actual.valor - previa.valor
  if (Math.abs(d) < 1e-9) return null // sin cambio: no se muestra pastilla
  const u = KPIS[kpi].unidad
  const texto =
    u === "%" ? `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} pp`
      : u === "bytes" ? bytes(d)
        : `${d >= 0 ? "+" : "−"}${Number.isInteger(d) ? entero(Math.abs(d)) : Math.abs(d).toFixed(2)}`
  const tono = u === "bytes" ? "neutro" : compararValores(actual.valor, previa.valor)
  return { texto, tono, sube: d >= 0 }
}
