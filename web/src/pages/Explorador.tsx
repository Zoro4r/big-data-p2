import { useEffect, useMemo, useState, type FormEvent } from "react"
import { FileJson2 } from "lucide-react"

import { Cargando, Seccion, TarjetaKpi, Vacio } from "@/components/common"
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
import { COLOR, colorTipo, entero, horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Evento { _id: string; fecha: string; wiki: string; tipo: string; titulo: string; editor: string; tipo_editor: string; delta_bytes: number | null; revierte_a: string | null; comentario: string | null }
interface Respuesta { corte: string; total: number; tipos: { wiki: string; tipo: string; eventos: number }[]; eventos: Evento[] }

const NOMBRE_TIPO: Record<string, string> = { edit: "Ediciones", new: "Páginas creadas", categorize: "Cambios de categoría", log: "Acciones registradas" }
const PIE_TIPO: Record<string, string> = {
  edit: "Cambios en páginas existentes", new: "Creación de páginas nuevas",
  categorize: "Entradas y salidas de categorías", log: "Bloqueos, traslados y otras acciones",
}
const DEF_TIPO: Record<string, [string, string]> = {
  edit: ["Cambios al contenido de una página que ya existía (type = edit).", "Es el grueso del trabajo diario: correcciones, ampliaciones y mantenimiento."],
  categorize: ["Una página se agregó a una categoría o se quitó de ella (type = categorize).", "Muchas vienen de bots o herramientas que reordenan categorías en lote."],
  log: ["Acciones registradas en el log: bloqueos, traslados, borrados, protecciones, subidas de archivos y cuentas nuevas (type = log).", "Refleja la actividad administrativa y de moderación."],
  new: ["Creación de una página nueva (type = new).", "Mide el crecimiento: cuántas páginas aparecen, incluidas discusiones y páginas internas."],
}
type FilaTipo = { clave: string; tipo: string; enwiki: number; eswiki: number; total: number }

/** Anterior y siguiente (circular) para recorrer las tarjetas desde el modal. */
function vecinos<T>(lista: T[], actual: T, nombre: (x: T) => string, ir: (x: T) => void) {
  const i = lista.indexOf(actual), n = lista.length
  const a = lista[(i - 1 + n) % n], s = lista[(i + 1) % n]
  return { anterior: { nombre: nombre(a), ir: () => ir(a) }, siguiente: { nombre: nombre(s), ir: () => ir(s) } }
}

function metricaTipo(t: FilaTipo, totalDataset: number, wikis: string[], etiqueta: string, corte?: string): MetricaModal {
  const [definicion, lectura] = DEF_TIPO[t.clave] ?? [`Eventos de tipo ${t.clave}.`, "Peso de este tipo de evento en la actividad reciente."]
  const datos: [string, React.ReactNode][] = wikis.map((w) => [w, entero(t[w as "enwiki" | "eswiki"])])
  datos.push(["Total almacenado (todos los tipos)", entero(totalDataset)])
  return {
    titulo: t.tipo, etiqueta, momento: corte ? `Dataset hasta ${horaLocal(corte)} UTC−5` : "Dataset almacenado", valor: entero(t.total),
    nota: totalDataset ? `${((t.total / totalDataset) * 100).toFixed(1)} % del total almacenado` : "Sin eventos almacenados",
    datos, definicion, lectura,
    calculo: { texto: "Se cuentan los documentos de MongoDB por tipo de evento, dentro de las wikis seleccionadas." },
    origen: <>Documentos originales de <Base base="mongo" />, incluidos los eventos recientes que todavía no se consolidan.</>,
  }
}

export default function ExploradorPage() {
  const { wiki, wikis, etiqueta } = useWiki()
  const [form, setForm] = useState({ tipo: "todos", editor: "", titulo: "" })
  const [filtro, setFiltro] = useState(form)
  const [elegido, setElegido] = useState<string | null>(null)
  const [tipoAbierto, setTipoAbierto] = useState<string | null>(null)
  const qs = new URLSearchParams({ wiki, tipo: filtro.tipo, editor: filtro.editor, titulo: filtro.titulo, limite: "60" })
  const { data, cargando } = useApi<Respuesta>(`/api/eventos?${qs}`)
  useEffect(() => setElegido(null), [wiki])
  const doc = useApi<Record<string, unknown>>(elegido ? `/api/eventos/${encodeURIComponent(elegido)}` : null)

  const porTipo = useMemo(() => {
    const m = new Map<string, FilaTipo>(Object.entries(NOMBRE_TIPO).map(([clave, tipo]) => [clave, { clave, tipo, enwiki: 0, eswiki: 0, total: 0 }]))
    for (const t of data?.tipos ?? []) {
      const f = m.get(t.tipo)
      if (!f || !wikis.includes(t.wiki)) continue
      if (t.wiki === "enwiki" || t.wiki === "eswiki") f[t.wiki] += t.eventos
      f.total += t.eventos
      m.set(t.tipo, f)
    }
    return [...m.values()]
  }, [data, wikis])
  const totalDataset = data?.total ?? 0

  const aplicar = (e: FormEvent) => {
    e.preventDefault()
    setFiltro(form)
    setElegido(null)
  }

  return (
    <>
      <Header ruta={["Panel", "Explorador de eventos"]} />
      <Pagina titulo="Explorador de eventos" descripcion="Busca cambios de Wikipedia guardados y abre un evento para ver su documento completo.">
        <div className="space-y-1"><h2 className="text-base font-semibold">Dataset almacenado</h2><p className="text-sm text-muted-foreground">{data ? `${entero(data.total)} eventos de ${etiqueta}. Incluye los recientes pendientes de consolidar.` : "Cargando el dataset…"}</p></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={160} />) : porTipo.map((t) => (
            <TarjetaKpi key={t.tipo} etiqueta={t.tipo} valor={entero(t.total)} pie={<><span className="block">{totalDataset ? `${((t.total / totalDataset) * 100).toFixed(1)} % del total almacenado` : "Sin eventos almacenados"}</span><span className="block">{PIE_TIPO[t.clave]}</span></>} onAbrir={() => setTipoAbierto(t.clave)} />
          ))}
        </div>


        <Seccion titulo="Buscar eventos" descripcion="Filtra por tipo, editor o título. Los más recientes aparecen primero.">
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
          </form>
        </Seccion>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Seccion className="xl:col-span-3" titulo="Resultados" descripcion={data ? `${data.eventos.length} eventos · haz clic en una fila para ver el documento` : ""}>
            {cargando || !data ? <Cargando alto={360} /> : data.eventos.length === 0 ? <Vacio titulo="Sin resultados" texto="Ningún evento coincide con los filtros." /> : (
              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow><TableHead>Fecha (UTC−5)</TableHead><TableHead>Tipo</TableHead><TableHead>Título</TableHead><TableHead>Editor</TableHead><TableHead className="text-right">Δ bytes</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eventos.map((ev) => (
                      <TableRow key={ev._id} onClick={() => setElegido(ev._id)} className={cn("cursor-pointer", elegido === ev._id && "bg-muted")}>
                        <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{horaLocal(ev.fecha)}</TableCell>
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
      {tipoAbierto && porTipo.some((t) => t.clave === tipoAbierto) && (() => {
        const fila = porTipo.find((t) => t.clave === tipoAbierto)!
        return <ModalMetrica m={metricaTipo(fila, totalDataset, wikis, etiqueta, data?.corte)}
          {...vecinos(porTipo, fila, (t) => t.tipo, (t) => setTipoAbierto(t.clave))} onCerrar={() => setTipoAbierto(null)} />
      })()}
    </>
  )
}
