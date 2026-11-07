import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { FileJson2 } from "lucide-react"

import { Cargando, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, entero, horaUTC } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Evento { _id: string; fecha: string; wiki: string; tipo: string; titulo: string; editor: string; tipo_editor: string; delta_bytes: number | null; revierte_a: string | null; comentario: string | null }
interface Respuesta { total: number; tipos: { wiki: string; tipo: string; eventos: number }[]; eventos: Evento[] }

const NOMBRE_TIPO: Record<string, string> = { edit: "Ediciones", categorize: "Categorizaciones", log: "Acciones de registro", new: "Páginas nuevas" }

export default function ExploradorPage() {
  const { wiki, wikis, etiqueta } = useWiki()
  const [form, setForm] = useState({ tipo: "todos", editor: "", titulo: "", solo: false })
  const [filtro, setFiltro] = useState(form)
  const [elegido, setElegido] = useState<string | null>(null)
  const qs = new URLSearchParams({ wiki, tipo: filtro.tipo, editor: filtro.editor, titulo: filtro.titulo, solo_reversiones: String(filtro.solo), limite: "60" })
  const { data, cargando } = useApi<Respuesta>(`/api/eventos?${qs}`)
  useEffect(() => setElegido(null), [wiki])
  const doc = useApi<Record<string, unknown>>(elegido ? `/api/eventos/${encodeURIComponent(elegido)}` : null)

  const porTipo = useMemo(() => {
    const m = new Map<string, { tipo: string; enwiki: number; eswiki: number; total: number }>()
    for (const t of data?.tipos ?? []) {
      const f = m.get(t.tipo) ?? { tipo: NOMBRE_TIPO[t.tipo] ?? t.tipo, enwiki: 0, eswiki: 0, total: 0 }
      if (!wikis.includes(t.wiki)) continue
      if (t.wiki === "enwiki" || t.wiki === "eswiki") f[t.wiki] += t.eventos
      f.total += t.eventos
      m.set(t.tipo, f)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [data, wikis])
  const total24 = porTipo.reduce((s, t) => s + t.total, 0)

  const aplicar = (e: FormEvent) => {
    e.preventDefault()
    setFiltro(form)
    setElegido(null)
  }

  return (
    <>
      <Header ruta={["Panel", "Explorador de eventos"]} />
      <Pagina titulo="Explorador de eventos" descripcion={`Cada cambio de Wikipedia se guarda completo en MongoDB como documento JSON, con sus campos originales y los campos derivados que agrega la limpieza.${data ? ` La colección events tiene ${entero(data.total)} documentos.` : ""}`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : porTipo.map((t) => (
            <TarjetaKpi key={t.tipo} etiqueta={t.tipo} valor={entero(t.total)} pie={`${((t.total / Math.max(total24, 1)) * 100).toFixed(1)} % de las últimas 24 h`} ruta={["mongo"]} />
          ))}
        </div>

        <Seccion titulo="Eventos por tipo y wiki" descripcion={`Últimas 24 horas · ${etiqueta} · agregación $group en MongoDB`} accion={<Leyenda items={wikis.map((w) => ({ nombre: w, color: COLOR[w as "enwiki"] }))} />}>
          {!data ? <Cargando alto={240} /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={porTipo} margin={{ top: 20, left: 0, right: 8 }} barGap={4}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="tipo" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                {wikis.includes("enwiki") && <Bar dataKey="enwiki" fill={COLOR.enwiki} radius={[5, 5, 0, 0]}><LabelList dataKey="enwiki" position="top" fontSize={11} formatter={(v: number) => entero(v)} /></Bar>}
                {wikis.includes("eswiki") && <Bar dataKey="eswiki" fill={COLOR.eswiki} radius={[5, 5, 0, 0]}><LabelList dataKey="eswiki" position="top" fontSize={11} formatter={(v: number) => entero(v)} /></Bar>}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo="Buscar eventos" descripcion="find() con filtros, ordenado por fecha descendente (índice por_wiki_tipo_fecha)">
          <form onSubmit={aplicar} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger className="w-full" aria-label="Tipo"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="todos">Todos</SelectItem>{Object.entries(NOMBRE_TIPO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-editor">Editor (exacto)</Label>
              <Input id="f-editor" value={form.editor} onChange={(e) => setForm({ ...form, editor: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-titulo">Título contiene</Label>
              <Input id="f-titulo" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
            </div>
            <Button type="submit">Buscar</Button>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-zinc-900" checked={form.solo} onChange={(e) => setForm({ ...form, solo: e.target.checked })} />
              Solo ediciones que revierten a otro editor
            </label>
          </form>
        </Seccion>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Seccion className="xl:col-span-3" titulo="Resultados" descripcion={data ? `${data.eventos.length} eventos · haz clic en una fila para ver el documento` : ""}>
            {cargando || !data ? <Cargando alto={360} /> : data.eventos.length === 0 ? <Vacio titulo="Sin resultados" texto="Ningún evento coincide con los filtros." /> : (
              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow><TableHead>Fecha (UTC)</TableHead><TableHead>Tipo</TableHead><TableHead>Título</TableHead><TableHead>Editor</TableHead><TableHead className="text-right">Δ bytes</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eventos.map((ev) => (
                      <TableRow key={ev._id} onClick={() => setElegido(ev._id)} className={cn("cursor-pointer", elegido === ev._id && "bg-muted")}>
                        <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{horaUTC(ev.fecha)}</TableCell>
                        <TableCell><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLOR[ev.wiki as "enwiki"] ?? COLOR.otro }} />{ev.tipo}</span></TableCell>
                        <TableCell className="max-w-64 truncate" title={ev.titulo}>
                          <button type="button" className="truncate text-left hover:underline" onClick={() => setElegido(ev._id)}>{ev.titulo}</button>
                          {ev.revierte_a && <Badge variant="outline" className="ml-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">revierte a {ev.revierte_a}</Badge>}
                        </TableCell>
                        <TableCell className="max-w-40 truncate"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: colorTipo(ev.tipo_editor) }} />{ev.editor}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", (ev.delta_bytes ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-foreground/80")}>{ev.delta_bytes == null ? "—" : `${ev.delta_bytes > 0 ? "+" : ""}${entero(ev.delta_bytes)}`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Seccion>

          <Seccion className="xl:col-span-2" titulo="Documento completo" descripcion="Así se guarda en MongoDB: campos originales + derived">
            {!elegido ? <Vacio icono={<FileJson2 className="size-5" aria-hidden />} titulo="Elige un evento" texto="El documento JSON aparece aquí." /> : doc.cargando || !doc.data ? <Cargando alto={360} /> : (
              <pre className="max-h-[520px] overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground/90">{JSON.stringify(doc.data, null, 2)}</pre>
            )}
          </Seccion>
        </div>
      </Pagina>
    </>
  )
}
