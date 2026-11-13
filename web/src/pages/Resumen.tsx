import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { FileText, Share2, Undo2 } from "lucide-react"

import { Cargando, Seccion, TarjetaKpi } from "@/components/common"
import { DetalleKpi } from "@/components/detalle-kpi"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorWiki, entero, horaLocal } from "@/lib/format"
import { cambio, formatoKpi, KPIS, type Kpi, type PuntoKpi } from "@/lib/kpis"

interface Hora { hora_utc: string; wiki: string; eventos: number; eventos_bot: number; reversiones: number }
interface Ejecucion { ventana: string; calidad_pct: number | null; rechazados: number | null }

interface Resumen { kpis: Record<Kpi, PuntoKpi[]>; horas: Hora[]; ejecuciones: Ejecucion[]; total: number }

// Por columnas, cada una un tema (Volumen, Contenido, Editores, Calidad): arriba el dato general, abajo uno
// más específico. Se listan columna por columna (en pantallas angostas cada tema queda junto) y `orden`
// las acomoda en la grilla de 4 columnas de pantallas anchas.
const TARJETAS: { kpi: Kpi; orden: string; pie: (r: Resumen) => string }[] = [
  { kpi: "total_eventos_acumulados", orden: "xl:order-1", pie: (r) => `${r.kpis.eventos_procesados.length} horas procesadas` },
  { kpi: "eventos_procesados", orden: "xl:order-5", pie: (r) => `Crecimiento ${formatoKpi("crecimiento_pct", r.kpis.crecimiento_pct[0]?.valor)}` },
  { kpi: "volumen_neto_bytes", orden: "xl:order-2", pie: () => "bytes agregados − eliminados" },
  { kpi: "tasa_creacion_pct", orden: "xl:order-6", pie: () => "páginas nuevas / ediciones" },
  { kpi: "tasa_automatizacion_pct", orden: "xl:order-3", pie: () => "eventos hechos por bots" },
  { kpi: "actividad_por_editor", orden: "xl:order-7", pie: () => "eventos por editor humano" },
  { kpi: "calidad_datos_pct", orden: "xl:order-4", pie: () => "eventos válidos / extraídos" },
  { kpi: "tasa_reversion_pct", orden: "xl:order-8", pie: (r) => `${r.kpis.tasa_reversion_pct[0]?.detalle ?? "—"} en la hora` },
]

/** Un punto del gráfico de evolución: una hora procesada por el DAG. */
interface PuntoHora { ventana: string; valor: number; previo: number | null; ultima: boolean }

const HORAS_EVOLUCION = 72

function TooltipEvolucion({ active, payload, kpi }: { active?: boolean; payload?: { payload: PuntoHora }[]; kpi: Kpi }) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  const d = p.previo != null ? cambio(kpi, [{ ventana: p.ventana, valor: p.valor, detalle: null }, { ventana: "", valor: p.previo, detalle: null }]) : null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{horaLocal(p.ventana)} UTC−5{p.ultima ? " · última hora" : ""}</div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{KPIS[kpi].nombre}</span>
        <span className="ml-auto font-medium tabular-nums">{formatoKpi(kpi, p.valor)}</span>
      </div>
      {d && <div className="mt-1 text-muted-foreground">frente a la hora anterior: <span className="text-foreground tabular-nums">{d.texto}</span></div>}
    </div>
  )
}

