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
import { bytes, entero, horaLocal, intervaloLocal, compararValores, PALETA_METRICA } from "@/lib/format"
import { cambio, formatoKpi, KPIS, type Kpi, type PuntoKpi } from "@/lib/kpis"

interface Hora { hora_utc: string; wiki: string; eventos: number; eventos_bot: number; reversiones: number }
interface Ejecucion { ventana: string; calidad_pct: number | null; rechazados: number | null; fuente: string | null }

/** De dónde leyó la hora el proceso horario; las corridas anteriores a guardar la fuente salieron de EventStreams. */
const FUENTE: Record<string, string> = { mongodb: "MongoDB", eventstreams: "EventStreams" }

interface Acumulado { eventos: number; ediciones: number; creaciones: number; eventos_bot: number; reversiones: number; delta_bytes: number; horas: number; inicio: string | null; fin: string }
interface Resumen { acumulado: Acumulado | null; kpis: Record<Kpi, PuntoKpi[]>; horas: Hora[]; ejecuciones: Ejecucion[]; total: number; desde: string | null; corte: string | null; intervalo: { inicio: string | null; fin: string | null } }

// Todas estas tarjetas describen la misma hora consolidada.
const TARJETAS: { kpi: Kpi; pie: (r: Resumen) => string }[] = [
  { kpi: "eventos_procesados", pie: () => "Eventos válidos de esta hora" },
  { kpi: "crecimiento_pct", pie: () => "Variación frente a la hora anterior" },
  { kpi: "volumen_neto_bytes", pie: () => "Bytes añadidos menos eliminados" },
  { kpi: "tasa_creacion_pct", pie: () => "Entre las ediciones y creaciones de la hora" },
  { kpi: "tasa_automatizacion_pct", pie: () => "Eventos hechos por bots" },
  { kpi: "actividad_por_editor", pie: () => "Eventos por editor humano distinto" },
  { kpi: "tasa_reversion_pct", pie: (r) => `Entre las ediciones de la hora · ${r.kpis.tasa_reversion_pct[0]?.detalle ?? "—"}` },
  { kpi: "calidad_datos_pct", pie: () => "Eventos válidos / eventos extraídos" },
]

/** Un punto del gráfico de evolución: una hora procesada por el DAG. */
interface PuntoHora { ventana: string; valor: number; previo: number | null; ultima: boolean }

const HORAS_EVOLUCION = 72

