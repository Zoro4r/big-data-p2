const ENTERO = new Intl.NumberFormat("en-US")
const DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

export function entero(v: number | null | undefined): string {
  return v == null ? "—" : ENTERO.format(Math.round(v))
}

export function numero(v: number | null | undefined): string {
  return v == null ? "—" : DECIMAL.format(v)
}

export function porcentaje(v: number | null | undefined, decimales = 2): string {
  return v == null ? "—" : `${v.toFixed(decimales)} %`
}

export function bytes(v: number | null | undefined, signo = true): string {
  if (v == null) return "—"
  const s = signo && v > 0 ? "+" : v < 0 ? "−" : ""
  const a = Math.abs(v)
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)} MB`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)} kB`
  return `${s}${ENTERO.format(a)} B`
}

/** Zona horaria en la que el dashboard muestra las horas (Perú, sin horario de verano). Los datos se guardan en UTC. */
export const ZONA = "UTC−5"
const DESFASE_MS = -5 * 3_600_000
const DIA_MS = 24 * 3_600_000
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** Fecha guardada en UTC (con o sin zona, como la devuelve Mongo) → la misma fecha corrida a UTC−5.
 *  El resultado se lee con getUTC*() para obtener la hora en UTC−5. */
export function aLocal(iso: string | number): Date {
  const ms = typeof iso === "number" ? iso : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime()
  return new Date(ms + DESFASE_MS)
}

const dos = (n: number) => String(n).padStart(2, "0")

/** "2026-10-31T23:00:00+00:00" → "31 oct · 18:00" (en UTC−5). Con `segundos`, agrega :ss. */
export function horaLocal(iso: string | number, conDia = true, segundos = false): string {
  const d = aLocal(iso)
  const hora = `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}${segundos ? `:${dos(d.getUTCSeconds())}` : ""}`
  return conDia ? `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} · ${hora}` : hora
}

/** Hora y día en UTC−5 de una celda guardada por (fecha, hora) en UTC: ("2026-11-11", 3) → "10 nov · 22:00". */
export const horaDeCelda = (fecha: string, hora: number, conDia = true) => horaLocal(`${fecha}T${dos(hora)}:00:00Z`, conDia)

/** Eje de tiempo de un día completo (en UTC−5): agrega `ms` a cada punto y fija marcas cada `horas` horas en punto
 *  (00:00, 02:00, 04:00…), en lugar de las que Recharts elige según el espacio (01:46, 03:38…). */
export function ejeDia<T extends { t: string }>(serie: T[], horas = 2) {
  const datos = serie.map((p) => ({ ...p, ms: new Date(p.t).getTime() }))
  const ref = datos[0]?.ms ?? Date.now()
  // Medianoche en UTC−5 del día del primer punto, expresada en milisegundos reales.
  const dia = Math.floor((ref + DESFASE_MS) / DIA_MS) * DIA_MS - DESFASE_MS
  const paso = horas * 3_600_000
  const ticks = Array.from({ length: 24 / horas }, (_, i) => dia + i * paso)
  return { datos, ticks, dominio: [dia, dia + DIA_MS] as [number, number] }
}

/** Hora "HH:MM" (UTC−5) de una marca de tiempo en milisegundos. */
export const horaMs = (ms: number | string) => horaLocal(Number(ms), false)

export const COLOR = {
  enwiki: "#2a78d6",
  eswiki: "#eb6834",
  registrado: "#2a78d6",
  temporal: "#eb6834",
  bot: "#1baf7a",
  otro: "#a1a1aa",
} as const

/** Color de la serie según la wiki elegida; "ambas" usa un gris neutro para no confundirse con una wiki. */
export function colorWiki(wiki: string): string {
  return wiki === "enwiki" ? COLOR.enwiki : wiki === "eswiki" ? COLOR.eswiki : "var(--neutro)"
}

export function colorTipo(tipo: string | null | undefined): string {
  return (tipo && (COLOR as Record<string, string>)[tipo]) || COLOR.otro
}
