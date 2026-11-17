import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { UserRound } from "lucide-react"

import { Cargando, FilaBarra, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Base, ModalMetrica, type MetricaModal } from "@/components/modal-metrica"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, colorWiki, variacion, entero, horaDeCelda, horaLocal, ejeDia, horaMs } from "@/lib/format"

import { totalesActividad, type Actividad } from "@/lib/actividad"

type MetricaDia = "dia" | "prom" | "bots" | "rev"
const ORDEN_DIA: MetricaDia[] = ["dia", "prom", "bots", "rev"]
const NOMBRE_DIA: Record<MetricaDia, string> = { dia: "Eventos consolidados", prom: "Promedio por minuto", bots: "Eventos de bots", rev: "Reversiones detectadas" }

/** Anterior y siguiente (circular) para recorrer las tarjetas desde el modal. */
function vecinos<T>(lista: T[], actual: T, nombre: (x: T) => string, ir: (x: T) => void) {
  const i = lista.indexOf(actual), n = lista.length
  const a = lista[(i - 1 + n) % n], s = lista[(i + 1) % n]
  return { anterior: { nombre: nombre(a), ir: () => ir(a) }, siguiente: { nombre: nombre(s), ir: () => ir(s) } }
}

/** Detalle de cada tarjeta del día, a partir de las series por minuto y por hora de Cassandra. */
function metricaDia(k: MetricaDia, d: Actividad, etiqueta: string): MetricaModal {
  const horas = d.horas.slice().sort((a, b) => a.hora - b.hora)
  const { ev, bots, rev, min: minutos, pico } = totalesActividad(d)
  const max = (c: "eventos" | "reversiones") => horas.reduce((a, b) => (b[c] > a[c] ? b : a), horas[0])
  const min = horas.reduce((a, b) => (b.eventos < a.eventos ? b : a), horas[0])
  const hh = (h?: { hora: number }) => (h ? `${String(h.hora).padStart(2, "0")}:00` : "—")
  const desde = horas.length ? hh(horas[0]) : ""
  const origen = <>Se lee de <Base base="cassandra" /> (tabla resumen_por_hora). El detalle por minuto se restringe a esas mismas horas consolidadas.</>
  const comun = { etiqueta, momento: `${d.fecha} · UTC−5`, origen }
  if (k === "dia") return {
    ...comun, titulo: NOMBRE_DIA.dia, valor: minutos ? entero(ev) : "—", nota: "Solo horas consolidadas del día",
    serie: { valores: horas.map((h) => h.eventos), desde },
    datos: [["Hora más activa", `${hh(max("eventos"))} · ${entero(max("eventos")?.eventos)}`], ["Hora más tranquila", `${hh(min)} · ${entero(min?.eventos)}`],
      ["Promedio por hora", horas.length ? entero(ev / horas.length) : "—"]],
    definicion: `Eventos de ${etiqueta} de las horas consolidadas del día elegido (UTC−5).`,
    calculo: { texto: "Σ eventos de las horas consolidadas del día" },
    lectura: "Volumen diario de actividad. Permite comparar días y ver el ciclo de día y noche de cada wiki.",
  }
  if (k === "prom") return {
    ...comun, titulo: NOMBRE_DIA.prom, valor: minutos ? entero(ev / minutos) : "—",
    nota: pico ? `pico de ${entero(pico.eventos)} a las ${horaLocal(pico.t, false)}` : undefined,
    serie: { valores: horas.map((h) => h.eventos / 60), desde },
    datos: [["Minutos consolidados", entero(minutos)], ["Minuto más activo", pico ? `${entero(pico.eventos)} · ${horaLocal(pico.t, false)}` : "—"]],
    definicion: "Promedio por minuto de las horas consolidadas del día, incluidos sus minutos sin eventos.",
    calculo: { fraccion: ["eventos consolidados del día", "horas consolidadas × 60"] },
    lectura: "Ritmo habitual de la wiki. Un pico muy por encima del promedio suele ser un bot trabajando en ráfaga o una noticia.",
  }
  if (k === "bots") return {
    ...comun, titulo: NOMBRE_DIA.bots, valor: ev ? `${((bots / ev) * 100).toFixed(2)} %` : "—", nota: `${entero(bots)} eventos de bots`,
    serie: { valores: horas.map((h) => (h.eventos ? (h.eventos_bot / h.eventos) * 100 : 0)), desde },
    datos: [["Eventos de bots", entero(bots)], ["Eventos humanos", entero(ev - bots)]],
    definicion: "Porcentaje de los eventos consolidados del día hechos por bots.",
    calculo: { fraccion: ["eventos de bots", "total de eventos", "× 100"] },
    lectura: "Cuánto del trabajo diario hacen bots (marca bot=true o «bot» en el nombre). Si sube en ciertas horas, suele ser un bot procesando páginas en lote.",
  }
  return {
    ...comun, titulo: NOMBRE_DIA.rev, valor: minutos ? entero(rev) : "—", nota: "Ediciones que deshacen cambios de otro editor",
    serie: { valores: horas.map((h) => h.reversiones), desde },
    datos: [["Hora con más", `${hh(max("reversiones"))} · ${entero(max("reversiones")?.reversiones)}`], ["Por cada 100 eventos", ev ? ((rev / ev) * 100).toFixed(2) : "—"]],
    definicion: "Ediciones de las horas consolidadas del día que deshacen el trabajo de otro editor.",
    calculo: { texto: "Σ reversiones de las horas consolidadas del día" },
    lectura: "Señal de vandalismo o de conflicto. Las horas con muchas reversiones suelen coincidir con patrulleros o bots antivandalismo activos.",
  }
}

