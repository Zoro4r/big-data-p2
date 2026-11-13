import { useEffect, useState, type ReactNode } from "react"
import { Check, FlaskConical, History, Trash2, Undo2 } from "lucide-react"

import { NOMBRE_WIKI, Segmentado, type WikiCrud } from "@/components/crear-evento"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Piezas compartidas por el CRUD de Cassandra y Neo4j (mismos patrones que el de MongoDB). */

export type Operacion = "Crear" | "Consultar" | "Actualizar" | "Eliminar"

/** Cassandra y Neo4j guardan datos que calcula el pipeline: solo se escribe sobre nombres «demo_…». */
export const PREFIJO_DEMO = "demo_"
export const esDemo = (s: string) => s.startsWith(PREFIJO_DEMO)

export function Operaciones({ valor, onChange }: { valor: Operacion; onChange: (v: Operacion) => void }) {
  return (
    <ToggleGroup type="single" value={valor} onValueChange={(v) => v && onChange(v as Operacion)} variant="outline" className="w-full" aria-label="Operación">
      {(["Crear", "Consultar", "Actualizar", "Eliminar"] as Operacion[]).map((o) => <ToggleGroupItem key={o} value={o} className="flex-1">{o}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}

export function Campo({ id, label, clave, editado, ayuda, children, className }: {
  id: string; label: string; clave?: string; editado?: boolean; ayuda?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="gap-1.5">
        {label}
        {clave && <span className="rounded-full bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{clave}</span>}
        {editado && <span className="text-xs font-normal text-muted-foreground">· editado</span>}
      </Label>
      {children}
      {ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>}
    </div>
  )
}

/** Input con el botón de deshacer dentro cuando el valor cambió. */
export function InputEditable({ id, valor, original, onChange, onDeshacer, tipo = "text", mono }: {
  id: string; valor: string; original: string; onChange: (v: string) => void; onDeshacer: () => void; tipo?: string; mono?: boolean
}) {
  const editado = valor !== original
  return (
    <div className="relative">
      <Input id={id} type={tipo} value={valor} onChange={(e) => onChange(e.target.value)}
        className={cn(mono && "font-mono", editado && "border-zinc-400 pr-9 [appearance:textfield] dark:border-zinc-500 [&::-webkit-inner-spin-button]:appearance-none")} />
      {editado && (
        <button type="button" onClick={onDeshacer} title="Deshacer" aria-label="Deshacer el cambio"
          className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Undo2 className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

/** Recuadro con la wiki de destino; por defecto sigue al filtro de la cabecera. */
export function CajaWiki({ wiki, onChange, verbo }: { wiki: WikiCrud; onChange: (w: WikiCrud) => void; verbo: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center gap-2.5">
        <span className="rounded border bg-background px-1.5 py-px font-mono text-[11px] font-medium">{wiki.slice(0, 2).toUpperCase()}</span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-medium">{verbo} {wiki} · {NOMBRE_WIKI[wiki]}</span>
          <span className="text-xs text-muted-foreground">Por defecto, la wiki elegida en el encabezado</span>
        </div>
      </div>
      <Segmentado etiqueta="Wiki" valor={wiki} onChange={onChange} opciones={[["enwiki", "enwiki"], ["eswiki", "eswiki"]]} />
    </div>
  )
}

/** Aviso bajo un nombre que no es de demostración. */
export function AvisoDemo({ nombre }: { nombre: string }) {
  if (!nombre || esDemo(nombre)) return null
  return <span className="text-xs text-muted-foreground">Para no alterar los datos reales, solo se escribe sobre nombres que empiezan con «{PREFIJO_DEMO}».</span>
}

export function Ficha({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-left">
      <span className="truncate text-sm font-semibold text-foreground">{titulo}</span>
      {children && <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">{children}</span>}
    </div>
  )
}

export const Punto = () => <span className="text-muted-foreground/60">·</span>
export const Chip = ({ children }: { children: ReactNode }) => (
  <span className="rounded border bg-background px-1.5 font-mono text-[10.5px] font-medium text-foreground/80">{children}</span>
)
export const Clave = ({ children }: { children: ReactNode }) => (
  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[11px] font-normal text-muted-foreground">{children}</span>
)

export function Panel({ titulo, derecha, children }: { titulo: ReactNode; derecha?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold">{titulo}</span>
        {derecha && <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{derecha}</span>}
      </div>
      {children}
    </div>
  )
}

/** Tabla simple; con `alto`, el cuerpo hace scroll y el encabezado queda fijo. */
export function Tabla({ columnas, filas, anchos, alto }: { columnas: string[]; filas: ReactNode[][]; anchos: string; alto?: number }) {
  return (
    <div className="overflow-y-auto" style={alto ? { maxHeight: alto } : undefined}>
      <div className="sticky top-0 grid gap-3 border-b bg-muted px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase" style={{ gridTemplateColumns: anchos }}>
        {columnas.map((c) => <span key={c}>{c}</span>)}
      </div>
      {filas.map((f, i) => (
        <div key={i} className="grid gap-3 border-b px-4 py-2.5 text-[13px] last:border-0" style={{ gridTemplateColumns: anchos }}>
          {f.map((c, j) => <span key={j} className="min-w-0 break-words">{c}</span>)}
        </div>
      ))}
    </div>
  )
}

export const Antes = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground/70 line-through">{children}</span>
export const Recalculado = () => <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground">recalculado</span>

export function Nota({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border bg-muted/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>
}

/** Lista de coincidencias elegibles, como en Consultar de MongoDB. */
export function Coincidencias<T>({ items, elegido, onElegir, clave, titulo, sub, derecha }: {
  items: T[]; elegido: number; onElegir: (i: number) => void; clave: (t: T) => string; titulo: (t: T) => ReactNode; sub: (t: T) => ReactNode; derecha: (t: T) => ReactNode
}) {
  if (items.length < 2) return null
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{items.length} coincidencias</span>
        <span className="text-xs text-muted-foreground">elige una para verla</span>
      </div>
      {/* La lista se desplaza por dentro: así no estira la columna y la derecha conserva su altura. */}
      <div className="-mx-1 flex max-h-[300px] flex-col gap-2 overflow-y-auto px-1 py-1">
      {items.map((t, i) => (
        <button key={clave(t)} type="button" onClick={() => onElegir(i)} aria-pressed={i === elegido}
          className={cn("flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            i === elegido && "border-foreground ring-[3px] ring-muted")}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-medium">{titulo(t)}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{sub(t)}</span>
          </span>
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{derecha(t)}</span>
        </button>
      ))}
      </div>
    </div>
  )
}

/** Campo "Para confirmar, escribe …": el botón de borrar se activa cuando coincide. */
export function ConfirmarEscribiendo({ id, valor, texto, onChange, etiqueta }: { id: string; valor: string; texto: string; onChange: (v: string) => void; etiqueta: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input id={id} className="font-mono text-xs" placeholder={valor} autoComplete="off" spellCheck={false} value={texto} onChange={(e) => onChange(e.target.value)} />
      <span className="text-xs text-muted-foreground">El botón se activa cuando el texto coincide; luego se confirma en un diálogo.</span>
    </div>
  )
}

export function DialogoBorrar({ abierto, titulo, descripcion, children, onCerrar, onConfirmar, ocupado }: {
  abierto: boolean; titulo: string; descripcion: ReactNode; children?: ReactNode; onCerrar: () => void; onConfirmar: () => void; ocupado: boolean
}) {
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className="leading-relaxed">{descripcion}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={ocupado} onClick={onConfirmar}><Trash2 aria-hidden />Eliminar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function QuePasa({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <Panel titulo="Qué pasa al eliminarlo">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        {filas.map(([b, t]) => (
          <div key={b} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-[13px]"><span className="font-medium">{b}</span><span className="text-muted-foreground">{t}</span></div>
        ))}
      </div>
    </Panel>
  )
}

/** Completa la operación con datos de demostración («demo_…»): los formularios empiezan vacíos. */
/** Pie de Actualizar: «Cancelar» descarta lo editado y «Guardar N cambios» lo envía. */
export function BotonesGuardar({ n, deshabilitado, onCancelar }: { n: number; deshabilitado: boolean; onCancelar: () => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
      <Button type="button" variant="outline" disabled={!n} className="h-10 text-sm" onClick={onCancelar}>Cancelar</Button>
      <Button type="submit" disabled={deshabilitado || !n} className="h-10 text-sm">
        <Check aria-hidden />{n ? `Guardar ${n} ${n === 1 ? "cambio" : "cambios"}` : "Guardar cambios"}
      </Button>
    </div>
  )
}

export function BotonPrueba({ onClick, ultimos }: { onClick: () => void; ultimos?: string | false }) {
  return (
    <Button type="button" variant="outline" size="sm" className="w-full" onClick={onClick}>
      {ultimos ? <><History aria-hidden />Elegir entre {ultimos}</> : <><FlaskConical aria-hidden />Completar con datos de prueba</>}
    </Button>
  )
}

/** «hace 18 s», «hace 5 min», «hace 3 h» o la fecha local si pasó más de un día. */
export function haceTiempo(f: string | null | undefined) {
  if (!f) return "—"
  const s = Math.max(0, (Date.now() - new Date(f).getTime()) / 1000)
  if (s < 60) return `hace ${Math.round(s)} s`
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return horaLocal(f)
}

export interface OpcionModal { id: string; titulo: string; subtitulo?: string; medio: string; derecha: string }

/** Modal para elegir un registro reciente: tabla con selección y confirmación (el mismo en las tres bases). */
export function ModalElegir({ abierto, onCerrar, titulo, descripcion, columnas, filas, vacio, pie, accion, onElegir }: {
  abierto: boolean; onCerrar: () => void; titulo: string; descripcion: ReactNode; columnas: [string, string, string]
  filas: OpcionModal[] | null; vacio: string; pie: (id: string) => string; accion: string; onElegir: (id: string) => void
}) {
  const [marcado, setMarcado] = useState<string | null>(null)
  useEffect(() => setMarcado(filas?.[0]?.id ?? null), [filas])
  const grid = "grid grid-cols-[20px_minmax(0,1fr)_120px_88px] items-center gap-3"
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[600px]">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <div className={cn(grid, "border-y bg-muted/40 px-6 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase")}>
          <span /><span>{columnas[0]}</span><span>{columnas[1]}</span><span className="text-right">{columnas[2]}</span>
        </div>
        {!filas ? <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p> : filas.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{vacio}</p>
        ) : (
          <div role="radiogroup" aria-label={titulo} className="flex flex-col">
            {filas.map((f) => {
              const activo = marcado === f.id
              return (
                <button key={f.id} type="button" role="radio" aria-checked={activo} onClick={() => setMarcado(f.id)}
                  onDoubleClick={() => onElegir(f.id)}
                  className={cn(grid, "border-b px-6 py-2.5 text-left transition-colors outline-none last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/60",
                    activo && "bg-accent/70")}>
                  <span className={cn("flex size-4 items-center justify-center rounded-full border-[1.5px]", activo ? "border-foreground" : "border-muted-foreground/50")}>
                    {activo && <span className="size-2 rounded-full bg-foreground" />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-medium">{f.titulo}</span>
                    {f.subtitulo && <span className="truncate text-xs text-muted-foreground">{f.subtitulo}</span>}
                  </span>
                  <span className="truncate text-[12.5px] text-foreground/80">{f.medio}</span>
                  <span className="text-right text-xs whitespace-nowrap text-muted-foreground">{f.derecha}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <span className="truncate font-mono text-[11px] text-muted-foreground">{marcado ? pie(marcado) : ""}</span>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
            <Button type="button" disabled={!marcado} onClick={() => marcado && onElegir(marcado)}>{accion}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
