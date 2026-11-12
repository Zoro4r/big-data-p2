import { useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"

import { LogoBase } from "@/components/fuente"
import { Cargando } from "@/components/common"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useApi } from "@/lib/api"
import { NOMBRE_TIPO, nombreEspacio, tipoEvento, type EventoResumen } from "@/lib/eventos"
import { colorTipo, entero, horaLocal, ZONA } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Documento completo del evento, como está guardado en MongoDB (campos que usa el modal). */
interface Documento {
  _id: string
  type: string
  title: string
  user: string
  wiki: string
  namespace?: number
  minor?: boolean
  comment?: string
  server_url?: string
  title_url?: string
  length?: { old?: number | null; new?: number | null }
  revision?: { old?: number | null; new?: number | null }
  log_type?: string
  log_action?: string
  derived?: { event_dt?: string; user_type?: string; delta_bytes?: number | null; revert_target?: string | null }
  [campo: string]: unknown
}

function fechaExacta(iso: string) {
  return `${horaLocal(iso, true, true)} ${ZONA}`
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  )
}

/** Detalle de un evento de la lista "Últimas ediciones": el cambio a la izquierda y el contexto a la derecha. */
export function DetalleEvento(props: {
  id: string | null
  lista: EventoResumen[]
  mostrarWiki: boolean
  hace: (iso: string) => string
  onCambiar: (id: string | null) => void
}) {
  const { id, lista, mostrarWiki, hace, onCambiar } = props
  const { data: doc, cargando, error } = useApi<Documento>(id ? `/api/eventos/${encodeURIComponent(id)}` : null)
  const [completo, setCompleto] = useState(false)
  if (!id) return null

  const resumen = lista.find((e) => e._id === id)
  const i = lista.findIndex((e) => e._id === id)
  const reciente = i > 0 ? lista[i - 1] : null
  const antiguo = i >= 0 && i < lista.length - 1 ? lista[i + 1] : null
  const listo = doc && doc._id === id

  const tipo = listo ? tipoEvento({ tipo: doc.type, revierte_a: doc.derived?.revert_target }) : resumen ? tipoEvento(resumen) : "otro"
  const delta = listo ? doc.derived?.delta_bytes ?? null : resumen?.delta_bytes ?? null
  const largo = listo ? doc.length : undefined
  const rev = listo ? doc.revision : undefined
  const servidor = listo ? doc.server_url : undefined
  const enlaceDiff = servidor && rev?.new ? (rev.old ? `${servidor}/w/index.php?diff=${rev.new}&oldid=${rev.old}` : `${servidor}/w/index.php?oldid=${rev.new}`) : null
  const fecha = listo ? doc.derived?.event_dt ?? resumen?.fecha : resumen?.fecha
  const tipoEditor = listo ? doc.derived?.user_type : resumen?.tipo_editor
  const vistaPrevia = listo ? { _id: doc._id, type: doc.type, title: doc.title, user: doc.user, length: doc.length, derived: doc.derived } : null

  // Barra de tamaño: parte común en gris; lo agregado (verde) o lo quitado (rojo) en color.
  const antes = largo?.old ?? 0, despues = largo?.new ?? 0, maximo = Math.max(antes, despues, 1)

  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) { onCambiar(null); setCompleto(false) } }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[880px]">
        <div className="flex min-w-0 items-center gap-2.5 border-b px-6 py-4 pr-14">
          {mostrarWiki && resumen && <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[11px] font-medium text-muted-foreground">{resumen.wiki === "eswiki" ? "ES" : "EN"}</span>}
          <DialogTitle className="truncate text-lg" title={resumen?.titulo ?? doc?.title}>{resumen?.titulo ?? doc?.title ?? "Evento"}</DialogTitle>
          <DialogDescription className="shrink-0 text-[13px]">{NOMBRE_TIPO[tipo]}{listo && doc.minor ? " menor" : ""}</DialogDescription>
        </div>

        {error ? (
          <p className="p-6 text-sm text-red-700 dark:text-red-400">No se pudo cargar el evento: {error}</p>
        ) : !listo ? (
          <div className="p-6">{cargando ? <Cargando alto={260} /> : null}</div>
        ) : (
          <div className="grid max-h-[70vh] overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)]">
            {/* Izquierda: el cambio */}
            <div className="flex flex-col gap-[18px] border-b bg-muted/40 p-6 md:border-r md:border-b-0">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{fecha ? `${fechaExacta(fecha)} · ${hace(fecha)}` : ""}</span>
                {delta != null ? (
                  <>
                    <span className={cn("text-[44px] leading-none font-semibold tracking-tighter tabular-nums", delta > 0 ? "text-green-700 dark:text-green-400" : delta < 0 ? "text-red-700 dark:text-red-400" : "")}>
                      {delta > 0 ? "+" : delta < 0 ? "−" : ""}{entero(Math.abs(delta))} B
                    </span>
                    {largo?.new != null && <span className="text-[13px] text-muted-foreground">de {entero(antes)} a {entero(despues)} bytes</span>}
                  </>
                ) : (
                  <>
                    <span className="text-[28px] leading-tight font-semibold tracking-tight">{NOMBRE_TIPO[tipo]}</span>
                    <span className="text-[13px] text-muted-foreground">{doc.log_type ? `${doc.log_type} · ${doc.log_action}` : "Este evento no cambia el tamaño de la página"}</span>
                  </>
                )}
              </div>
              {largo?.new != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
                    <div className="bg-muted-foreground/50" style={{ width: `${(Math.min(antes, despues) / maximo) * 100}%` }} />
                    <div className={despues >= antes ? "bg-green-500" : "bg-red-500"} style={{ width: `${(Math.abs(despues - antes) / maximo) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground">tamaño de la página {despues >= antes ? "después" : "antes"} del cambio</span>
                </div>
              )}
              <dl className="flex flex-col gap-2.5 border-t pt-4 text-[13px]">
                <Dato etiqueta="Editor"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full" style={{ background: colorTipo(tipoEditor) }} />{doc.user}</span></Dato>
                <Dato etiqueta="Tipo de editor">{tipoEditor === "temporal" ? "cuenta temporal" : tipoEditor ?? "—"}</Dato>
                <Dato etiqueta="Wiki">{doc.wiki}</Dato>
                <Dato etiqueta="Espacio de nombres">{nombreEspacio(doc.namespace)}</Dato>
                {doc.derived?.revert_target && <Dato etiqueta="Revierte a">{doc.derived.revert_target}</Dato>}
                {rev?.new != null && <Dato etiqueta="Revisión"><span className="font-mono text-xs">{rev.new}</span></Dato>}
              </dl>
            </div>

            {/* Derecha: el contexto */}
            <div className="flex min-w-0 flex-col gap-[22px] px-7 py-6">
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Comentario del editor</h3>
                <p className="rounded-lg bg-muted px-3.5 py-3 text-sm leading-relaxed">{doc.comment ? `“${doc.comment}”` : <span className="text-muted-foreground">Sin comentario</span>}</p>
              </section>
              {(doc.title_url || enlaceDiff) && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">Ver en Wikipedia</h3>
                  <div className="flex flex-wrap gap-2">
                    {doc.title_url && <a href={doc.title_url} target="_blank" rel="noreferrer" className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors hover:bg-accent">Abrir la página<ExternalLink className="size-3.5" aria-hidden /></a>}
                    {enlaceDiff && <a href={enlaceDiff} target="_blank" rel="noreferrer" className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors hover:bg-accent">{rev?.old ? "Ver el cambio (diff)" : "Ver la revisión"}<ExternalLink className="size-3.5" aria-hidden /></a>}
                  </div>
                </section>
              )}
              <section className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-muted-foreground">Documento en MongoDB</h3>
                  <button type="button" onClick={() => setCompleto((c) => !c)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    {completo ? "Ver resumen" : "Ver completo"}<ChevronDown className={cn("size-3.5 transition-transform", completo && "rotate-180")} aria-hidden />
                  </button>
                </div>
                <pre className={cn("overflow-auto rounded-lg border px-3.5 py-3 font-mono text-xs leading-relaxed text-foreground/80", completo && "max-h-80")}>{JSON.stringify(completo ? doc : vistaPrevia, null, 2)}</pre>
              </section>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t py-3 pr-4 pl-6">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LogoBase base="mongo" className="size-3.5" />Guardado en MongoDB · colección events</span>
          <span className="flex gap-1">
            <button type="button" disabled={!reciente} onClick={() => reciente && onCambiar(reciente._id)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
              <ChevronLeft className="size-3.5" aria-hidden />Más reciente
            </button>
            <button type="button" disabled={!antiguo} onClick={() => antiguo && onCambiar(antiguo._id)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
              Más antiguo<ChevronRight className="size-3.5" aria-hidden />
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
