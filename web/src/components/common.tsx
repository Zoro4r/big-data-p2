import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const TONO = {
  bueno: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  malo: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  neutro: "border-border bg-card text-foreground/80",
}

export function TarjetaKpi(props: {
  etiqueta: string
  valor: string
  cambio?: { texto: string; tono: keyof typeof TONO; sube: boolean | null } | null
  pie: ReactNode
  titulo?: string
  /** Solo colorea el valor cuando se solicita explícitamente (por ejemplo, contenido con signo). */
  tonoValor?: keyof typeof TONO
  /** Si se pasa, la tarjeta se puede clickear (abre el detalle del KPI) */
  onAbrir?: () => void
  /** Clases extra para el elemento de la grilla (por ejemplo, su posición con `order`) */
  className?: string
}) {
  const { etiqueta, valor, cambio, pie, titulo, onAbrir, className } = props
  const colorValor = props.tonoValor === "bueno" ? "text-green-700 dark:text-green-400" : props.tonoValor === "malo" ? "text-red-700 dark:text-red-400" : "text-foreground"
  // Subgrid: la tarjeta ocupa 3 filas de la grilla padre (nombre, valor, contexto), así las tarjetas
  // de una misma fila alinean su valor aunque algún nombre ocupe dos líneas.
  const tarjeta = (
    <Card className={cn("row-span-3 grid min-h-40 grid-rows-subgrid gap-x-0 gap-y-3 py-4 text-left shadow-xs", !onAbrir && className, onAbrir && "transition-[border-color,box-shadow,background-color] group-hover:border-foreground/25 group-hover:bg-muted/30 group-hover:shadow-md")} title={onAbrir ? undefined : titulo}>
      <div className="flex min-h-9 items-start justify-between gap-2 self-center px-5">
        <CardDescription className="min-w-0 text-[13px] leading-[18px] font-medium text-foreground">
          {etiqueta}
        </CardDescription>
        {cambio && <Badge variant="outline" className={cn("ml-auto px-1.5 text-[11px] font-medium tabular-nums", TONO[cambio.tono])}>{cambio.texto}</Badge>}
      </div>
      <CardTitle className={cn("self-center px-5 text-[28px] leading-none font-semibold tracking-tight tabular-nums", colorValor)}>{valor}</CardTitle>
      <span className="min-h-9 self-center px-5 text-[13px] leading-[18px] font-normal text-muted-foreground">{pie}</span>
    </Card>
  )
  if (!onAbrir) return tarjeta
  return (
    <button type="button" onClick={onAbrir} aria-label={`${etiqueta}: ${valor}. Ver definición`} className={cn("group row-span-3 grid grid-rows-subgrid gap-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {tarjeta}
    </button>
  )
}

export function Seccion(props: { titulo: string; descripcion?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string; contenidoClassName?: string }) {
  return (
    <Card className={cn("gap-4 py-5 shadow-xs", props.className)}>
      <CardHeader className="px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">{props.titulo}</CardTitle>
            {props.descripcion && <CardDescription className="text-[13px]">{props.descripcion}</CardDescription>}
          </div>
          {props.accion}
        </div>
      </CardHeader>
      <CardContent className={cn("px-6", props.contenidoClassName)}>{props.children}</CardContent>
    </Card>
  )
}

export function Cargando({ alto = 240 }: { alto?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height: alto }} />
}

export function Vacio({ titulo, texto, icono }: { titulo: string; texto: string; icono?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-7 text-center text-[13px] text-muted-foreground">
      {icono}
      <span className="font-medium text-foreground/80">{titulo}</span>
      <span>{texto}</span>
    </div>
  )
}

export function Leyenda({ items }: { items: { nombre: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[13px] text-foreground/80">
      {items.map((i) => (
        <span key={i.nombre} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.nombre}
        </span>
      ))}
    </div>
  )
}

/** Barra horizontal de ranking (como en el mockup): nombre · barra · valor. */
export function FilaBarra({ nombre, valor, max, color, mono = false }: { nombre: string; valor: number; max: number; color: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_40px] items-center gap-3 text-[13px]">
      <span className={cn("truncate", mono && "font-mono text-xs")} title={nombre}>{nombre}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (valor / Math.max(max, 1)) * 100)}%`, background: color }} />
      </div>
      <span className="text-right font-medium tabular-nums">{valor}</span>
    </div>
  )
}
