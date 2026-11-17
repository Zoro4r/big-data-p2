import type { Kpi, PuntoKpi } from "./kpis"
import { bytes, compararValores, entero, horaLocal, porcentaje, type TonoValor } from "./format"

export type VistaResumen = "hora" | "acumulado"
export type ProtagonistaId = "pagina_mas_disputada" | "editor_mas_conectado" | "editor_mas_revertido"
export interface Protagonista { valor: number | null; detalle: string | null }
export interface ProtagonistasAcumulados { protagonistas: Record<ProtagonistaId, Protagonista | null>; actualizando: boolean }
export interface Acumulado {
  eventos: number; ediciones: number; creaciones: number; eventos_bot: number; reversiones: number
  delta_bytes: number; horas: number; inicio: string | null; fin: string
}
export interface Resumen {
  acumulado: Acumulado | null
  kpis: Record<Kpi, PuntoKpi[]>
  horas: { hora_utc: string; wiki: string; eventos: number; eventos_bot: number; reversiones: number }[]
  ejecuciones: { ventana: string; calidad_pct: number | null; rechazados: number | null; fuente: string | null }[]
  total: number; desde: string | null; corte: string | null
  intervalo: { inicio: string | null; fin: string | null }
}

export interface MetricaAcumulada {
  id: string; nombre: string; valor: string; pie: string; principal: boolean
  definicion: string; formula: string; fuente: "mongo" | "cassandra"
  tonoValor?: TonoValor
}

export function metricasAcumuladas(data: Resumen | null): MetricaAcumulada[] {
  const a = data?.acumulado
  const creacion = a && a.ediciones + a.creaciones > 0 ? 100 * a.creaciones / (a.ediciones + a.creaciones) : null
  return [
    { id: "eventos", nombre: "Eventos consolidados", principal: true,
      valor: entero(a?.eventos), pie: a?.inicio ? `Desde ${horaLocal(a.inicio)}` : "Hasta el último cierre",
      definicion: "Eventos de todas las horas consolidadas hasta el corte mostrado. Los eventos recientes pendientes de consolidación se consultan en En vivo y el Explorador.",
      formula: "Suma de eventos de las horas consolidadas hasta el corte.", fuente: "cassandra" },
    { id: "contenido", nombre: "Variación de contenido", principal: true,
      valor: bytes(a?.delta_bytes), tonoValor: compararValores(a?.delta_bytes, 0), pie: "Bytes añadidos menos eliminados",
      definicion: "Cambio neto de contenido en todas las horas consolidadas hasta el corte.",
      formula: "Suma de delta_bytes de las horas consolidadas.", fuente: "cassandra" },
    { id: "creaciones", nombre: "Páginas creadas", principal: true,
      valor: entero(a?.creaciones), pie: "En las horas consolidadas",
      definicion: "Creaciones de páginas registradas en todas las horas consolidadas hasta el corte.",
      formula: "Suma de eventos new de las horas consolidadas.", fuente: "cassandra" },
    { id: "bots", nombre: "Eventos de bots", principal: true,
      valor: porcentaje(a?.eventos ? 100 * a.eventos_bot / a.eventos : null), pie: `${entero(a?.eventos_bot)} del total de eventos`,
      definicion: "Participación de los bots entre los eventos de todas las horas consolidadas.",
      formula: "Eventos de bots acumulados / eventos consolidados acumulados × 100.", fuente: "cassandra" },
    { id: "ediciones", nombre: "Ediciones consolidadas", principal: false,
      valor: entero(a?.ediciones), pie: "Cambios en páginas existentes",
      definicion: "Eventos de edición de páginas existentes en todas las horas consolidadas.",
      formula: "Suma de eventos edit de las horas consolidadas.", fuente: "cassandra" },
    { id: "reversiones", nombre: "Reversiones detectadas", principal: false,
      valor: entero(a?.reversiones), pie: "En las horas consolidadas",
      definicion: "Ediciones que revierten a otro editor, detectadas en todas las horas consolidadas.",
      formula: "Suma de reversiones de las horas consolidadas.", fuente: "cassandra" },
    { id: "creacion", nombre: "Proporción de páginas nuevas", principal: false,
      valor: porcentaje(creacion), pie: "Entre las ediciones y creaciones",
      definicion: "Parte de las ediciones y creaciones consolidadas que corresponde a páginas nuevas.",
      formula: "Creaciones acumuladas / (ediciones + creaciones acumuladas) × 100.", fuente: "cassandra" },
    { id: "horas", nombre: "Horas consolidadas", principal: false,
      valor: entero(a?.horas), pie: "Intervalos horarios distintos",
      definicion: "Horas completadas que aportan datos al acumulado para la wiki seleccionada.",
      formula: "Cantidad de ventanas horarias distintas completadas.", fuente: "cassandra" },
  ]
}

export const DEFINICION_PROTAGONISTA: Record<ProtagonistaId, string> = {
  pagina_mas_disputada: "Página con más reversiones recibidas en todas las horas consolidadas hasta el corte.",
  editor_mas_conectado: "Editor humano que comparte páginas con más editores humanos distintos en las horas consolidadas hasta el corte.",
  editor_mas_revertido: "Editor que recibe más reversiones en las horas consolidadas hasta el corte.",
}
