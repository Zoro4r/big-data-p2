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

/** "2026-10-31T23:00:00+00:00" → "31 oct · 23:00" (siempre en UTC). */
export function horaUTC(iso: string, conDia = true): string {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  if (!conDia) return `${hh}:${mm}`
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getUTCMonth()]
  return `${d.getUTCDate()} ${mes} · ${hh}:${mm}`
}

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
