import { bytes, entero, numero, porcentaje } from "./format"

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
  nombre: string
  unidad: "eventos" | "%" | "bytes" | "ratio" | "entidad"
  fuente: string
  formula: string
  lectura: string
  /** true: subir es bueno · false: subir es malo · null: neutro */
  subirEsBueno: boolean | null
}

/** Definición, fórmula, fuente e interpretación de cada KPI (sección 6 del curso). */
export const KPIS: Record<Kpi, Meta> = {
  eventos_procesados: { nombre: "Eventos procesados", unidad: "eventos", fuente: "Cassandra · resumen_por_hora", formula: "count(eventos en la hora)", lectura: "Volumen y salud del pipeline; una caída brusca puede ser un problema del stream.", subirEsBueno: true },
  crecimiento_pct: { nombre: "Crecimiento de actividad", unidad: "%", fuente: "Cassandra · resumen_por_hora", formula: "(eventos h − eventos h−1) / eventos h−1 × 100", lectura: "Picos o caídas respecto de la hora anterior (ciclo día/noche, noticias).", subirEsBueno: null },
  tasa_automatizacion_pct: { nombre: "Tasa de automatización", unidad: "%", fuente: "Cassandra · resumen_por_hora", formula: "eventos de bots / eventos × 100", lectura: "Cuánto del trabajo hacen bots (marca bot=true o «bot» en el nombre).", subirEsBueno: null },
  actividad_por_editor: { nombre: "Actividad por editor humano", unidad: "ratio", fuente: "Cassandra · resumen_por_hora", formula: "eventos humanos / editores humanos distintos", lectura: "Intensidad de la participación humana en la hora.", subirEsBueno: null },
  tasa_creacion_pct: { nombre: "Tasa de creación", unidad: "%", fuente: "MongoDB · events", formula: "new / (edit + new) × 100", lectura: "Crecimiento (páginas nuevas) frente a mantenimiento (ediciones).", subirEsBueno: null },
  volumen_neto_bytes: { nombre: "Volumen neto de contenido", unidad: "bytes", fuente: "MongoDB · events", formula: "Σ (length.new − length.old)", lectura: "Bytes agregados menos eliminados; muy negativo puede indicar borrados masivos o vandalismo.", subirEsBueno: true },
  tasa_reversion_pct: { nombre: "Tasa de reversión", unidad: "%", fuente: "MongoDB · events", formula: "ediciones que revierten a otro editor / ediciones × 100", lectura: "Calidad de las ediciones: si sube, hay más vandalismo o conflicto.", subirEsBueno: false },
  total_eventos_acumulados: { nombre: "Eventos acumulados", unidad: "eventos", fuente: "MongoDB · events", formula: "documentos en events hasta el fin de la hora", lectura: "Tamaño total del dataset almacenado.", subirEsBueno: null },
  pagina_mas_disputada: { nombre: "Página más disputada", unidad: "entidad", fuente: "Neo4j · EDITO", formula: "página editada en la hora con más editores distintos (histórico)", lectura: "Posibles guerras de ediciones o temas de actualidad.", subirEsBueno: null },
  editor_mas_conectado: { nombre: "Editor humano más conectado", unidad: "entidad", fuente: "Neo4j · COEDITA", formula: "editor humano activo en la hora con más relaciones COEDITA", lectura: "Editores centrales de la comunidad (suelen ser patrulleros).", subirEsBueno: null },
  editor_mas_revertido: { nombre: "Editor más revertido", unidad: "entidad", fuente: "Neo4j · REVIRTIO", formula: "editor con más reversiones recibidas, entre los revertidos en la hora", lectura: "Candidato a vandalismo; la señal es más fuerte si lo revierten varios editores.", subirEsBueno: null },
  calidad_datos_pct: { nombre: "Calidad de datos", unidad: "%", fuente: "Limpieza · DAG", formula: "eventos válidos / eventos extraídos × 100", lectura: "Porcentaje de eventos que pasaron la validación.", subirEsBueno: true },
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
  const d = actual.valor - previa.valor
  if (Math.abs(d) < 1e-9) return null // sin cambio: no se muestra pastilla
  const u = KPIS[kpi].unidad
  const texto =
    u === "%" ? `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} pp`
      : u === "bytes" ? bytes(d)
        : `${d >= 0 ? "+" : "−"}${Number.isInteger(d) ? entero(Math.abs(d)) : Math.abs(d).toFixed(2)}`
  const bueno = KPIS[kpi].subirEsBueno
  const tono: "bueno" | "malo" | "neutro" = bueno == null || d === 0 ? "neutro" : (d > 0) === bueno ? "bueno" : "malo"
  return { texto, tono, sube: d >= 0 }
}
