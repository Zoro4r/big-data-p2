import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { resaltar } from "@/components/crear-evento"
import { Vacio } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { NOMBRE_TIPO, tipoEvento } from "@/lib/eventos"
import { horaLocal } from "@/lib/format"

/** Eliminar en MongoDB, con dos resguardos: escribir el _id para habilitar el botón y confirmar en un diálogo.
 *  Borrar no se puede deshacer. */

type Doc = Record<string, unknown>
const ACCION_LOG: Record<string, string> = { block: "Bloqueo", thanks: "Agradecimiento", move: "Traslado", upload: "Subida de archivo" }
const nombreTipo = (d: Doc) => (d.type === "log" ? ACCION_LOG[String(d.log_type)] ?? "Registro"
  : NOMBRE_TIPO[tipoEvento({ tipo: String(d.type), revierte_a: (d.derived as Doc | undefined)?.revert_target ? "x" : null })])

export function useEliminacion() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [confirmacion, setConfirmacion] = useState("")
  /** Último documento borrado, solo para mostrar el resultado. */
  const [eliminado, setEliminado] = useState<Doc | null>(null)
  const [cargando, setCargando] = useState(false)

  async function cargar(id: string) {
    if (!id.trim()) return
    setCargando(true)
    try {
      setDoc(await api<Doc>(`/api/crud/mongo/${encodeURIComponent(id.trim())}`))
      setEliminado(null)
      setConfirmacion("")
    } catch (e) {
      setDoc(null)
      toast.error((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  async function eliminar() {
    if (!doc) throw new Error("Carga un documento primero")
    const r = await api<{ eliminados: number }>(`/api/crud/mongo/${encodeURIComponent(String(doc._id))}`, { method: "DELETE" })
    if (!r.eliminados) throw new Error("El documento ya no existía")
    setEliminado(doc)
    setDoc(null)
    setConfirmacion("")
    return doc
  }

  const confirmado = Boolean(doc) && confirmacion.trim() === String(doc?._id)
  return { doc, eliminado, cargando, cargar, eliminar, confirmacion, setConfirmacion, confirmado }
}
export type Eliminacion = ReturnType<typeof useEliminacion>

function Ficha({ d }: { d: Doc }) {
  const der = (d.derived ?? {}) as Doc
  const fecha = typeof der.event_time === "string" ? `${horaLocal(der.event_time)} UTC−5` : null
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-left">
      <span className="truncate text-sm font-semibold text-foreground">{String(d.title ?? "—")}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span className="rounded border bg-background px-1.5 font-mono text-[10.5px] font-medium text-foreground/80">{String(d.wiki ?? "").slice(0, 2).toUpperCase()}</span>
        {nombreTipo(d)}<span className="text-muted-foreground/60">·</span>{String(d.user ?? "—")}
        {fecha && <><span className="text-muted-foreground/60">·</span>{fecha}</>}
      </span>
    </div>
  )
}

export function FormularioEliminacion({ e, id, setId }: { e: Eliminacion; id: string; setId: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="e-id">Documento a eliminar</Label>
        <div className="flex gap-2">
          <Input id="e-id" className="font-mono text-xs" placeholder="_id" value={id} onChange={(ev) => setId(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); e.cargar(id) } }} />
          <Button type="button" variant="outline" disabled={e.cargando} onClick={() => e.cargar(id)}>Cargar</Button>
        </div>
        <span className="text-xs text-muted-foreground">Pega un _id o llega desde Consultar con «Eliminar».</span>
      </div>
      {e.doc && (
        <>
          <Ficha d={e.doc} />
          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label htmlFor="e-confirmar">Para confirmar, escribe el _id</Label>
            <Input id="e-confirmar" className="font-mono text-xs" placeholder={String(e.doc._id)} autoComplete="off" spellCheck={false}
              value={e.confirmacion} onChange={(ev) => e.setConfirmacion(ev.target.value)} />
            <span className="text-xs text-muted-foreground">El botón se activa cuando el texto coincide.</span>
          </div>
        </>
      )}
    </div>
  )
}

/** Confirmación final en un diálogo. */
export function ConfirmarEliminacion({ e, abierto, onCerrar, onConfirmar, ocupado }: {
  e: Eliminacion; abierto: boolean; onCerrar: () => void; onConfirmar: () => void; ocupado: boolean
}) {
  if (!e.doc) return null
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>¿Eliminar «{String(e.doc.title ?? e.doc._id)}»?</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Se borrará el documento <span className="font-mono text-xs text-foreground/80">{String(e.doc._id)}</span> de la colección events.
            No se puede deshacer. Cassandra y Neo4j no cambian.
          </DialogDescription>
        </DialogHeader>
        <Ficha d={e.doc} />
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={ocupado} onClick={onConfirmar}><Trash2 aria-hidden />Eliminar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Json({ d }: { d: Doc }) {
  const json = JSON.stringify(d, null, 2)
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="border-b px-4 py-2.5 text-[13px] font-medium">Documento que se eliminará</div>
      <div className="flex max-h-[460px] overflow-auto font-mono text-[12.5px] leading-5">
        <div aria-hidden className="sticky left-0 w-10 shrink-0 bg-card py-3 pr-3 text-right text-muted-foreground/50 select-none">
          {json.split("\n").map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <pre className="m-0 py-3 pr-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: resaltar(json) }} />
      </div>
    </div>
  )
}

const EFECTOS: [string, string][] = [
  ["MongoDB", "Se borra el documento de la colección events con delete_one. No se puede deshacer."],
  ["Cassandra", "No cambia: los conteos y KPIs de horas ya cerradas se calcularon antes."],
  ["Neo4j", "No cambia: el grafo se arma en cada corrida del DAG; el próximo lote ya no lo verá."],
]

export function PanelEliminacion({ e }: { e: Eliminacion }) {
  if (!e.doc && e.eliminado) {
    return (
      <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
        <span className="text-sm font-semibold">Documento eliminado</span>
        <span className="text-[12.5px] text-muted-foreground">delete_one · deleted_count: 1 · «{String(e.eliminado.title ?? e.eliminado._id)}» ({String(e.eliminado._id)})</span>
      </div>
    )
  }
  if (!e.doc) return <Vacio titulo="Carga un documento" texto="Escribe su _id a la izquierda y presiona Cargar; aquí verás el documento antes de eliminarlo." />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
        <span className="text-sm font-semibold">Qué pasa al eliminarlo</span>
        {EFECTOS.map(([b, t]) => (
          <div key={b} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-[13px]">
            <span className="font-medium">{b}</span><span className="text-muted-foreground">{t}</span>
          </div>
        ))}
      </div>
      <Json d={e.doc} />
    </div>
  )
}
