import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { UserRound } from "lucide-react"

import { Cargando, FilaBarra, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Base, ModalMetrica, type MetricaModal } from "@/components/modal-metrica"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, colorWiki, entero, horaDeCelda, horaLocal, ejeDia, horaMs } from "@/lib/format"

interface Actividad {
  fecha: string
  fechas: string[]
  minutos: { t: string; eventos: number; eventos_bot: number; reversiones: number }[]
  horas: { hora: number; eventos: number; eventos_bot: number; eventos_humanos: number; reversiones: number }[]
  top: { hora: number; posicion: number; wiki: string; pagina: string; ediciones: number; editores: number; delta_bytes: number }[]
}
type MetricaDia = "dia" | "prom" | "bots" | "rev"
const ORDEN_DIA: MetricaDia[] = ["dia", "prom", "bots", "rev"]
const NOMBRE_DIA: Record<MetricaDia, string> = { dia: "Eventos del día", prom: "Promedio por minuto", bots: "Hechos por bots", rev: "Reversiones" }

/** Anterior y siguiente (circular) para recorrer las tarjetas desde el modal. */
function vecinos<T>(lista: T[], actual: T, nombre: (x: T) => string, ir: (x: T) => void) {
  const i = lista.indexOf(actual), n = lista.length
  const a = lista[(i - 1 + n) % n], s = lista[(i + 1) % n]
  return { anterior: { nombre: nombre(a), ir: () => ir(a) }, siguiente: { nombre: nombre(s), ir: () => ir(s) } }
}