function TooltipEvolucion({ active, payload, kpi }: { active?: boolean; payload?: { payload: PuntoHora }[]; kpi: Kpi }) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  const d = p.previo != null ? cambio(kpi, [{ ventana: p.ventana, valor: p.valor, detalle: null }, { ventana: new Date(new Date(p.ventana).getTime() - 3_600_000).toISOString(), valor: p.previo, detalle: null }]) : null
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
  const { data, cargando, error, recargar } = useApi<Resumen>(`/api/resumen?wiki=${wiki}`)
  const ultima = data?.kpis.eventos_procesados[0]?.ventana
  const fin = data?.corte
  const acumulado = data?.acumulado
  const periodo = ultima && fin ? intervaloLocal(ultima, fin) : "Pendiente de consolidación"
  const porHora = useMemo(() => {
    if (!data) return []
    const m = new Map<string, { hora: string; eventos: number }>()
    for (const h of data.horas.filter((x) => wikis.includes(x.wiki))) {
      const f = m.get(h.hora_utc) ?? { hora: h.hora_utc, eventos: 0 }
      f.eventos += h.eventos
      m.set(h.hora_utc, f)
    }
    // La calidad sale de la serie del KPI, que ya viene calculada para la wiki elegida
    const calidad = new Map(data.kpis.calidad_datos_pct.map((p) => [p.ventana.slice(0, 13), p.valor]))
    const fuente = new Map(data.ejecuciones.map((e) => [e.ventana.slice(0, 13), e.fuente]))
    return [...m.values()].sort((a, b) => b.hora.localeCompare(a.hora)).slice(0, 8)
      .map((f) => ({ ...f, calidad: calidad.get(f.hora.slice(0, 13)) ?? null, fuente: FUENTE[fuente.get(f.hora.slice(0, 13)) ?? ""] ?? "EventStreams" }))
  }, [data, wikis])

  // Últimas horas del KPI elegido, de la más antigua a la más reciente.
  const evolucion = useMemo<PuntoHora[]>(() => {
    const serie = (data?.kpis[kpiElegido] ?? []).filter((p) => p.valor != null).slice(0, HORAS_EVOLUCION).reverse()
    return serie.map((p, i) => ({ ventana: p.ventana, valor: p.valor as number,
      previo: i > 0 && new Date(p.ventana).getTime() - new Date(serie[i - 1].ventana).getTime() === 3_600_000 ? (serie[i - 1].valor as number) : null, ultima: i === serie.length - 1 }))
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
      <Pagina titulo="Resumen" descripcion={`${etiqueta} · resultados de horas completas. Abre una métrica para ver cómo se calcula.`}>
        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error} <button type="button" className="underline" onClick={recargar}>Reintentar</button></div>}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-base font-semibold">Última hora consolidada</h2><p className="text-sm text-muted-foreground">{periodo}</p></div>
          <span className="text-xs text-muted-foreground">Cambios frente a la hora anterior · verde al subir, rojo al bajar · reversiones al revés</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cargando || !data
            ? Array.from({ length: 8 }, (_, i) => <Cargando key={i} alto={150} />)
            : TARJETAS.map(({ kpi, pie }) => (
                <TarjetaKpi key={kpi} etiqueta={KPIS[kpi].nombre} valor={formatoKpi(kpi, data.kpis[kpi][0]?.valor)} color={KPIS[kpi].color}
                  tonoValor={kpi === "crecimiento_pct" ? compararValores(data.kpis[kpi][0]?.valor, 0) : undefined}
                  cambio={kpi === "crecimiento_pct" ? null : cambio(kpi, data.kpis[kpi])}
                  pie={pie(data)} onAbrir={() => setKpiAbierto(kpi)} />
              ))}
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-semibold">Acumulado</h2>
          <p className="text-sm text-muted-foreground">{fin ? `${etiqueta} · hasta ${horaLocal(fin)} UTC−5 · ${entero(acumulado?.horas)} horas consolidadas` : "Pendiente de una hora consolidada"}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <TarjetaKpi etiqueta="Eventos almacenados" color="azul" valor={formatoKpi("total_eventos_acumulados", data?.kpis.total_eventos_acumulados[0]?.valor)}
            pie={data?.desde ? `Desde ${horaLocal(data.desde)}` : "Registrados hasta el corte"} onAbrir={() => setKpiAbierto("total_eventos_acumulados")} />
          <TarjetaKpi etiqueta="Ediciones consolidadas" color="azul" valor={entero(acumulado?.ediciones)} pie="Cambios en páginas existentes" />
          <TarjetaKpi etiqueta="Páginas creadas" color="violeta" valor={entero(acumulado?.creaciones)} pie="Creaciones en las horas consolidadas" />
          <TarjetaKpi etiqueta="Eventos de bots" color="verde" valor={acumulado?.eventos ? `${(100 * acumulado.eventos_bot / acumulado.eventos).toFixed(2)} %` : "—"}
            pie={`${entero(acumulado?.eventos_bot)} de ${entero(acumulado?.eventos)} eventos consolidados`} />
          <TarjetaKpi etiqueta="Reversiones detectadas" color="rosa" valor={entero(acumulado?.reversiones)} pie="En todas las horas consolidadas" />
          <TarjetaKpi etiqueta="Cambio neto de contenido" color="cian" valor={bytes(acumulado?.delta_bytes)} pie="Bytes añadidos menos eliminados" />
        </div>

        <Seccion titulo={`Evolución por hora · ${etiqueta}`}
          descripcion={`Valor de cada hora consolidada · últimas ${evolucion.length || HORAS_EVOLUCION} horas disponibles · ${etiqueta}`}
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
              <BarChart data={evolucion} margin={{ left: 0, right: 16, top: 8 }} barCategoryGap="22%" maxBarSize={72}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="ventana" tickFormatter={(t) => horaLocal(t)} tickLine={false} axisLine={false} minTickGap={60} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={60} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={ejeY} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<TooltipEvolucion kpi={kpiElegido} />} />
                <Bar dataKey="valor" fill={PALETA_METRICA[KPIS[kpiElegido].color].grafico} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {evolucion.map((p) => {
                    const tono = KPIS[kpiElegido].unidad === "bytes" ? "neutro" : compararValores(p.valor, p.previo, kpiElegido === "tasa_reversion_pct")
                    const fill = tono === "bueno" ? "#10b981" : tono === "malo" ? "#ef4444" : PALETA_METRICA[KPIS[kpiElegido].color].grafico
                    return <Cell key={p.ventana} fill={fill} fillOpacity={p.ultima ? 1 : 0.65} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Seccion className="lg:col-span-2" titulo="Protagonistas de la hora" descripcion={`${periodo} · actividad exclusivamente de esta hora`}>
            {!data ? <Cargando alto={200} /> : (
              <div className="flex flex-col">
                {([
                  ["pagina_mas_disputada", FileText, "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400", "reversiones"],
                  ["editor_mas_conectado", Share2, "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400", "coeditores"],
                  ["editor_mas_revertido", Undo2, "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400", "reversiones"],
                ] as const).map(([kpi, Icono, estilo, unidad], i) => {
                  const p = data.kpis[kpi][0]
                  const sinActividad = kpi === "editor_mas_conectado" ? "Sin coedición humana en esta hora" : "Sin reversiones en esta hora"
                  const nombre = (p?.detalle ?? (p ? sinActividad : "Pendiente")).split(" (")[0].replace(/^(en|es)wiki:/, "")
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

          <Seccion className="lg:col-span-3" titulo="Ejecuciones del pipeline" descripcion={`Una fila por hora procesada por el DAG: sus eventos, de dónde leyó la hora y su calidad · ${etiqueta} · Cassandra resumen_por_hora y ejecuciones`}>
            {!data ? <Cargando alto={200} /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora (UTC−5)</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead>Leída de</TableHead>
                    <TableHead className="text-right">Calidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porHora.map((f) => {
                    return (
                      <TableRow key={f.hora}>
                        <TableCell className="font-medium">{horaLocal(f.hora)}</TableCell>
                        <TableCell className="text-right tabular-nums">{entero(f.eventos)}</TableCell>
                        <TableCell className="text-muted-foreground">{f.fuente}</TableCell>
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
