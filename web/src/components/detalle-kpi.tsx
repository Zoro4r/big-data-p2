import { ChevronLeft, ChevronRight } from "lucide-react"

import { LogoBase, baseDeCalculo } from "@/components/fuente"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { entero, horaUTC } from "@/lib/format"
import { cambio, formatoKpi, KPIS, type Kpi, type PuntoKpi } from "@/lib/kpis"
import { cn } from "@/lib/utils"

const ORDEN = Object.keys(KPIS) as Kpi[]
const NOMBRE_BASE = { mongo: "MongoDB", cassandra: "Cassandra", neo4j: "Neo4j", airflow: "Airflow (limpieza)" } as const
const UNIDAD_ENTIDAD: Partial<Record<Kpi, string>> = {
  pagina_mas_disputada: "editores distintos",
  editor_mas_conectado: "coeditores",
  editor_mas_revertido: "reversiones",
}
const TONO = { bueno: "text-green-700 dark:text-green-400", malo: "text-red-700 dark:text-red-400", neutro: "text-muted-foreground" }

/** "enwiki:Frozen yogurt (revertido por 2 editores)" → "Frozen yogurt" */
const nombreEntidad = (detalle: string | null | undefined) => (detalle ?? "—").split(" (")[0].replace(/^(en|es)wiki:/, "")

/** Línea de las últimas horas (gris) con el punto actual marcado. */
function MiniSerie({ serie }: { serie: number[] }) {
  const w = 232, h = 72
  const min = Math.min(...serie), max = Math.max(...serie)
  const y = (v: number) => (max === min ? h / 2 : 6 + (1 - (v - min) / (max - min)) * (h - 12))
  const x = (i: number) => (i / (serie.length - 1)) * (w - 6)
  const puntos = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const ultimo = serie.length - 1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label={`Evolución en las últimas ${serie.length} horas`}>
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} className="stroke-border" />
      <polyline fill="none" points={puntos} className="stroke-muted-foreground/60" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(ultimo)} cy={y(serie[ultimo])} r={4} className="fill-foreground stroke-muted" strokeWidth={2} />
    </svg>
  )
}

/** Logo y nombre de una base, sin separarse al cambiar de línea. */
function Base({ base }: { base: keyof typeof NOMBRE_BASE }) {
  return <span className="whitespace-nowrap"><LogoBase base={base} className="mr-1 inline-block align-[-3px]" />{NOMBRE_BASE[base]}</span>
}

function Fraccion({ arriba, abajo, className }: { arriba: string; abajo: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-center", className)}>
      <span className="px-1 pb-1">{arriba}</span>
      <span className="w-full border-t-[1.5px] border-current px-1 pt-1 text-center">{abajo}</span>
    </span>
  )
}

/** Detalle de un KPI: el dato a la izquierda y su definición a la derecha. */
export function DetalleKpi(props: {
  kpi: Kpi | null
  series: Record<Kpi, PuntoKpi[]> | null
  etiqueta: string
  onCambiar: (k: Kpi | null) => void
}) {
  const { kpi, series, etiqueta, onCambiar } = props
  if (!kpi) return null
  const meta = KPIS[kpi]
  const serie = series?.[kpi] ?? []
  const [actual, previa] = serie
  const entidad = meta.unidad === "entidad"
  const c = cambio(kpi, serie)
  const valores = serie.slice(0, 24).map((p) => p.valor).filter((v): v is number => v != null).reverse()
  const promedio = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null
  const base = baseDeCalculo(meta.fuente)
  const i = ORDEN.indexOf(kpi)
  const anterior = ORDEN[(i - 1 + ORDEN.length) % ORDEN.length]
  const siguiente = ORDEN[(i + 1) % ORDEN.length]

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCambiar(null)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[840px]">
        <div className="flex items-baseline gap-3 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-lg">{meta.nombre}</DialogTitle>
          <DialogDescription className="text-[13px]">{etiqueta}</DialogDescription>
        </div>

        <div className="grid overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)]">
          {/* Izquierda: el dato */}
          <div className="flex flex-col gap-[18px] border-b bg-muted/40 p-6 md:border-r md:border-b-0">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {actual ? `${horaUTC(actual.ventana)}–${horaUTC(actual.ventana, false).slice(0, 2)}:59 UTC` : "Sin datos"}
              </span>
              {entidad ? (
                <>
                  <span className="text-[28px] leading-tight font-semibold tracking-tight break-words">{nombreEntidad(actual?.detalle)}</span>
                  <span className="text-[13px] text-muted-foreground">{entero(actual?.valor)} {UNIDAD_ENTIDAD[kpi]}</span>
                </>
              ) : (
                <>
                  <span className="text-5xl leading-none font-semibold tracking-tighter tabular-nums">{formatoKpi(kpi, actual?.valor)}</span>
                  <span className={cn("text-[13px]", c ? TONO[c.tono] : "text-muted-foreground")}>
                    {c ? `${c.sube ? "↗" : "↘"} ${c.texto.replace(/^[+−]/, "")} ${c.sube ? "más" : "menos"} que la hora anterior` : "Igual que la hora anterior"}
                  </span>
                </>
              )}
            </div>

            {!entidad && valores.length >= 3 && (
              <div className="flex flex-col gap-1.5">
                <MiniSerie serie={valores} />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>hace {valores.length} h</span>
                  <span>ahora</span>
                </div>
              </div>
            )}

            <dl className="flex flex-col gap-2 border-t pt-4 text-[13px]">
              {!entidad && actual?.detalle && (
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">En la hora</dt><dd className="text-right font-medium">{actual.detalle}</dd></div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Hora anterior</dt>
                <dd className="text-right font-medium tabular-nums">
                  {entidad ? `${nombreEntidad(previa?.detalle)} (${entero(previa?.valor)})` : formatoKpi(kpi, previa?.valor)}
                </dd>
              </div>
              {!entidad && promedio != null && (
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Promedio {valores.length} h</dt><dd className="font-medium tabular-nums">{formatoKpi(kpi, promedio)}</dd></div>
              )}
            </dl>
          </div>

          {/* Derecha: la definición */}
          <div className="flex flex-col gap-[22px] px-7 py-6 text-sm leading-relaxed">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Definición</h3>
              <p>{meta.definicion}</p>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Cómo se calcula</h3>
              {meta.fraccion ? (
                <div className="flex items-center gap-2.5">
                  <Fraccion arriba={meta.fraccion[0]} abajo={meta.fraccion[1]} />
                  {meta.fraccion[2] && <span>{meta.fraccion[2]}</span>}
                </div>
              ) : (
                <p>{meta.formula}</p>
              )}
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Cómo leerlo</h3>
              <p>{meta.lectura}</p>
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">De dónde sale</h3>
              <p>
                {base === "cassandra" ? (
                  <>Se calcula y se guarda en <Base base="cassandra" />.</>
                ) : (
                  <>Se calcula en <Base base={base} /> y se guarda en <Base base="cassandra" />.</>
                )}
              </p>
            </section>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <button type="button" onClick={() => onCambiar(anterior)} className="inline-flex h-8 max-w-[48%] min-w-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{KPIS[anterior].nombre}</span>
          </button>
          <button type="button" onClick={() => onCambiar(siguiente)} className="inline-flex h-8 max-w-[48%] min-w-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <span className="truncate">{KPIS[siguiente].nombre}</span><ChevronRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
