import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { UserRound } from "lucide-react"

import { Cargando, FilaBarra, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, colorWiki, entero, horaUTC } from "@/lib/format"

interface Actividad {
  fecha: string
  fechas: string[]
  minutos: { t: string; eventos: number; eventos_bot: number; reversiones: number }[]
  horas: { hora: number; eventos: number; eventos_bot: number; eventos_humanos: number; reversiones: number }[]
  top: { hora: number; posicion: number; wiki: string; pagina: string; ediciones: number; editores: number; delta_bytes: number }[]
}
interface FilaEditor { fecha: string; hora: number; wiki: string; tipo_editor: string; eventos: number; ediciones: number; reversiones_hechas: number; reversiones_recibidas: number }

export default function ActividadPage() {
  const { wiki, etiqueta } = useWiki()
  const [fecha, setFecha] = useState<string | null>(null)
  const [hora, setHora] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [editor, setEditor] = useState<string | null>(null)
  const { data } = useApi<Actividad>(`/api/actividad?wiki=${wiki}${fecha ? `&fecha=${fecha}` : ""}`)
  useEffect(() => setHora(null), [wiki, fecha])
  const historial = useApi<FilaEditor[]>(editor ? `/api/editor/${encodeURIComponent(editor)}` : null)

  const tot = useMemo(() => {
    if (!data?.minutos.length) return null
    const ev = data.minutos.reduce((s, m) => s + m.eventos, 0)
    const bots = data.minutos.reduce((s, m) => s + m.eventos_bot, 0)
    const pico = data.minutos.reduce((a, b) => (b.eventos > a.eventos ? b : a))
    return { ev, bots, rev: data.minutos.reduce((s, m) => s + m.reversiones, 0), min: data.minutos.length, pico }
  }, [data])

  const horas = useMemo(() => (data?.horas ?? []).slice().sort((a, b) => a.hora - b.hora).map((h) => ({ ...h, etiqueta: `${String(h.hora).padStart(2, "0")}:00` })), [data])
  const horasTop = useMemo(() => [...new Set((data?.top ?? []).map((t) => t.hora))].sort((a, b) => b - a), [data])
  const horaSel = hora ?? horasTop[0] ?? null
  const top = (data?.top ?? []).filter((t) => t.hora === horaSel).sort((a, b) => a.posicion - b.posicion).slice(0, 10)

  const hist = useMemo(() => {
    const filas = historial.data ?? []
    const porHora = new Map<string, number>()
    for (const f of filas) {
      const k = `${f.fecha}T${String(f.hora).padStart(2, "0")}:00:00Z`
      porHora.set(k, (porHora.get(k) ?? 0) + f.eventos)
    }
    return { filas, serie: [...porHora.entries()].sort().map(([t, eventos]) => ({ t, eventos })) }
  }, [historial.data])

  const buscar = (e: FormEvent) => {
    e.preventDefault()
    if (busqueda.trim()) setEditor(busqueda.trim())
  }

  return (
    <>
      <Header ruta={["Panel", "Actividad en el tiempo"]} />
      <Pagina titulo="Actividad en el tiempo" descripcion={`Pulso de ${etiqueta} el ${data?.fecha ?? "…"} (UTC). Cada vista lee una tabla de Cassandra diseñada para esa consulta.`}
        acciones={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Día (UTC)</span>
            <Select value={data?.fecha ?? ""} onValueChange={setFecha}>
              <SelectTrigger className="w-40" aria-label="Día (UTC)"><SelectValue placeholder="Fecha" /></SelectTrigger>
              <SelectContent>{(data?.fechas ?? []).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!tot ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : (
            <>
              <TarjetaKpi etiqueta="Eventos del día" valor={entero(tot.ev)} pie={`${horas.length} horas procesadas`} fuente="eventos_por_minuto" />
              <TarjetaKpi etiqueta="Promedio por minuto" valor={entero(tot.ev / tot.min)} pie={`pico de ${entero(tot.pico.eventos)} a las ${horaUTC(tot.pico.t, false)}`} fuente="eventos_por_minuto" />
              <TarjetaKpi etiqueta="Hechos por bots" valor={`${((tot.bots / tot.ev) * 100).toFixed(1)} %`} pie={`${entero(tot.bots)} eventos`} fuente="eventos_por_minuto" />
              <TarjetaKpi etiqueta="Reversiones" valor={entero(tot.rev)} pie="ediciones que revierten a otro" fuente="eventos_por_minuto" />
            </>
          )}
        </div>

        <Seccion titulo="Humanos y bots por hora" descripcion={`Eventos de ${etiqueta} · Cassandra resumen_por_hora`} accion={<Leyenda items={[{ nombre: "Humanos", color: COLOR.registrado }, { nombre: "Bots", color: COLOR.bot }]} />}>
          {!data ? <Cargando alto={260} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={horas} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} fontSize={11} stroke="#71717a" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="#71717a" tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                <Tooltip cursor={{ fill: "#f4f4f5" }} contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Bar dataKey="eventos_humanos" name="Humanos" stackId="a" fill={COLOR.registrado} />
                <Bar dataKey="eventos_bot" name="Bots" stackId="a" fill={COLOR.bot} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo="Eventos por minuto" descripcion="Cada punto es un minuto; los picos suelen ser bots en ráfaga o una noticia">
          {!data ? <Cargando alto={200} /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.minutos} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="t" tickFormatter={(t) => horaUTC(t, false)} tickLine={false} axisLine={false} minTickGap={50} fontSize={11} stroke="#71717a" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} stroke="#71717a" />
                <Tooltip labelFormatter={(t) => `${horaUTC(String(t), false)} UTC`} contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number, n: string) => [entero(v), n]} />
                <Line type="monotone" dataKey="eventos" name="eventos" stroke={colorWiki(wiki)} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="eventos_bot" name="de bots" stroke={COLOR.bot} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Seccion className="lg:col-span-3" titulo="Páginas más editadas" descripcion="Por editores distintos · Cassandra paginas_top_por_hora"
            accion={
              <Select value={horaSel != null ? String(horaSel) : ""} onValueChange={(v) => setHora(Number(v))}>
                <SelectTrigger size="sm" className="w-28" aria-label="Hora (UTC)"><SelectValue placeholder="Hora" /></SelectTrigger>
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
                <Vacio icono={<UserRound className="size-5" aria-hidden />} titulo="Busca un editor" texto="Verás sus ediciones por hora y las reversiones que hizo y recibió." />
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
                    <BarChart data={hist.serie}><XAxis dataKey="t" hide /><Tooltip labelFormatter={(t) => `${horaUTC(String(t))} UTC`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="eventos" name="eventos" fill={colorTipo(hist.filas[0].tipo_editor)} radius={[3, 3, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                  <Table>
                    <TableHeader><TableRow><TableHead>Hora</TableHead><TableHead>Wiki</TableHead><TableHead className="text-right">Eventos</TableHead></TableRow></TableHeader>
                    <TableBody>{hist.filas.slice(0, 6).map((f) => (
                      <TableRow key={`${f.fecha}-${f.hora}-${f.wiki}`}><TableCell>{f.fecha} {String(f.hora).padStart(2, "0")}:00</TableCell><TableCell>{f.wiki}</TableCell><TableCell className="text-right tabular-nums">{f.eventos}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Seccion>
        </div>
      </Pagina>
    </>
  )
}
