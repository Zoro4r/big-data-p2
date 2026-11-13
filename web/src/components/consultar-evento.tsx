import { useEffect, useRef, useState } from "react"
import { Copy, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { NOMBRE_WIKI, resaltar, Segmentado, type WikiCrud } from "@/components/crear-evento"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Vacio } from "@/components/common"
import { api } from "@/lib/api"
import { NOMBRE_TIPO, nombreEspacio, tipoEvento } from "@/lib/eventos"
import { bytes, entero, horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Consultar en MongoDB: filtros a la izquierda (con las coincidencias debajo de "Buscar")
 *  y, a la derecha, la ficha y el JSON del documento elegido. */

interface Coincidencia { _id: string; fecha: string | null; wiki: string; tipo: string; titulo: string; editor: string; log_type?: string | null; revierte_a?: string | null }
interface Respuesta { documentos: Coincidencia[]; hay_mas: boolean; consulta: string; ms: number }
type Doc = Record<string, unknown>

const LIMITE = 10
const ACCION_LOG: Record<string, string> = { block: "Bloqueo", thanks: "Agradecimiento", move: "Traslado", upload: "Subida de archivo", delete: "Borrado" }
const nombreTipo = (c: { tipo: string; log_type?: unknown; revierte_a?: unknown }) =>
  c.tipo === "log" ? ACCION_LOG[String(c.log_type)] ?? "Registro" : NOMBRE_TIPO[tipoEvento({ tipo: c.tipo, revierte_a: c.revierte_a ? String(c.revierte_a) : null })]
/** Mongo devuelve las fechas sin zona; son UTC. */
const iso = (f: unknown) => (typeof f === "string" ? (/[zZ]|[+-]\d\d:\d\d$/.test(f) ? f : `${f}Z`) : null)

function hace(f: string | null) {
  if (!f) return "—"
  const s = Math.max(0, (Date.now() - new Date(f).getTime()) / 1000)
  if (s < 60) return `hace ${Math.round(s)} s`
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return horaLocal(f)
}

export function useConsultaEventos(wikiCabecera: WikiCrud) {
  const [f, setF] = useState({ wiki: wikiCabecera, tipo: "todos", periodo: "todo", editor: "", titulo: "", demo: false, id: "" })
  const [res, setRes] = useState<Respuesta | null>(null)
  const [elegido, setElegido] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [cargando, setCargando] = useState(false)
  useEffect(() => setF((x) => ({ ...x, wiki: wikiCabecera })), [wikiCabecera])

  /** antes: fecha del último documento mostrado, para pedir los siguientes sin repetir (el stream sigue insertando). */
  const pedir = (antes?: string | null) => api<Respuesta>(`/api/crud/mongo/buscar?${new URLSearchParams({
    wiki: f.wiki, tipo: f.tipo, periodo: f.periodo, editor: f.editor, titulo: f.titulo, demo: String(f.demo), id: f.id,
    limite: String(LIMITE), ...(antes ? { antes } : {}),
  })}`)

  async function buscar() {
    setCargando(true)
    try {
      const r = await pedir()
      setRes(r)
      elegir(r.documentos[0]?._id ?? null)
      return r
    } catch (e) {
      toast.error((e as Error).message)
      return null
    } finally {
      setCargando(false)
    }
  }

  async function verMas() {
    if (!res) return
    const r = await pedir(res.documentos.at(-1)?.fecha)
    const vistos = new Set(res.documentos.map((d) => d._id))
    setRes({ ...r, consulta: res.consulta, documentos: [...res.documentos, ...r.documentos.filter((d) => !vistos.has(d._id))] })
  }

  const ultimo = useRef<string | null>(null)
  function elegir(id: string | null) {
    setElegido(id)
    ultimo.current = id
    if (!id) { setDoc(null); return }
    api<Doc>(`/api/crud/mongo/${encodeURIComponent(id)}`)
      .then((d) => { if (ultimo.current === id) setDoc(d) })
      .catch((e) => { toast.error((e as Error).message); setDoc(null) })
  }

  const limpiar = () => { setRes(null); elegir(null) }

  return { f, setF, res, elegido, doc, cargando, buscar, verMas, elegir, limpiar }
}
export type ConsultaEventos = ReturnType<typeof useConsultaEventos>

// ---------------------------------------------------------------- columna izquierda

function Campo({ id, label, ayuda, children }: { id: string; label: string; ayuda?: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={id}>{label}</Label>{children}{ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>}</div>
}

function Desplegable({ id, valor, opciones, onChange }: { id: string; valor: string; opciones: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{opciones.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
    </Select>
  )
}

/** Wiki y filtros. El botón Buscar lo pone la página, debajo van las coincidencias. */
export function FiltrosConsulta({ c }: { c: ConsultaEventos }) {
  const { f, setF } = c
  const conId = f.id.trim() !== ""
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded border bg-background px-1.5 py-px font-mono text-[11px] font-medium">{f.wiki.slice(0, 2).toUpperCase()}</span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-medium">Buscar en {f.wiki} · {NOMBRE_WIKI[f.wiki]}</span>
            <span className="text-xs text-muted-foreground">Por defecto, la wiki elegida en el encabezado</span>
          </div>
        </div>
        <Segmentado etiqueta="Wiki donde buscar" valor={f.wiki} onChange={(w) => setF({ ...f, wiki: w })} opciones={[["enwiki", "enwiki"], ["eswiki", "eswiki"]]} />
      </div>

      <fieldset disabled={conId} className="flex flex-col gap-3 disabled:opacity-50">
        <Campo id="q-tipo" label="Tipo de evento">
          <Segmentado etiqueta="Tipo de evento" valor={f.tipo} onChange={(v) => setF({ ...f, tipo: v })}
            opciones={[["todos", "Todos"], ["edit", "Edición"], ["new", "Página nueva"], ["categorize", "Categorización"], ["log", "Otros"]]} />
        </Campo>
        <Campo id="q-periodo" label="Periodo">
          <Desplegable id="q-periodo" valor={f.periodo} onChange={(v) => setF({ ...f, periodo: v })}
            opciones={[["hora", "Última hora"], ["dia", "Últimas 24 horas"], ["semana", "Últimos 7 días"], ["todo", "Todo"]]} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo id="q-editor" label="Editor"><Input id="q-editor" placeholder="cualquiera" value={f.editor} onChange={(e) => setF({ ...f, editor: e.target.value })} /></Campo>
          <Campo id="q-titulo" label="Título contiene"><Input id="q-titulo" placeholder="cualquiera" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Campo>
        </div>
      </fieldset>

      <Campo id="q-id" label="_id exacto" ayuda="Si lo llenas, se ignoran los demás filtros.">
        <Input id="q-id" className="font-mono text-xs" placeholder="opcional" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} />
      </Campo>
    </div>
  )
}

/** Lista de coincidencias, solo cuando hay más de una. */
export function Coincidencias({ c }: { c: ConsultaEventos }) {
  const docs = c.res?.documentos ?? []
  // Sin resultados o con uno solo no hay lista: la columna derecha ya lo muestra.
  if (!c.res || docs.length === 0 || (docs.length === 1 && !c.res.hay_mas)) return null
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{docs.length}{c.res.hay_mas ? "+" : ""} coincidencias</span>
        <span className="text-xs text-muted-foreground">elige una para verla</span>
      </div>
      <div className="-mx-1 flex max-h-[300px] flex-col gap-2 overflow-y-auto px-1 py-1">
      {docs.map((d) => (
        <button key={d._id} type="button" onClick={() => c.elegir(d._id)} aria-pressed={c.elegido === d._id}
          className={cn("flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            c.elegido === d._id && "border-foreground ring-[3px] ring-muted")}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-medium">{d.titulo}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{d._id}</span>
          </span>
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{nombreTipo(d)} · {hace(d.fecha)}</span>
        </button>
      ))}
      </div>
      {c.res.hay_mas && (
        <Button type="button" variant="ghost" size="sm" onClick={c.verMas} className="self-center text-[13px]">Ver {LIMITE} más</Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- columna derecha

/** Ficha legible y JSON completo del documento elegido. */
export function FichaDocumento({ c, onActualizar, onEliminar }: { c: ConsultaEventos; onActualizar: (id: string) => void; onEliminar: (id: string) => void }) {
  const d = c.doc
  const docs = c.res?.documentos ?? []
  if (!c.res) return <Vacio titulo="Realiza una consulta" texto="Elige los filtros de la izquierda y presiona Buscar; el documento aparecerá aquí." />
  if (!docs.length) return <Vacio titulo="Sin coincidencias" texto="Prueba con otro periodo, otra wiki u otro editor." />
  if (!d) return <Vacio titulo="Cargando documento…" texto=" " />

  const der = (d.derived ?? {}) as Doc
  const largo = (d.length ?? {}) as Doc
  const id = String(d._id)
  const pos = docs.findIndex((x) => x._id === id)
  const delta = typeof der.delta_bytes === "number" ? der.delta_bytes : null
  const fecha = iso(der.event_dt) ?? iso(der.event_time)
  const json = JSON.stringify(d, null, 2)
  const lineas = json.split("\n").length
  const datos: [string, React.ReactNode][] = [
    ["Fecha", fecha ? `${horaLocal(fecha)} UTC−5` : "—"],
    ...(delta != null ? [["Cambio", <span key="c" className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{bytes(delta)}</span>] as [string, React.ReactNode]] : []),
    ...(typeof largo.new === "number" ? [["Tamaño", typeof largo.old === "number" ? `${entero(largo.old)} → ${entero(largo.new)} B` : `${entero(largo.new)} B`] as [string, React.ReactNode]] : []),
    ["Espacio", `${nombreEspacio(typeof d.namespace === "number" ? d.namespace : null)}${typeof d.namespace === "number" ? ` (${d.namespace})` : ""}`],
  ]
  const accion = "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:bg-accent"

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <span className="size-2 rounded-full bg-green-600" aria-hidden />
            {docs.length > 1 || c.res.hay_mas ? `Coincidencia ${pos + 1} de ${docs.length}${c.res.hay_mas ? "+" : ""}` : "Encontrado"}
          </span>
          <code className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={c.res.consulta}>{c.res.consulta}</code>
        </div>
        <div className="grid gap-6 p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xl font-semibold tracking-tight break-words">{String(d.title ?? "—")}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="rounded border px-1.5 font-mono text-[10.5px] font-medium text-foreground/80">{String(d.wiki ?? "").slice(0, 2).toUpperCase()}</span>
              {nombreTipo({ tipo: String(d.type), log_type: d.log_type, revierte_a: der.revert_target })}
              <span className="text-muted-foreground/60">·</span>{String(d.user ?? "—")}
              {der.user_type != null && <><span className="text-muted-foreground/60">·</span>{String(der.user_type)}</>}
            </span>
            {typeof d.comment === "string" && d.comment && <span className="mt-1.5 text-[13px] break-words text-foreground/80">«{d.comment}»</span>}
          </div>
          <dl className="flex flex-col gap-1.5 text-[12.5px]">
            {datos.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>)}
          </dl>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-[13px] font-medium">Documento completo</span>
          <span className="flex gap-1.5">
            <button type="button" className={accion} onClick={() => { navigator.clipboard.writeText(json); toast("JSON copiado") }}><Copy className="size-3.5" aria-hidden />Copiar</button>
            <button type="button" className={accion} onClick={() => onActualizar(id)}><Pencil className="size-3.5" aria-hidden />Actualizar este</button>
            <button type="button" className={cn(accion, "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40")} onClick={() => onEliminar(id)}>
              <Trash2 className="size-3.5" aria-hidden />Eliminar
            </button>
          </span>
        </div>
        <div className="flex max-h-[460px] overflow-auto font-mono text-[12.5px] leading-5">
          <div aria-hidden className="sticky left-0 w-10 shrink-0 bg-card py-3 pr-3 text-right text-muted-foreground/50 select-none">
            {Array.from({ length: lineas }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <pre className="m-0 py-3 pr-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: resaltar(json) }} />
        </div>
      </div>
    </div>
  )
}