/** Detalle de cada tarjeta del día, a partir de las series por minuto y por hora de Cassandra. */
function metricaDia(k: MetricaDia, d: Actividad, etiqueta: string): MetricaModal {
  const horas = d.horas.slice().sort((a, b) => a.hora - b.hora)
  const ev = d.minutos.reduce((s, m) => s + m.eventos, 0)
  const bots = d.minutos.reduce((s, m) => s + m.eventos_bot, 0)
  const rev = d.minutos.reduce((s, m) => s + m.reversiones, 0)
  const pico = d.minutos.reduce((a, b) => (b.eventos > a.eventos ? b : a), d.minutos[0])
  const max = (c: "eventos" | "reversiones") => horas.reduce((a, b) => (b[c] > a[c] ? b : a), horas[0])
  const min = horas.reduce((a, b) => (b.eventos < a.eventos ? b : a), horas[0])
  const hh = (h?: { hora: number }) => (h ? `${String(h.hora).padStart(2, "0")}:00` : "—")
  const desde = horas.length ? hh(horas[0]) : ""
  const origen = <>Se lee de <Base base="cassandra" /> (tabla eventos_por_minuto, una partición por wiki y día), que llenan la capa de streaming y el DAG.</>
  const comun = { etiqueta, momento: `${d.fecha} · UTC−5`, origen }
  if (k === "dia") return {
    ...comun, titulo: NOMBRE_DIA.dia, valor: entero(ev), nota: `${horas.length} horas con datos`,
    serie: { valores: horas.map((h) => h.eventos), desde },
    datos: [["Hora más activa", `${hh(max("eventos"))} · ${entero(max("eventos")?.eventos)}`], ["Hora más tranquila", `${hh(min)} · ${entero(min?.eventos)}`],
      ["Promedio por hora", horas.length ? entero(ev / horas.length) : "—"]],
    definicion: `Eventos de ${etiqueta} registrados durante el día elegido (UTC−5).`,
    calculo: { texto: "Σ eventos por minuto del día" },
    lectura: "Volumen diario de actividad. Permite comparar días y ver el ciclo de día y noche de cada wiki.",
  }
  if (k === "prom") return {
    ...comun, titulo: NOMBRE_DIA.prom, valor: d.minutos.length ? entero(ev / d.minutos.length) : "—",
    nota: pico ? `pico de ${entero(pico.eventos)} a las ${horaLocal(pico.t, false)}` : undefined,
    serie: { valores: horas.map((h) => h.eventos / 60), desde },
    datos: [["Minutos con datos", entero(d.minutos.length)], ["Minuto más activo", pico ? `${entero(pico.eventos)} · ${horaLocal(pico.t, false)}` : "—"]],
    definicion: "Eventos que llegan en un minuto típico del día.",
    calculo: { fraccion: ["eventos del día", "minutos con datos"] },
    lectura: "Ritmo habitual de la wiki. Un pico muy por encima del promedio suele ser un bot trabajando en ráfaga o una noticia.",
  }
  if (k === "bots") return {
    ...comun, titulo: NOMBRE_DIA.bots, valor: ev ? `${((bots / ev) * 100).toFixed(1)} %` : "—", nota: `${entero(bots)} eventos de bots`,
    serie: { valores: horas.map((h) => (h.eventos ? (h.eventos_bot / h.eventos) * 100 : 0)), desde },
    datos: [["Eventos de bots", entero(bots)], ["Eventos humanos", entero(ev - bots)]],
    definicion: "Porcentaje de los eventos del día hechos por bots.",
    calculo: { fraccion: ["eventos de bots", "total de eventos", "× 100"] },
    lectura: "Cuánto del trabajo diario hacen bots (marca bot=true o «bot» en el nombre). Si sube en ciertas horas, suele ser un bot procesando páginas en lote.",
  }
  return {
    ...comun, titulo: NOMBRE_DIA.rev, valor: entero(rev), nota: "ediciones que revierten a otro editor",
    serie: { valores: horas.map((h) => h.reversiones), desde },
    datos: [["Hora con más", `${hh(max("reversiones"))} · ${entero(max("reversiones")?.reversiones)}`], ["Por cada 100 eventos", ev ? ((rev / ev) * 100).toFixed(2) : "—"]],
    definicion: "Ediciones del día que deshacen el trabajo de otro editor.",
    calculo: { texto: "Σ reversiones por minuto del día" },
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
  useEffect(() => setHora(null), [wiki, fecha])
  // Hora que se ve minuto a minuto: la que se elige en el gráfico por hora; si no, la última con datos.
  const [horaMin, setHoraMin] = useState<number | null>(null)
  useEffect(() => setHoraMin(null), [wiki, fecha])
  const historial = useApi<FilaEditor[]>(editor ? `/api/editor/${encodeURIComponent(editor)}` : null)

  const tot = useMemo(() => {
    if (!data?.minutos.length) return null
    const ev = data.minutos.reduce((s, m) => s + m.eventos, 0)
    const bots = data.minutos.reduce((s, m) => s + m.eventos_bot, 0)
    const pico = data.minutos.reduce((a, b) => (b.eventos > a.eventos ? b : a))
    return { ev, bots, rev: data.minutos.reduce((s, m) => s + m.reversiones, 0), min: data.minutos.length, pico }
  }, [data])

  const horas = useMemo(() => (data?.horas ?? []).slice().sort((a, b) => a.hora - b.hora).map((h) => ({ ...h, etiqueta: `${String(h.hora).padStart(2, "0")}:00` })), [data])
  const horaVista = horaMin ?? horas[horas.length - 1]?.hora ?? null
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
      <Pagina titulo="Actividad en el tiempo" descripcion={`Actividad de ${etiqueta} el ${data?.fecha ?? "…"} (UTC−5). Cada vista lee una tabla de Cassandra diseñada para esa consulta.`}
        acciones={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Día (UTC−5)</span>
            <Select value={data?.fecha ?? ""} onValueChange={setFecha}>
              <SelectTrigger className="w-40" aria-label="Día (UTC−5)"><SelectValue placeholder="Fecha" /></SelectTrigger>
              <SelectContent>{(data?.fechas ?? []).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!tot ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : (
            <>
              <TarjetaKpi etiqueta="Eventos del día" valor={entero(tot.ev)} pie={`${horas.length} horas procesadas`} onAbrir={() => setMetrica("dia")} />
              <TarjetaKpi etiqueta="Promedio por minuto" valor={entero(tot.ev / tot.min)} pie={`pico de ${entero(tot.pico.eventos)} a las ${horaLocal(tot.pico.t, false)}`} onAbrir={() => setMetrica("prom")} />
              <TarjetaKpi etiqueta="Hechos por bots" valor={`${((tot.bots / tot.ev) * 100).toFixed(1)} %`} pie={`${entero(tot.bots)} eventos`} onAbrir={() => setMetrica("bots")} />
              <TarjetaKpi etiqueta="Reversiones" valor={entero(tot.rev)} pie="ediciones que revierten a otro" onAbrir={() => setMetrica("rev")} />
            </>
          )}
        </div>

        <Seccion titulo="Humanos y bots por hora" descripcion={`Eventos de ${etiqueta} · Cassandra resumen_por_hora · haz clic en una hora para verla minuto a minuto`} accion={<Leyenda items={[{ nombre: "Humanos", color: COLOR.registrado }, { nombre: "Bots", color: COLOR.bot }]} />}>
          {!data ? <Cargando alto={260} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={horas} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="22%" className="cursor-pointer"
                onClick={(e) => { const h = horas.find((x) => x.etiqueta === e?.activeLabel); if (h) setHoraMin(h.hora) }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Bar dataKey="eventos_humanos" name="Humanos" stackId="a" fill={COLOR.registrado}>
                  {horas.map((h) => <Cell key={h.etiqueta} fillOpacity={h.hora === horaVista ? 1 : 0.45} />)}
                </Bar>
                <Bar dataKey="eventos_bot" name="Bots" stackId="a" fill={COLOR.bot} radius={[6, 6, 0, 0]}>
                  {horas.map((h) => <Cell key={h.etiqueta} fillOpacity={h.hora === horaVista ? 1 : 0.45} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo={`Eventos por minuto${horaVista != null ? ` · ${etiquetaHora(horaVista)}–${etiquetaHora((horaVista + 1) % 24)}` : ""}`}
          descripcion="Los 60 minutos de la hora elegida arriba, con humanos y bots apilados; los picos suelen ser bots en ráfaga o una noticia" accion={<Leyenda items={[{ nombre: "Humanos", color: COLOR.registrado }, { nombre: "Bots", color: COLOR.bot }]} />}>
          {!data ? <Cargando alto={200} /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ejeHora.datos} margin={{ left: 0, right: 16, top: 8 }} barCategoryGap="15%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="ms" type="number" scale="time" domain={ejeHora.dominio} ticks={ejeHora.ticks} tickFormatter={horaMs} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip labelFormatter={(t) => `${horaMs(t)} UTC−5`} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Bar dataKey="humanos" name="Humanos" stackId="a" fill={COLOR.registrado} isAnimationActive={false} />
                <Bar dataKey="eventos_bot" name="Bots" stackId="a" fill={COLOR.bot} radius={[3, 3, 0, 0]} isAnimationActive={false} />
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
      {metrica && data && (
        <ModalMetrica m={metricaDia(metrica, data, etiqueta)} {...vecinos(ORDEN_DIA, metrica, (k) => NOMBRE_DIA[k], setMetrica)} onCerrar={() => setMetrica(null)} />
      )}
    </>
  )
}
