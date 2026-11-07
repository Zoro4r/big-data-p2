import type { ReactNode } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Ruta, type Base } from "@/components/fuente"
import { cn } from "@/lib/utils"

const TONO = {
  bueno: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  malo: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  neutro: "border-border bg-card text-foreground/80",
}

export function TarjetaKpi(props: {
  etiqueta: string
  valor: string
  cambio?: { texto: string; tono: keyof typeof TONO; sube: boolean } | null
  pie: ReactNode
  /** De dónde sale el dato: [base] o [base de cálculo, base donde se guarda] */
  ruta: Base[]
  titulo?: string
}) {
  const { etiqueta, valor, cambio, pie, ruta, titulo } = props
  const Icono = cambio?.sube ? TrendingUp : TrendingDown
  return (
    <Card className="gap-3 py-[18px] shadow-xs" title={titulo}>
      <CardHeader className="px-5">
        <div className="flex items-start justify-between gap-2">
          <CardDescription className="text-[13px]">{etiqueta}</CardDescription>
          {cambio && (
            <Badge variant="outline" className={cn("gap-1 font-medium", TONO[cambio.tono])}>
              <Icono className="size-3" aria-hidden />
              {cambio.texto}
            </Badge>
          )}
        </div>
        <CardTitle className="text-[28px] font-semibold tracking-tight tabular-nums">{valor}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5 px-5 text-[13px]">
        <span className="font-medium">{pie}</span>
        <Ruta bases={ruta} className="mt-auto border-t pt-2.5 text-xs text-muted-foreground" />
      </CardContent>
    </Card>
  )
}

export function Seccion(props: { titulo: string; descripcion?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
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
      <CardContent className="px-6">{props.children}</CardContent>
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
