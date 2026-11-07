import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { LogoBase, type Base as TipoBase } from "@/components/fuente"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const NOMBRE_BASE: Record<TipoBase, string> = { mongo: "MongoDB", cassandra: "Cassandra", neo4j: "Neo4j", airflow: "Airflow (limpieza)" }

/** Logo y nombre de una base, sin separarse al cambiar de línea. */
export function Base({ base }: { base: TipoBase }) {
  return <span className="whitespace-nowrap"><LogoBase base={base} className="mr-1 inline-block align-[-3px]" />{NOMBRE_BASE[base]}</span>
}

function Fraccion({ arriba, abajo }: { arriba: string; abajo: string }) {
  return (
    <span className="inline-flex flex-col items-center">
      <span className="px-1 pb-1">{arriba}</span>
      <span className="w-full border-t-[1.5px] border-current px-1 pt-1 text-center">{abajo}</span>
    </span>
  )
}

/** Línea gris de la serie con el punto actual marcado. */
function MiniSerie({ serie, etiqueta }: { serie: number[]; etiqueta: string }) {
  const w = 232, h = 72
  const min = Math.min(...serie), max = Math.max(...serie)
  const y = (v: number) => (max === min ? h / 2 : 6 + (1 - (v - min) / (max - min)) * (h - 12))
  const x = (i: number) => (i / (serie.length - 1)) * (w - 6)
  const puntos = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const ultimo = serie.length - 1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label={etiqueta}>
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} className="stroke-border" />
      <polyline fill="none" points={puntos} className="stroke-muted-foreground/60" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(ultimo)} cy={y(serie[ultimo])} r={4} className="fill-foreground stroke-muted" strokeWidth={2} />
    </svg>
  )
}

export interface MetricaModal {
  titulo: string
  etiqueta: string
  /** Momento al que corresponde el valor ("7 nov · 02:00–02:59 UTC", "Últimos 30 minutos") */
  momento: string
  valor: string
  /** true: el valor es un nombre (página, editor) y se muestra más chico */
  valorEsTexto?: boolean
  nota?: ReactNode
  notaClase?: string
  serie?: { valores: number[]; desde: string }
  datos: [string, ReactNode][]
  definicion: string
  /** fraccion: cociente · texto: fórmula en palabras · codigo: consulta (Cypher, MongoDB) */
  calculo: { fraccion?: [string, string, string?]; texto?: string; codigo?: string }
  lectura: string
  origen: ReactNode
}

/** Modal de detalle de una métrica: el dato a la izquierda y su definición a la derecha.
 *  Lo usan los KPIs del Resumen y las tarjetas de En vivo. */
export function ModalMetrica(props: {
  m: MetricaModal
  anterior: { nombre: string; ir: () => void }
  siguiente: { nombre: string; ir: () => void }
  onCerrar: () => void
}) {
  const { m, anterior, siguiente, onCerrar } = props
  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[840px]">
        <div className="flex items-baseline gap-3 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-lg">{m.titulo}</DialogTitle>
          <DialogDescription className="text-[13px]">{m.etiqueta}</DialogDescription>
        </div>

        <div className="grid overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-[18px] border-b bg-muted/40 p-6 md:border-r md:border-b-0">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{m.momento}</span>
              <span className={m.valorEsTexto ? "text-[28px] leading-tight font-semibold tracking-tight break-words" : "text-5xl leading-none font-semibold tracking-tighter tabular-nums"}>{m.valor}</span>
              {m.nota && <span className={cn("text-[13px] text-muted-foreground", m.notaClase)}>{m.nota}</span>}
            </div>
            {m.serie && m.serie.valores.length >= 3 && (
              <div className="flex flex-col gap-1.5">
                <MiniSerie serie={m.serie.valores} etiqueta={`Evolución desde ${m.serie.desde}`} />
                <div className="flex justify-between text-[11px] text-muted-foreground"><span>{m.serie.desde}</span><span>ahora</span></div>
              </div>
            )}
            {m.datos.length > 0 && (
              <dl className="flex flex-col gap-2 border-t pt-4 text-[13px]">
                {m.datos.map(([etq, val]) => (
                  <div key={etq} className="flex justify-between gap-3"><dt className="text-muted-foreground">{etq}</dt><dd className="text-right font-medium tabular-nums">{val}</dd></div>
                ))}
              </dl>
            )}
          </div>

          <div className="flex flex-col gap-[22px] px-7 py-6 text-sm leading-relaxed">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Definición</h3>
              <p>{m.definicion}</p>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Cómo se calcula</h3>
              {m.calculo.fraccion ? (
                <div className="flex items-center gap-2.5">
                  <Fraccion arriba={m.calculo.fraccion[0]} abajo={m.calculo.fraccion[1]} />
                  {m.calculo.fraccion[2] && <span>{m.calculo.fraccion[2]}</span>}
                </div>
              ) : m.calculo.codigo ? (
                <code className="block rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-words">{m.calculo.codigo}</code>
              ) : (
                <p>{m.calculo.texto}</p>
              )}
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Cómo leerlo</h3>
              <p>{m.lectura}</p>
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">De dónde sale</h3>
              <p>{m.origen}</p>
            </section>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <button type="button" onClick={anterior.ir} className="inline-flex h-8 max-w-[48%] min-w-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{anterior.nombre}</span>
          </button>
          <button type="button" onClick={siguiente.ir} className="inline-flex h-8 max-w-[48%] min-w-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <span className="truncate">{siguiente.nombre}</span><ChevronRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