export default function ResumenPage() {
  const { wiki, wikis, etiqueta } = useWiki()
  const [kpiElegido, setKpiElegido] = useState<Kpi>("eventos_procesados")
  const [kpiAbierto, setKpiAbierto] = useState<Kpi | null>(null)
  const { data, cargando } = useApi<Resumen>(`/api/resumen?wiki=${wiki}`)
  const ultima = data?.kpis.eventos_procesados[0]?.ventana
  const porHora = useMemo(() => {
    if (!data) return []
    const m = new Map<string, { hora: string; eventos: number; bots: number; rev: number }>()
    for (const h of data.horas.filter((x) => wikis.includes(x.wiki))) {
      const f = m.get(h.hora_utc) ?? { hora: h.hora_utc, eventos: 0, bots: 0, rev: 0 }
      f.eventos += h.eventos; f.bots += h.eventos_bot; f.rev += h.reversiones
      m.set(h.hora_utc, f)
    }
    // La calidad sale de la serie del KPI, que ya viene calculada para la wiki elegida
    const calidad = new Map(data.kpis.calidad_datos_pct.map((p) => [p.ventana.slice(0, 13), p.valor]))
    return [...m.values()].sort((a, b) => b.hora.localeCompare(a.hora)).slice(0, 8)
      .map((f) => ({ ...f, calidad: calidad.get(f.hora.slice(0, 13)) ?? null }))
  }, [data, wikis])

  // Últimas horas del KPI elegido, de la más antigua a la más reciente.
  const evolucion = useMemo<PuntoHora[]>(() => {
    const serie = (data?.kpis[kpiElegido] ?? []).filter((p) => p.valor != null).slice(0, HORAS_EVOLUCION).reverse()
    return serie.map((p, i) => ({ ventana: p.ventana, valor: p.valor as number,
      previo: i > 0 ? (serie[i - 1].valor as number) : null, ultima: i === serie.length - 1 }))
  }, [data, kpiElegido])
  const ejeY = (v: number) => {
    const u = KPIS[kpiElegido].unidad
    if (u === "%") return `${v} %`
    if (u === "bytes") return `${Number((v / 1e6).toFixed(1))} MB`
    return Math.abs(v) >= 1000 ? `${v / 1000}k` : String(v)
  }

  return (
    <>
      <Header ruta={["Panel", "Resumen"]} />
      <Pagina titulo="Resumen" descripcion={ultima ? `Actividad de ${etiqueta} en la última hora procesada (${horaLocal(ultima)}–${horaLocal(ultima, false).slice(0, 2)}:59 UTC−5) y su cambio frente a la hora anterior. Haz clic en un KPI para ver su definición.` : "Cargando…"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cargando || !data
            ? Array.from({ length: 8 }, (_, i) => <Cargando key={i} alto={150} />)
            : TARJETAS.map(({ kpi, orden, pie }) => (
                <TarjetaKpi key={kpi} className={orden} etiqueta={KPIS[kpi].nombre} valor={formatoKpi(kpi, data.kpis[kpi][0]?.valor)}
                  cambio={kpi === "total_eventos_acumulados" ? null : cambio(kpi, data.kpis[kpi])}
                  pie={pie(data)} onAbrir={() => setKpiAbierto(kpi)} />
              ))}
        </div>

        <Seccion titulo={`Evolución por hora · ${etiqueta}`}
          descripcion={`${KPIS[kpiElegido].formula} · últimas ${evolucion.length || HORAS_EVOLUCION} horas procesadas por el DAG; la última, resaltada · ${KPIS[kpiElegido].fuente}`}
          accion={
            <Select value={kpiElegido} onValueChange={(v) => setKpiElegido(v as Kpi)}>
              <SelectTrigger className="w-64" aria-label="KPI"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARJETAS.map(({ kpi: k }) => (  // mismo orden que las tarjetas, columna por columna
                  <SelectItem key={k} value={k}>{KPIS[k].nombre}</SelectItem>
                ))}
              </SelectContent>
              </Select>
          }>
          {!data ? <Cargando alto={260} /> : evolucion.length < 2 ? <p className="text-sm text-muted-foreground">Hace falta más de una hora con este KPI para ver su evolución.</p> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={evolucion} margin={{ left: 0, right: 16, top: 8 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="ventana" tickFormatter={(t) => horaLocal(t)} tickLine={false} axisLine={false} minTickGap={60} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={60} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={ejeY} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<TooltipEvolucion kpi={kpiElegido} />} />
                <Bar dataKey="valor" fill={colorWiki(wiki)} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {evolucion.map((p) => <Cell key={p.ventana} fillOpacity={p.ultima ? 1 : 0.45} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Seccion className="lg:col-span-2" titulo="Protagonistas de la hora" descripcion={`${etiqueta} · la página, en Cassandra; los editores, en Neo4j sobre la red acumulada`}>
            {!data ? <Cargando alto={200} /> : (
              <div className="flex flex-col">
                {([
                  ["pagina_mas_disputada", FileText, "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400", "reversiones"],
                  ["editor_mas_conectado", Share2, "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400", "coeditores"],
                  ["editor_mas_revertido", Undo2, "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400", "reversiones"],
                ] as const).map(([kpi, Icono, estilo, unidad], i) => {
                  const p = data.kpis[kpi][0]
                  const nombre = (p?.detalle ?? "—").split(" (")[0].replace(/^(en|es)wiki:/, "")
                  const extra = p?.detalle?.match(/\((.*)\)/)?.[1]
                  return (
                    <button type="button" key={kpi} onClick={() => setKpiAbierto(kpi)} className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${i < 2 ? "border-b border-border" : ""}`}>
                      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${estilo}`}><Icono className="size-[18px]" aria-hidden /></div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">{KPIS[kpi].nombre}</span>
                        <span className="truncate text-sm font-medium" title={nombre}>{nombre}</span>
                      </div>
                      <Badge variant="outline" className="shrink-0 font-medium">{p?.valor != null ? `${entero(p.valor)} ${unidad}` : "—"}{extra ? ` · ${extra.replace("revertido por ", "por ")}` : ""}</Badge>
                    </button>
                  )
                })}
              </div>
            )}
          </Seccion>

          <Seccion className="lg:col-span-3" titulo="Ejecuciones del pipeline" descripcion={`Una fila por hora procesada por el DAG · ${etiqueta} · Cassandra resumen_por_hora y ejecuciones`}>
            {!data ? <Cargando alto={200} /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora (UTC−5)</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead>Bots</TableHead>
                    <TableHead className="text-right">Reversiones</TableHead>
                    <TableHead className="text-right">Calidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porHora.map((f) => {
                    const pct = (f.bots / Math.max(f.eventos, 1)) * 100
                    return (
                      <TableRow key={f.hora}>
                        <TableCell className="font-medium">{horaLocal(f.hora)}</TableCell>
                        <TableCell className="text-right tabular-nums">{entero(f.eventos)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLOR.bot }} /></div>
                            <span className="w-12 text-muted-foreground tabular-nums">{pct.toFixed(1)} %</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{f.rev}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400">{f.calidad != null ? `${f.calidad.toFixed(0)} %` : "—"}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Seccion>
        </div>


      </Pagina>
      <DetalleKpi kpi={kpiAbierto} series={data?.kpis ?? null} etiqueta={etiqueta} onCambiar={setKpiAbierto} />
    </>
  )
}
