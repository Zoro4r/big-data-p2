import { useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { FileText, Share2, Undo2 } from "lucide-react"

import { Cargando, Seccion, TarjetaKpi } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useApi } from "@/lib/api"
import { COLOR, entero, horaUTC } from "@/lib/format"
import { cambio, formatoKpi, KPIS, type Kpi, type PuntoKpi } from "@/lib/kpis"

interface Hora { hora_utc: string; wiki: string; eventos: number; eventos_bot: number; reversiones: number }
interface Ejecucion { ventana: string; calidad_pct: number | null; rechazados: number | null }
interface Resumen { kpis: Record<Kpi, PuntoKpi[]>; horas: Hora[]; ejecuciones: Ejecucion[]; total: number }
interface Serie10 { fecha: string; serie: { t: string; eventos: number; eventos_bot: number }[] }

const TARJETAS: { kpi: Kpi; pie: (r: Resumen) => string }[] = [
  { kpi: "eventos_procesados", pie: (r) => `Crecimiento ${formatoKpi("crecimiento_pct", r.kpis.crecimiento_pct[0]?.valor)}` },
  { kpi: "tasa_automatizacion_pct", pie: () => "eventos hechos por bots" },
  { kpi: "tasa_reversion_pct", pie: (r) => `${r.kpis.tasa_reversion_pct[0]?.detalle ?? "—"} en la hora` },
  { kpi: "actividad_por_editor", pie: () => "eventos por editor humano" },
  { kpi: "tasa_creacion_pct", pie: () => "páginas nuevas / ediciones" },
  { kpi: "volumen_neto_bytes", pie: () => "bytes agregados − eliminados" },
  { kpi: "total_eventos_acumulados", pie: (r) => `${r.kpis.eventos_procesados.length} horas procesadas` },
  { kpi: "calidad_datos_pct", pie: () => "eventos válidos / extraídos" },
]

