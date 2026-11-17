export interface Actividad {
  fecha: string; fechas: string[]; corte: string | null
  pendientes: { eventos: number; horas: number }
  minutos: { t: string; eventos: number; eventos_bot: number; reversiones: number }[]
  horas: { hora: number; eventos: number; eventos_bot: number; eventos_humanos: number; reversiones: number }[]
  top: { hora: number; posicion: number; wiki: string; pagina: string; ediciones: number; editores: number; delta_bytes: number }[]
}

/** Tarjetas y gráfico cuentan las mismas horas, incluidos sus minutos sin eventos. */
export function totalesActividad(d: Actividad) {
  return {
    ev: d.horas.reduce((s, h) => s + h.eventos, 0),
    bots: d.horas.reduce((s, h) => s + h.eventos_bot, 0),
    rev: d.horas.reduce((s, h) => s + h.reversiones, 0),
    min: new Set(d.horas.map((h) => h.hora)).size * 60,
    pico: d.minutos.reduce<Actividad["minutos"][number] | null>((max, m) => !max || m.eventos > max.eventos ? m : max, null),
  }
}