interface FilaEditor { fecha: string; hora: number; wiki: string; tipo_editor: string; eventos: number; ediciones: number; reversiones_hechas: number; reversiones_recibidas: number }

export default function ActividadPage() {
  const { wiki, wikis, etiqueta } = useWiki()
  const [fecha, setFecha] = useState<string | null>(null)
  const [hora, setHora] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [metrica, setMetrica] = useState<MetricaDia | null>(null)
  const [editor, setEditor] = useState<string | null>(null)
  const { data } = useApi<Actividad>(`/api/actividad?wiki=${wiki}${fecha ? `&fecha=${fecha}` : ""}`)
  const diaAnterior = data?.fecha ? new Date(new Date(data.fecha + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10) : null
  const comparacion = useApi<Actividad>(diaAnterior && data?.fechas.includes(diaAnterior) ? `/api/actividad?wiki=${wiki}&fecha=${diaAnterior}` : null)
  useEffect(() => setHora(null), [wiki, fecha])
  // Hora que se abre minuto a minuto en un modal al hacer clic en el gráfico por hora.
  const [horaMin, setHoraMin] = useState<number | null>(null)
  useEffect(() => setHoraMin(null), [wiki, fecha])
  const historial = useApi<FilaEditor[]>(editor ? `/api/editor/${encodeURIComponent(editor)}` : null)

  const tot = useMemo(() => data ? totalesActividad(data) : null, [data])
  const previo = useMemo(() => {
    if (!data?.horas.length || !comparacion.data) return null
    const elegidas = new Set(data.horas.map((h) => h.hora))
    const anteriores = comparacion.data.horas.filter((h) => elegidas.has(h.hora))
    if (anteriores.length !== elegidas.size) return null
    const result = totalesActividad({ ...comparacion.data, horas: anteriores })
    return { ...result, minutos: result.min }
  }, [data, comparacion.data])

  const horas = useMemo(() => (data?.horas ?? []).slice().sort((a, b) => a.hora - b.hora).map((h) => ({ ...h, etiqueta: `${String(h.hora).padStart(2, "0")}:00` })), [data])
  const horaVista = horaMin
  // Los 60 minutos de la hora elegida (UTC−5); humanos = eventos − bots, para apilar las dos partes en cada barra.
  const ejeHora = useMemo(() => {
    const dia = ejeDia(data?.minutos ?? []).dominio[0]
    const inicio = dia + (horaVista ?? 0) * 3_600_000, fin = inicio + 3_600_000
    const datos = (data?.minutos ?? []).map((m) => ({ ...m, ms: new Date(m.t).getTime(), humanos: m.eventos - m.eventos_bot }))
      .filter((m) => m.ms >= inicio && m.ms < fin)
    return { datos, dominio: [inicio - 30_000, fin - 30_000] as [number, number], ticks: Array.from({ length: 7 }, (_, i) => inicio + i * 600_000) }
  }, [data, horaVista])
  const etiquetaHora = (h: number) => `${String(h).padStart(2, "0")}:00`
  const horasTop = useMemo(() => [...new Set((data?.top ?? []).map((t) => t.hora))].sort((a, b) => b - a), [data])
  const horaSel = hora ?? horasTop[0] ?? null
  const top = (data?.top ?? []).filter((t) => t.hora === horaSel).sort((a, b) => a.posicion - b.posicion).slice(0, 10)

  const hist = useMemo(() => {
    const filas = (historial.data ?? []).filter((f) => wikis.includes(f.wiki))
    const porHora = new Map<string, number>()
    for (const f of filas) {
      const k = `${f.fecha}T${String(f.hora).padStart(2, "0")}:00:00Z`
      porHora.set(k, (porHora.get(k) ?? 0) + f.eventos)
    }
    return { filas, serie: [...porHora.entries()].sort().map(([t, eventos]) => ({ t, eventos })) }
  }, [historial.data, wikis])

  const buscar = (e: FormEvent) => {
    e.preventDefault()
    if (busqueda.trim()) setEditor(busqueda.trim())
  }

  return (
    <>
      <Header ruta={["Panel", "Actividad en el tiempo"]} />
      <Pagina titulo="Actividad en el tiempo" descripcion={`Actividad consolidada de ${etiqueta} el ${data?.fecha ?? "…"} (UTC−5).`}
        acciones={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Día (UTC−5)</span>
            <Select value={data?.fecha ?? ""} onValueChange={setFecha}>
              <SelectTrigger className="w-40" aria-label="Día (UTC−5)"><SelectValue placeholder="Fecha" /></SelectTrigger>
              <SelectContent>{(data?.fechas ?? []).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }>
        {Boolean(data?.pendientes?.eventos) && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Además, {entero(data?.pendientes.eventos)} eventos del día esperan consolidación.</p>}
        {previo && <p className="text-xs text-muted-foreground">Cambios frente a las mismas horas del día anterior.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!tot ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : (
            <>
              <TarjetaKpi etiqueta={NOMBRE_DIA.dia} cambio={variacion(tot.ev, previo?.ev)} valor={tot.min ? entero(tot.ev) : "—"} pie={data?.corte ? `Cierre: ${horaLocal(data.corte)}` : "Sin horas consolidadas"} onAbrir={() => setMetrica("dia")} />
              <TarjetaKpi etiqueta="Promedio por minuto" cambio={variacion(tot.ev / tot.min, previo ? previo.ev / previo.minutos : null)} valor={tot.min ? entero(tot.ev / tot.min) : "—"} pie={tot.pico ? `Pico de ${entero(tot.pico.eventos)} a las ${horaLocal(tot.pico.t, false)}` : "Sin horas consolidadas"} onAbrir={() => setMetrica("prom")} />
              <TarjetaKpi etiqueta={NOMBRE_DIA.bots} cambio={variacion(tot.ev ? 100 * tot.bots / tot.ev : null, previo?.ev ? 100 * previo.bots / previo.ev : null, "pp")} valor={tot.ev ? `${((tot.bots / tot.ev) * 100).toFixed(2)} %` : "—"} pie={`${entero(tot.bots)} de ${entero(tot.ev)} eventos`} onAbrir={() => setMetrica("bots")} />
              <TarjetaKpi etiqueta={NOMBRE_DIA.rev} cambio={variacion(tot.rev, previo?.rev)} valor={tot.min ? entero(tot.rev) : "—"} pie="Deshacen cambios de otro editor" onAbrir={() => setMetrica("rev")} />
            </>
          )}
        </div>

        <Seccion titulo="Eventos por hora" descripcion="Horas consolidadas · haz clic en una barra para ver sus minutos" accion={<Leyenda items={[{ nombre: "Humanos", color: COLOR.humano }, { nombre: "Bots", color: COLOR.bot }]} />}>
          {!data ? <Cargando alto={260} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={horas} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="22%" className="cursor-pointer"
                onClick={(e) => { const h = horas.find((x) => x.etiqueta === e?.activeLabel); if (h) setHoraMin(h.hora) }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Bar dataKey="eventos_humanos" name="Humanos" stackId="a" fill={COLOR.humano} />
                <Bar dataKey="eventos_bot" name="Bots" stackId="a" fill={COLOR.bot} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>


        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Seccion className="lg:col-span-3" titulo="Páginas con más editores" descripcion="Editores distintos en la hora · Cassandra paginas_top_por_hora"
            accion={
              <Select value={horaSel != null ? String(horaSel) : ""} onValueChange={(v) => setHora(Number(v))}>
                <SelectTrigger size="sm" className="w-28" aria-label="Hora (UTC−5)"><SelectValue placeholder="Hora" /></SelectTrigger>
                <SelectContent>{horasTop.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
              </Select>
            }>
            {!data ? <Cargando alto={300} /> : (
              <div className="flex flex-col gap-2.5">
                {top.map((p) => (
                  <div key={p.posicion} className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{p.posicion}</span>
                    <FilaBarra nombre={p.pagina} valor={p.editores} max={top[0]?.editores ?? 1} color={colorWiki(p.wiki)} />
                  </div>
                ))}
              </div>
            )}
          </Seccion>

          <Seccion className="lg:col-span-2" titulo="Historial de un editor" descripcion="Partición de actividad_editor: todas sus horas">
            <form onSubmit={buscar} className="flex flex-col gap-2">
              <Label htmlFor="editor">Nombre de usuario</Label>
              <div className="flex gap-2">
                <Input id="editor" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="p. ej. ClueBot NG" />
                <Button type="submit">Buscar</Button>
              </div>
            </form>
            <div className="mt-4">
              {!editor ? (
                <Vacio icono={<UserRound className="size-5" aria-hidden />} titulo="Busca un editor" texto="Verás sus eventos por hora y las reversiones que hizo y recibió." />
              ) : historial.cargando ? <Cargando alto={160} /> : hist.filas.length === 0 ? (
                <Vacio titulo="Sin actividad" texto={`No hay filas para «${editor}».`} />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" style={{ borderColor: colorTipo(hist.filas[0].tipo_editor), color: colorTipo(hist.filas[0].tipo_editor) }}>{hist.filas[0].tipo_editor}</Badge>
                    <Badge variant="outline">{entero(hist.filas.reduce((s, f) => s + f.ediciones, 0))} ediciones</Badge>
                    <Badge variant="outline">{hist.filas.reduce((s, f) => s + f.reversiones_hechas, 0)} reversiones hechas</Badge>
                    <Badge variant="outline">{hist.filas.reduce((s, f) => s + f.reversiones_recibidas, 0)} recibidas</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={hist.serie}><XAxis dataKey="t" hide /><Tooltip labelFormatter={(t) => `${horaLocal(String(t))} UTC−5`} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} />
                      <Bar dataKey="eventos" name="eventos" fill={colorTipo(hist.filas[0].tipo_editor)} radius={[3, 3, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                  <Table>
                    <TableHeader><TableRow><TableHead>Hora</TableHead><TableHead>Wiki</TableHead><TableHead className="text-right">Eventos</TableHead></TableRow></TableHeader>
                    <TableBody>{hist.filas.slice(0, 6).map((f) => (
                      <TableRow key={`${f.fecha}-${f.hora}-${f.wiki}`}><TableCell>{horaDeCelda(f.fecha, f.hora)}</TableCell><TableCell>{f.wiki}</TableCell><TableCell className="text-right tabular-nums">{f.eventos}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Seccion>
        </div>
      </Pagina>

      <Dialog open={horaVista != null} onOpenChange={(a) => !a && setHoraMin(null)}>
        <DialogContent className="sm:max-w-[880px]">
          <DialogHeader>
            <DialogTitle>Eventos por minuto · {horaVista != null ? `${etiquetaHora(horaVista)}–${etiquetaHora((horaVista + 1) % 24)}` : ""} (UTC−5)</DialogTitle>
            <DialogDescription>Los 60 minutos de la hora, con humanos y bots apilados ({etiqueta} · Cassandra eventos_por_minuto). Los picos suelen ser bots en ráfaga o una noticia.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end"><Leyenda items={[{ nombre: "Humanos", color: COLOR.humano }, { nombre: "Bots", color: COLOR.bot }]} /></div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ejeHora.datos} margin={{ left: 0, right: 16, top: 8 }} barCategoryGap="15%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="ms" type="number" scale="time" domain={ejeHora.dominio} ticks={ejeHora.ticks} tickFormatter={horaMs} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip cursor={{ fill: "var(--muted)" }} labelFormatter={(t) => `${horaMs(t)} UTC−5`} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Bar dataKey="humanos" name="Humanos" stackId="a" fill={COLOR.humano} isAnimationActive={false} />
                <Bar dataKey="eventos_bot" name="Bots" stackId="a" fill={COLOR.bot} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
        </DialogContent>
      </Dialog>
      {metrica && data && (
        <ModalMetrica m={metricaDia(metrica, data, etiqueta)} {...vecinos(ORDEN_DIA, metrica, (k) => NOMBRE_DIA[k], setMetrica)} onCerrar={() => setMetrica(null)} />
      )}
    </>
  )
}