function TooltipChart({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{horaUTC(label)} UTC</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{p.value.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  )
}

export default function ResumenPage() {
  const [wiki, setWiki] = useState("enwiki")
  const [kpiElegido, setKpiElegido] = useState<Kpi>("tasa_automatizacion_pct")
  const { data, cargando } = useApi<Resumen>("/api/resumen")
  const serie = useApi<Serie10>(`/api/serie10?wiki=${wiki}`)

  const ultima = data?.kpis.eventos_procesados[0]?.ventana
  const porHora = useMemo(() => {
    if (!data) return []
    const m = new Map<string, { hora: string; eventos: number; bots: number; rev: number }>()
    for (const h of data.horas) {
      const f = m.get(h.hora_utc) ?? { hora: h.hora_utc, eventos: 0, bots: 0, rev: 0 }
      f.eventos += h.eventos; f.bots += h.eventos_bot; f.rev += h.reversiones
      m.set(h.hora_utc, f)
    }
    const calidad = new Map(data.ejecuciones.map((e) => [e.ventana.slice(0, 13), e]))
    return [...m.values()].sort((a, b) => b.hora.localeCompare(a.hora)).slice(0, 8)
      .map((f) => ({ ...f, ejec: calidad.get(f.hora.slice(0, 13)) }))
  }, [data])

  const evolucion = useMemo(
    () => (data?.kpis[kpiElegido] ?? []).filter((p) => p.valor != null).slice().reverse(),
    [data, kpiElegido],
  )

  return (
    <>
      <Header ruta={["Panel", "Resumen"]}>
        <ToggleGroup type="single" value={wiki} onValueChange={(v) => v && setWiki(v)} variant="outline" size="sm" aria-label="Wiki del gráfico">
          <ToggleGroupItem value="enwiki" className="px-3">enwiki</ToggleGroupItem>
          <ToggleGroupItem value="eswiki" className="px-3">eswiki</ToggleGroupItem>
        </ToggleGroup>
      </Header>
      <Pagina titulo="Resumen" descripcion={ultima ? `Actividad de enwiki y eswiki en la última hora procesada (${horaUTC(ultima)}–${horaUTC(ultima, false).slice(0, 2)}:59 UTC) y su cambio frente a la hora anterior.` : "Cargando…"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cargando || !data
            ? Array.from({ length: 8 }, (_, i) => <Cargando key={i} alto={150} />)
            : TARJETAS.map(({ kpi, pie }) => (
                <TarjetaKpi key={kpi} etiqueta={KPIS[kpi].nombre} valor={formatoKpi(kpi, data.kpis[kpi][0]?.valor)}
                  cambio={kpi === "total_eventos_acumulados" ? null : cambio(kpi, data.kpis[kpi])}
                  pie={pie(data)} fuente={KPIS[kpi].fuente} titulo={`${KPIS[kpi].formula} · ${KPIS[kpi].lectura}`} />
              ))}
        </div>

        <Seccion titulo={`Ritmo de ediciones en ${wiki}`} descripcion={`Eventos cada 10 minutos · ${serie.data?.fecha ?? ""} UTC · Cassandra eventos_por_minuto`}>
          {!serie.data ? <Cargando alto={260} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={serie.data.serie} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="relleno" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR[wiki as "enwiki"]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={COLOR[wiki as "enwiki"]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="t" tickFormatter={(t) => horaUTC(t, false)} tickLine={false} axisLine={false} minTickGap={40} fontSize={11} stroke="#71717a" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="#71717a" tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                <Tooltip content={<TooltipChart />} />
                <Area type="monotone" dataKey="eventos" name="eventos" stroke={COLOR[wiki as "enwiki"]} strokeWidth={2} fill="url(#relleno)" />
                <Area type="monotone" dataKey="eventos_bot" name="de bots" stroke={COLOR.bot} strokeWidth={1.5} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Seccion className="lg:col-span-2" titulo="Protagonistas de la hora" descripcion="Calculados en Neo4j sobre el grafo acumulado">
            {!data ? <Cargando alto={200} /> : (
              <div className="flex flex-col">
                {([
                  ["pagina_mas_disputada", FileText, "bg-orange-50 text-orange-700", "editores"],
                  ["editor_mas_conectado", Share2, "bg-blue-50 text-blue-700", "coeditores"],
                  ["editor_mas_revertido", Undo2, "bg-red-50 text-red-700", "reversiones"],
                ] as const).map(([kpi, Icono, estilo, unidad], i) => {
                  const p = data.kpis[kpi][0]
                  const nombre = (p?.detalle ?? "—").split(" (")[0].replace(/^(en|es)wiki:/, "")
                  const extra = p?.detalle?.match(/\((.*)\)/)?.[1]
                  return (
                    <div key={kpi} className={`flex items-center gap-3 py-3 ${i < 2 ? "border-b border-zinc-100" : ""}`}>
                      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${estilo}`}><Icono className="size-[18px]" aria-hidden /></div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">{KPIS[kpi].nombre}</span>
                        <span className="truncate text-sm font-medium" title={nombre}>{nombre}</span>
                      </div>
                      <Badge variant="outline" className="shrink-0 font-medium">{p?.valor != null ? `${entero(p.valor)} ${unidad}` : "—"}{extra ? ` · ${extra.replace("revertido por ", "por ")}` : ""}</Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </Seccion>

          <Seccion className="lg:col-span-3" titulo="Ejecuciones del pipeline" descripcion="Una fila por hora procesada por el DAG · Cassandra resumen_por_hora y ejecuciones">
            {!data ? <Cargando alto={200} /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora (UTC)</TableHead>
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
                        <TableCell className="font-medium">{horaUTC(f.hora)}</TableCell>
                        <TableCell className="text-right tabular-nums">{entero(f.eventos)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLOR.bot }} /></div>
                            <span className="w-12 text-zinc-600 tabular-nums">{pct.toFixed(1)} %</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{f.rev}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">{f.ejec?.calidad_pct != null ? `${f.ejec.calidad_pct.toFixed(0)} %` : "ok"}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Seccion>
        </div>

        <Seccion titulo="Evolución de un KPI" descripcion={`${KPIS[kpiElegido].formula} · ${KPIS[kpiElegido].lectura}`}
          accion={
            <Select value={kpiElegido} onValueChange={(v) => setKpiElegido(v as Kpi)}>
              <SelectTrigger className="w-64" aria-label="KPI"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KPIS) as Kpi[]).filter((k) => KPIS[k].unidad !== "entidad").map((k) => (
                  <SelectItem key={k} value={k}>{KPIS[k].nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }>
          {evolucion.length < 2 ? <p className="text-sm text-muted-foreground">Hace falta más de una hora con este KPI para ver su evolución.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={evolucion} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="ventana" tickFormatter={(t) => horaUTC(t)} tickLine={false} axisLine={false} minTickGap={50} fontSize={11} stroke="#71717a" />
                <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} stroke="#71717a" />
                <Tooltip formatter={(v: number) => [formatoKpi(kpiElegido, v), KPIS[kpiElegido].nombre]} labelFormatter={(t) => `${horaUTC(String(t))} UTC`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="valor" stroke={COLOR.enwiki} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo="Definición de los KPIs" descripcion="Definición, fórmula de cálculo, fuente e interpretación (sección 6 del curso)">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>KPI</TableHead><TableHead>Última hora</TableHead><TableHead>Fórmula</TableHead><TableHead>Fuente</TableHead><TableHead>Interpretación</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(KPIS) as Kpi[]).map((k) => {
                  const p = data?.kpis[k]?.[0]
                  const valor = KPIS[k].unidad === "entidad" ? `${p?.detalle?.split(" (")[0] ?? "—"} (${entero(p?.valor)})` : formatoKpi(k, p?.valor)
                  return (
                    <TableRow key={k}>
                      <TableCell className="font-medium whitespace-nowrap">{KPIS[k].nombre}</TableCell>
                      <TableCell className="max-w-56 truncate tabular-nums" title={valor}>{valor}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-normal">{KPIS[k].formula}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{KPIS[k].fuente}</TableCell>
                      <TableCell className="min-w-64 whitespace-normal text-muted-foreground">{KPIS[k].lectura}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Seccion>
      </Pagina>
    </>
  )
}
