import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Undo2 } from "lucide-react"
import { toast } from "sonner"

import { resaltar } from "@/components/crear-evento"
import { Vacio } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { NOMBRE_TIPO, tipoEvento } from "@/lib/eventos"
import { horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Actualizar en MongoDB: se carga el documento, el formulario muestra sus valores actuales y a la derecha
 *  se ven los cambios (con los campos de derived que el servidor recalcula) y el documento resultante. */

type Doc = Record<string, unknown>
export interface FilaCambio { ruta: string; antes: unknown; despues: unknown; recalculado: boolean }

const obtener = (d: Doc | null, ruta: string): unknown =>
  ruta.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Doc)[k] : undefined), d)

function aplicar(d: Doc, cambios: Record<string, unknown>): Doc {
  const copia = structuredClone(d)
  for (const [ruta, valor] of Object.entries(cambios)) {
    const partes = ruta.split(".")
    let destino = copia
    for (const p of partes.slice(0, -1)) {
      if (!destino[p] || typeof destino[p] !== "object") destino[p] = {}
      destino = destino[p] as Doc
    }
    destino[partes.at(-1)!] = valor
  }
  return copia
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** Copia de un objeto sin una clave. */
function sin<T extends Record<string, unknown>>(o: T, clave: string): T {
  const copia = { ...o }
  delete copia[clave]
  return copia
}
const ACCION_LOG: Record<string, string> = { block: "Bloqueo", thanks: "Agradecimiento", move: "Traslado", upload: "Subida de archivo" }
const nombreTipo = (d: Doc) => (d.type === "log" ? ACCION_LOG[String(d.log_type)] ?? "Registro"
  : NOMBRE_TIPO[tipoEvento({ tipo: String(d.type), revierte_a: (d.derived as Doc | undefined)?.revert_target ? "x" : null })])

export function useActualizacion() {
  const [original, setOriginal] = useState<Doc | null>(null)
  const [cambios, setCambios] = useState<Record<string, unknown>>({})
  const [derivado, setDerivado] = useState<Doc | null>(null)
  const [cargando, setCargando] = useState(false)

  async function cargar(id: string) {
    if (!id.trim()) return
    setCargando(true)
    try {
      setOriginal(await api<Doc>(`/api/crud/mongo/${encodeURIComponent(id.trim())}`))
      setCambios({})
    } catch (e) {
      setOriginal(null)
      toast.error((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  const valor = (ruta: string) => (ruta in cambios ? cambios[ruta] : obtener(original, ruta))
  /** Cambia un campo; si vuelve a su valor original, deja de contar como cambio. */
  const poner = (ruta: string, v: unknown) =>
    setCambios((c) => (igual(v, obtener(original, ruta)) ? sin(c, ruta) : { ...c, [ruta]: v }))
  const deshacer = (ruta: string) => setCambios((c) => sin(c, ruta))
  const descartar = () => setCambios({})
  /** Al cambiar de operación, el formulario vuelve a empezar vacío. */
  const limpiar = () => { setOriginal(null); setCambios({}); setDerivado(null) }

  const nuevo = useMemo(() => (original ? aplicar(original, cambios) : null), [original, cambios])

  // El servidor calcula el derived del documento cambiado (la misma función que usa al guardar).
  useEffect(() => {
    if (!nuevo || !Object.keys(cambios).length) { setDerivado(null); return }
    const t = setTimeout(() => {
      api<{ derived: Doc | null }>("/api/crud/mongo/previa", { method: "POST", body: JSON.stringify(nuevo) })
        .then((r) => setDerivado(r.derived)).catch(() => setDerivado(null))
    }, 300)
    return () => clearTimeout(t)
  }, [nuevo]) // eslint-disable-line react-hooks/exhaustive-deps

  const filas: FilaCambio[] = useMemo(() => {
    const antesDer = (original?.derived ?? {}) as Doc
    const propias = Object.entries(cambios).map(([ruta, despues]) => ({ ruta, antes: obtener(original, ruta), despues, recalculado: false }))
    const recalc = derivado
      ? Object.keys({ ...antesDer, ...derivado })
        .filter((k) => k !== "event_dt" && !igual(antesDer[k], derivado[k]))
        .map((k) => ({ ruta: `derived.${k}`, antes: antesDer[k], despues: derivado[k], recalculado: true }))
      : []
    return [...propias, ...recalc]
  }, [original, cambios, derivado])

  /** Documento como quedará: con los cambios y el derived recalculado (event_dt se conserva tal cual). */
  const despues = useMemo(() => {
    if (!nuevo) return null
    if (!derivado) return nuevo
    return { ...nuevo, derived: { ...((nuevo.derived ?? {}) as Doc), ...sin(derivado, "event_dt") } }
  }, [nuevo, derivado])

  async function guardar() {
    const id = String(original?._id ?? "")
    const r = await api<{ modificados: number; recalculados: string[]; documento: Doc }>(`/api/crud/mongo/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify({ cambios }),
    })
    setOriginal(r.documento)
    setCambios({})
    return { id, campos: Object.keys(cambios), ...r }
  }

  return { original, cambios, valor, poner, deshacer, descartar, limpiar, filas, despues, cargar, cargando, guardar, nCambios: Object.keys(cambios).length }
}
export type Actualizacion = ReturnType<typeof useActualizacion>

// ---------------------------------------------------------------- columna izquierda

function Editable({ a, ruta, label, children }: { a: Actualizacion; ruta: string; label: string; children: (editado: boolean) => ReactNode }) {
  const editado = ruta in a.cambios
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`u-${ruta}`} className="gap-1.5">{label}{editado && <span className="text-xs font-normal text-muted-foreground">· editado</span>}</Label>
      <div className="relative">
        {children(editado)}
        {editado && (
          <button type="button" onClick={() => a.deshacer(ruta)} aria-label={`Deshacer el cambio en ${label}`} title="Deshacer"
            className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Undo2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

function Texto({ a, ruta, label, mono }: { a: Actualizacion; ruta: string; label: string; mono?: boolean }) {
  const v = a.valor(ruta)
  return (
    <Editable a={a} ruta={ruta} label={label}>
      {(editado) => <Input id={`u-${ruta}`} className={cn(mono && "font-mono", editado && "border-zinc-400 pr-9 dark:border-zinc-500")} value={v == null ? "" : String(v)} onChange={(e) => a.poner(ruta, e.target.value)} />}
    </Editable>
  )
}

function Numero({ a, ruta, label }: { a: Actualizacion; ruta: string; label: string }) {
  const v = a.valor(ruta)
  return (
    <Editable a={a} ruta={ruta} label={label}>
      {(editado) => <Input id={`u-${ruta}`} type="number" min={0} className={cn("font-mono", editado && "border-zinc-400 pr-9 [appearance:textfield] dark:border-zinc-500 [&::-webkit-inner-spin-button]:appearance-none")}
        value={typeof v === "number" ? v : ""} onChange={(e) => e.target.value !== "" && a.poner(ruta, Number(e.target.value))} />}
    </Editable>
  )
}

export function FormularioActualizacion({ a, id, setId }: { a: Actualizacion; id: string; setId: (v: string) => void }) {
  const d = a.original
  const tipo = String(d?.type ?? "")
  const titulo = { categorize: "Categoría", log: "Página o usuario afectado" }[tipo] ?? "Título de la página"
  const fecha = typeof (d?.derived as Doc | undefined)?.event_time === "string" ? horaLocal(String((d!.derived as Doc).event_time)) : null
  const temporal = String(a.valor("user") ?? "").startsWith("~")

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="u-id">Documento a actualizar</Label>
        <div className="flex gap-2">
          <Input id="u-id" className="font-mono text-xs" placeholder="Ej. 67f5fdfc-f6ce-4eab-b6d3-d3509a6fe6a8" value={id} onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); a.cargar(id) } }} />
          <Button type="button" variant="outline" disabled={a.cargando} onClick={() => a.cargar(id)}>Cargar</Button>
        </div>
        <span className="text-xs text-muted-foreground">Pega un _id o llega desde Consultar con «Actualizar este».</span>
      </div>

      {d && (
        <>
          <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/40 px-3 py-2.5">
            <span className="truncate text-sm font-semibold">{String(d.title ?? "—")}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className="rounded border bg-background px-1.5 font-mono text-[10.5px] font-medium text-foreground/80">{String(d.wiki ?? "").slice(0, 2).toUpperCase()}</span>
              {nombreTipo(d)}<span className="text-muted-foreground/60">·</span>{String(d.user ?? "—")}
              {fecha && <><span className="text-muted-foreground/60">·</span>{fecha} UTC−5</>}
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">Los campos de este evento, con sus valores actuales. Cambia lo que necesites.</p>
            <Texto a={a} ruta="title" label={titulo} />
            <div className="grid grid-cols-2 gap-3">
              <Texto a={a} ruta="user" label="Editor" />
              <Editable a={a} ruta="bot" label="Tipo de editor">
                {() => (
                  <Select value={a.valor("bot") === true ? "bot" : "humano"} onValueChange={(v) => a.poner("bot", v === "bot")}>
                    <SelectTrigger id="u-bot" className={cn("w-full", "bot" in a.cambios && "border-zinc-400 dark:border-zinc-500 [&>svg:last-child]:hidden")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="humano">{temporal ? "Temporal" : "Registrado"}</SelectItem>
                      <SelectItem value="bot">Bot</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Editable>
            </div>
            {tipo === "edit" && (
              <div className="grid grid-cols-2 gap-3">
                <Numero a={a} ruta="length.old" label="Bytes antes" />
                <Numero a={a} ruta="length.new" label="Bytes después" />
              </div>
            )}
            {tipo === "new" && <Numero a={a} ruta="length.new" label="Tamaño (bytes)" />}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="u-comment" className="gap-1.5">Comentario{"comment" in a.cambios && <span className="text-xs font-normal text-muted-foreground">· editado</span>}</Label>
              <div className="relative flex flex-1">
                <Textarea id="u-comment" value={String(a.valor("comment") ?? "")} onChange={(e) => a.poner("comment", e.target.value)}
                  className={cn("min-h-24 flex-1 resize-none", "comment" in a.cambios && "border-zinc-400 pr-9 dark:border-zinc-500")} />
                {"comment" in a.cambios && (
                  <button type="button" onClick={() => a.deshacer("comment")} aria-label="Deshacer el cambio en Comentario" title="Deshacer"
                    className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <Undo2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- columna derecha

const mostrar = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v))

/** Líneas del JSON (igual que JSON.stringify con 2 espacios) con la ruta de cada valor, para marcar las cambiadas. */
function lineasConRuta(v: unknown, ruta = "", nivel = 0, clave?: string, coma = ""): { texto: string; ruta: string }[] {
  const pad = "  ".repeat(nivel)
  const pre = clave !== undefined ? `${JSON.stringify(clave)}: ` : ""
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entradas = Object.entries(v as Doc)
    if (!entradas.length) return [{ texto: `${pad}${pre}{}${coma}`, ruta }]
    return [
      { texto: `${pad}${pre}{`, ruta },
      ...entradas.flatMap(([k, x], i) => lineasConRuta(x, ruta ? `${ruta}.${k}` : k, nivel + 1, k, i < entradas.length - 1 ? "," : "")),
      { texto: `${pad}}${coma}`, ruta },
    ]
  }
  return [{ texto: `${pad}${pre}${JSON.stringify(v)}${coma}`, ruta }]
}

export function CambiosActualizacion({ a }: { a: Actualizacion }) {
  if (!a.original) return <Vacio titulo="Carga un documento" texto="Escribe su _id a la izquierda y presiona Cargar; aquí verás los cambios antes de guardarlos." />
  const propios = a.filas.filter((f) => !f.recalculado).length
  const recalc = a.filas.length - propios
  const cambiadas = new Set(a.filas.filter((f) => !f.recalculado).map((f) => f.ruta))
  const recalculadas = new Set(a.filas.filter((f) => f.recalculado).map((f) => f.ruta))
  const lineas = lineasConRuta(a.despues)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Cambios a guardar</span>
          <span className="text-xs text-muted-foreground">
            {propios ? `${propios} ${propios === 1 ? "tuyo" : "tuyos"}${recalc ? ` · ${recalc} ${recalc === 1 ? "recalculado" : "recalculados"}` : ""}` : "ninguno todavía"}
          </span>
        </div>
        {a.filas.length ? (
          <div className="max-h-[220px] overflow-y-auto">
            <table className="w-full table-fixed text-[13px]">
              <thead className="sticky top-0 bg-muted text-left text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                <tr><th className="w-[30%] px-4 py-2 font-medium">Campo</th><th className="px-4 py-2 font-medium">Antes</th><th className="px-4 py-2 font-medium">Después</th></tr>
              </thead>
              <tbody>
                {a.filas.map((f) => (
                  <tr key={f.ruta} className="border-b last:border-0 align-top">
                    <td className="truncate px-4 py-2.5 font-mono text-xs text-foreground/80" title={f.ruta}>{f.ruta}</td>
                    <td className="px-4 py-2.5 break-words text-muted-foreground/70 line-through">{mostrar(f.antes)}</td>
                    <td className="px-4 py-2.5 font-medium break-words">
                      {mostrar(f.despues)}
                      {f.recalculado && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[11px] font-normal text-muted-foreground">recalculado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-5 text-[13px] text-muted-foreground">Edita un campo de la izquierda: aquí aparecerá su valor anterior y el nuevo.</p>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-[13px] font-medium">Documento después de guardar</span>
          <span className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border border-zinc-500 bg-muted" aria-hidden />cambiado</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border border-dashed border-zinc-400" aria-hidden />recalculado</span>
          </span>
        </div>
        <div className="h-[420px] min-h-0 grow overflow-auto py-2.5 font-mono text-[12.5px] leading-5">
          {lineas.map((l, i) => {
            const marca = cambiadas.has(l.ruta) ? "cambiada" : recalculadas.has(l.ruta) ? "recalculada" : null
            return (
              <div key={i} className={cn("flex border-l-2 border-transparent pr-4 whitespace-pre",
                marca === "cambiada" && "border-zinc-500 bg-muted", marca === "recalculada" && "border-zinc-300 bg-muted/50 dark:border-zinc-600")}>
                <span aria-hidden className="w-10 shrink-0 pr-3 text-right text-muted-foreground/50 select-none">{i + 1}</span>
                <span dangerouslySetInnerHTML={{ __html: resaltar(l.texto) }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
