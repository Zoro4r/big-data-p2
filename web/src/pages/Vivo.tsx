import { useEffect, useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChevronRight, Filter, X } from "lucide-react"

import { Cargando, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { DetalleEvento } from "@/components/detalle-evento"
import { Base, ModalMetrica, type MetricaModal } from "@/components/modal-metrica"
import { Header, Pagina } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { BORRADO_GRANDE, cumpleFiltros, FILTROS_EDITOR, SIN_FILTROS, FILTROS_TIPO, NOMBRE_EDITOR, NOMBRE_TIPO, PLURAL_TIPO, tipoEvento, type EventoResumen, type Filtros } from "@/lib/eventos"
import { COLOR, colorTipo, variacion, entero, horaLocal, intervaloLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

interface VentanaVivo {
  inicio: string; fin: string; eventos: number; ediciones: number; eventos_bot: number; reversiones: number
  editores: Record<string, number>
}
const totalEditores = (v: VentanaVivo) => Object.values(v.editores).reduce((sum, n) => sum + n, 0)
const proporcionBots = (v: VentanaVivo) => v.eventos ? 100 * v.eventos_bot / v.eventos : null

interface Vivo {
  metricas: { actual: VentanaVivo; anterior: VentanaVivo }
  ahora: string
  inicio: string
  fin: string
  provisional: boolean
  por_minuto: { wiki: string; t: string; eventos: number; ediciones: number; eventos_bot: number; reversiones: number }[]
  ultimos: EventoResumen[]
  /** Cambios que borraron más de BORRADO_GRANDE bytes en la ventana. */
  borrados: EventoResumen[]
  stream: { ultimo_evento: string | null; actualizado: string | null }
}

const REFRESCO_MS = 4000
const MOSTRAR = 25

/** Tarjetas de En vivo que abren su detalle. */
type MetricaVivo = "eventos" | "editores" | "bots" | "rev"
const ORDEN_VIVO: MetricaVivo[] = ["eventos", "editores", "bots", "rev"]
const NOMBRE_METRICA: Record<MetricaVivo, string> = { eventos: "Eventos registrados", editores: "Editores participantes", bots: "Eventos de bots", rev: "Reversiones detectadas" }

export function TarjetasVivo({ actual: v, anterior, onAbrir }: { actual?: VentanaVivo; anterior?: VentanaVivo; onAbrir: (id: MetricaVivo) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {!v || !anterior ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={160} />) : (
        <>
          <TarjetaKpi etiqueta={NOMBRE_METRICA.eventos} cambio={variacion(v.eventos, anterior.eventos)} valor={entero(v.eventos)} pie={`Promedio: ${(v.eventos / 300).toFixed(1)} eventos/s`} onAbrir={() => onAbrir("eventos")} />
          <TarjetaKpi etiqueta={NOMBRE_METRICA.editores} cambio={variacion(totalEditores(v), totalEditores(anterior))} valor={entero(totalEditores(v))}
            pie={`${entero(totalEditores(v) - (v.editores.bot ?? 0))} personas y ${entero(v.editores.bot ?? 0)} bots`} onAbrir={() => onAbrir("editores")} />
          <TarjetaKpi etiqueta={NOMBRE_METRICA.bots} cambio={variacion(proporcionBots(v), proporcionBots(anterior), "pp")} valor={v.eventos ? `${proporcionBots(v)!.toFixed(1)} %` : "—"}
            pie={`${entero(v.eventos_bot)} de ${entero(v.eventos)} eventos`} onAbrir={() => onAbrir("bots")} />
          <TarjetaKpi etiqueta={NOMBRE_METRICA.rev} cambio={variacion(v.reversiones, anterior.reversiones)} valor={entero(v.reversiones)} pie="Deshacen cambios de otro editor" onAbrir={() => onAbrir("rev")} />
        </>
      )}
    </div>
  )
}

/** Las cuatro tarjetas comparten exactamente la misma ventana móvil de cinco minutos. */
function metricaVivo(k: MetricaVivo, d: Vivo, etiqueta: string): MetricaModal {
  const v = d.metricas.actual, anterior = d.metricas.anterior
  const comun = { etiqueta, momento: `${intervaloLocal(v.inicio, v.fin)} · últimos 5 minutos`,
    origen: <>Eventos guardados en <Base base="mongo" /> durante ese intervalo. Comparación con los cinco minutos inmediatamente anteriores.</> }
  if (k === "eventos") return {
    ...comun, titulo: NOMBRE_METRICA.eventos, valor: entero(v.eventos), nota: `Promedio: ${(v.eventos / 300).toFixed(1)} eventos/s`,
    datos: [["5 minutos anteriores", entero(anterior.eventos)]],
    definicion: "Cantidad de eventos de Wikipedia guardados durante los últimos cinco minutos.",
    calculo: { texto: "Se cuenta cada evento guardado entre el inicio y el fin del intervalo." },
    lectura: "El promedio por segundo divide ese total entre 300 segundos. La pastilla compara los totales de ambos intervalos.",
  }
  if (k === "editores") return {
    ...comun, titulo: NOMBRE_METRICA.editores, valor: entero(totalEditores(v)), nota: "Editores distintos en 5 min",
    datos: [["Personas", entero(totalEditores(v) - (v.editores.bot ?? 0))], ["Bots", entero(v.editores.bot ?? 0)],
      ["5 minutos anteriores", entero(totalEditores(anterior))]],
    definicion: "Editores distintos que hicieron al menos un cambio durante los últimos cinco minutos.",
    calculo: { texto: "Usuarios distintos entre el inicio y el fin del intervalo; cada usuario se cuenta una vez." },
    lectura: "Cuenta a quienes realizaron cambios, no a todos los usuarios conectados. Cada editor puede generar varios eventos.",
  }
  if (k === "bots") return {
    ...comun, titulo: NOMBRE_METRICA.bots, valor: v.eventos ? `${proporcionBots(v)!.toFixed(1)} %` : "—", nota: `${entero(v.eventos_bot)} eventos de bots en 5 min`,
    datos: [["Eventos humanos", entero(v.eventos - v.eventos_bot)], ["5 minutos anteriores", anterior.eventos ? `${proporcionBots(anterior)!.toFixed(1)} %` : "—"]],
    definicion: "Parte de los eventos de los últimos cinco minutos realizada por bots.",
    calculo: { fraccion: ["eventos de bots", "eventos del intervalo", "× 100"] },
    lectura: "La variación se expresa en puntos porcentuales (pp), para comparar ambas proporciones.",
  }
  return {
    ...comun, titulo: NOMBRE_METRICA.rev, valor: entero(v.reversiones), nota: "Reversiones en los últimos 5 min",
    datos: [["5 minutos anteriores", entero(anterior.reversiones)]],
    definicion: "Ediciones que deshacen el trabajo de otro editor durante los últimos cinco minutos.",
    calculo: { texto: "Eventos del intervalo cuyo comentario identifica una reversión a otro editor." },
    lectura: "Muestra actividad de revisión; un aumento por sí solo no determina su causa.",
  }
}

/** Menú de filtros: tamaño, tipo de evento y tipo de editor. "Todos" equivale a no filtrar ese grupo. */
function MenuFiltros({ filtros, setFiltros }: { filtros: Filtros; setFiltros: (f: Filtros) => void }) {
  const activos = filtros.tipos.size + filtros.editores.size + (filtros.borrados ? 1 : 0)
  const alternar = <T,>(conjunto: Set<T>, valor: T) => { const n = new Set(conjunto); if (n.has(valor)) n.delete(valor); else n.add(valor); return n }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={activos ? "default" : "outline"} size="sm" className="gap-1.5">
          <Filter aria-hidden />Filtros
          {activos > 0 && <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-primary-foreground text-[11px] text-primary">{activos}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-3.5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Para patrullar</legend>
          <Opcion etiqueta={`Borrados grandes (más de ${entero(BORRADO_GRANDE)} bytes)`} marcado={filtros.borrados} onCambio={() => setFiltros({ ...filtros, borrados: !filtros.borrados })} />
        </fieldset>
        <div className="h-px bg-border" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Tipo de evento</legend>
          <Opcion etiqueta="Todos" marcado={filtros.tipos.size === 0} onCambio={() => setFiltros({ ...filtros, tipos: new Set() })} />
          {FILTROS_TIPO.map((t) => <Opcion key={t} etiqueta={PLURAL_TIPO[t]} marcado={filtros.tipos.has(t)} onCambio={() => setFiltros({ ...filtros, tipos: alternar(filtros.tipos, t) })} />)}
        </fieldset>
        <div className="h-px bg-border" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Editor</legend>
          <Opcion etiqueta="Todos" marcado={filtros.editores.size === 0} onCambio={() => setFiltros({ ...filtros, editores: new Set() })} />
          {FILTROS_EDITOR.map((k) => <Opcion key={k} etiqueta={NOMBRE_EDITOR[k]} marcado={filtros.editores.has(k)} onCambio={() => setFiltros({ ...filtros, editores: alternar(filtros.editores, k) })} />)}
        </fieldset>
        <div className="h-px bg-border" />
        <Button variant="outline" size="sm" disabled={!activos} onClick={() => setFiltros(SIN_FILTROS)}>Limpiar filtros</Button>
      </PopoverContent>
    </Popover>
  )
}

function Opcion({ etiqueta, marcado, onCambio }: { etiqueta: string; marcado: boolean; onCambio: () => void }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-[13px]", marcado ? "font-medium" : "text-foreground/80")}>
      <Checkbox checked={marcado} onCheckedChange={onCambio} />{etiqueta}
    </label>
  )
}

/** Fichas de los filtros activos, cada una con su X, y "Limpiar filtros". */
function FichasFiltros({ filtros, setFiltros }: { filtros: Filtros; setFiltros: (f: Filtros) => void }) {
  const fichas = [
    ...(filtros.borrados ? [{ clave: "borrados", texto: "Borrados grandes", quitar: () => setFiltros({ ...filtros, borrados: false }) }] : []),
    ...[...filtros.tipos].map((t) => ({ clave: t, texto: PLURAL_TIPO[t], quitar: () => { const n = new Set(filtros.tipos); n.delete(t); setFiltros({ ...filtros, tipos: n }) } })),
    ...[...filtros.editores].map((k) => ({ clave: k, texto: NOMBRE_EDITOR[k], quitar: () => { const n = new Set(filtros.editores); n.delete(k); setFiltros({ ...filtros, editores: n }) } })),
  ]
  return (
    <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2">
      {fichas.map((f) => (
        <span key={f.clave} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs">
          {f.texto}
          <button type="button" onClick={f.quitar} aria-label={`Quitar filtro ${f.texto}`} className="inline-flex size-[18px] items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"><X className="size-3" aria-hidden /></button>
        </span>
      ))}
      <button type="button" onClick={() => setFiltros(SIN_FILTROS)} className="px-1.5 text-xs text-muted-foreground underline underline-offset-[3px] hover:text-foreground">Limpiar filtros</button>
    </div>
  )
}

function hace(iso: string, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (s < 60) return `hace ${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`
}

export default function VivoPage() {
  const [data, setData] = useState<Vivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloj, setReloj] = useState(Date.now())
  const { wiki, wikis, etiqueta } = useWiki()
  const [metrica, setMetrica] = useState<MetricaVivo | null>(null)

  // Consulta la API cada pocos segundos mientras la página está abierta.
  useEffect(() => {
    setData(null)
    setError(null)
    let vigente = true
    let enCurso = false
    const cargar = () => {
      if (enCurso) return
      enCurso = true
      return api<Vivo>(`/api/vivo?minutos=30&wiki=${wiki}`)
        .then((d) => {
          if (!vigente) return
          setData(d)
          setError(null)
        })
        .catch((e: Error) => vigente && setError(e.message))
        .finally(() => { enCurso = false })
    }
    cargar()
    const t = setInterval(cargar, REFRESCO_MS)
    const r = setInterval(() => setReloj(Date.now()), 1000)
    return () => { vigente = false; clearInterval(t); clearInterval(r) }
  }, [wiki])

  const serie = useMemo(() => {
    const m = new Map<string, { t: string; enwiki: number; eswiki: number }>()
    for (const p of data?.por_minuto ?? []) {
      const f = m.get(p.t) ?? { t: p.t, enwiki: 0, eswiki: 0 }
      if (p.wiki === "enwiki" || p.wiki === "eswiki") f[p.wiki] += p.eventos
      m.set(p.t, f)
    }
    return [...m.values()].sort((a, b) => a.t.localeCompare(b.t))
  }, [data])

  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS)
  const hayFiltros = filtros.tipos.size > 0 || filtros.editores.size > 0 || filtros.borrados
  // Con «Borrados grandes» se usa la lista aparte que trae la API: entre los últimos 100 eventos casi nunca hay uno.
  const filtrados = useMemo(() => ((filtros.borrados ? data?.borrados : data?.ultimos) ?? []).filter((e) => cumpleFiltros(e, filtros)), [data, filtros])
  const visibles = filtrados.slice(0, MOSTRAR)
  // El modal navega sobre la lista que se veía al abrirlo: la lista en vivo sigue cambiando cada 4 s.
  const [abierto, setAbierto] = useState<string | null>(null)
  const [listaModal, setListaModal] = useState<EventoResumen[]>([])
  const abrir = (id: string) => { setListaModal(visibles); setAbierto(id) }

  const reciente = data?.metricas.actual
  const previo = data?.metricas.anterior

  return (
    <>
      <Header ruta={["Panel", "En vivo"]} />
      <Pagina titulo="En vivo" descripcion={`${etiqueta} · cambios recientes de Wikipedia. Se actualiza cada 4 segundos.`}>
        {error && <p className="text-sm text-red-700 dark:text-red-400">No se pudo actualizar: {error}</p>}
        <div className="space-y-1"><h2 className="text-base font-semibold">Últimos 5 minutos</h2><p className="text-sm text-muted-foreground">Comparado con los 5 min anteriores · datos provisionales.</p></div>
        <TarjetasVivo actual={reciente} anterior={previo} onAbrir={setMetrica} />

        <Seccion titulo="Eventos por minuto" descripcion="Últimos 30 minutos · barras apiladas por wiki · el minuto en curso todavía se está llenando" accion={<Leyenda items={wikis.map((w) => ({ nombre: w, color: COLOR[w as "enwiki"] }))} />}>
          {!data ? <Cargando alto={240} /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={serie} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="15%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="t" tickFormatter={(t) => horaLocal(t, false)} tickLine={false} axisLine={false} minTickGap={40} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={40} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip cursor={{ fill: "var(--muted)" }} labelFormatter={(t) => `${horaLocal(String(t), false)} UTC−5`} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                {wikis.includes("enwiki") && <Bar dataKey="enwiki" stackId="a" fill={COLOR.enwiki} isAnimationActive={false} />}
                {wikis.includes("eswiki") && <Bar dataKey="eswiki" stackId="a" fill={COLOR.eswiki} radius={[2, 2, 0, 0]} isAnimationActive={false} />}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo="Últimos eventos"
          descripcion={!data ? "Llegan del stream de Wikipedia y se guardan en MongoDB en unos 2 segundos" : hayFiltros
            ? filtros.borrados
              ? `${entero(filtrados.length)} borrados grandes en los últimos 30 minutos · haz clic en uno para ver su detalle`
              : `${entero(filtrados.length)} de ${entero(data.ultimos.length)} eventos recientes con estos filtros · haz clic en uno para ver su detalle`
            : "Llegan del stream de Wikipedia y se guardan en MongoDB en unos 2 segundos · haz clic en un evento para ver su detalle"}
          accion={<MenuFiltros filtros={filtros} setFiltros={setFiltros} />}>
          {hayFiltros && <FichasFiltros filtros={filtros} setFiltros={setFiltros} />}
          {!data ? <Cargando alto={400} /> : visibles.length === 0 ? (
            <Vacio titulo="Sin eventos con estos filtros" texto="Prueba quitando algún filtro o espera a que lleguen más eventos." />
          ) : (
            <ul className="-mx-6 flex flex-col border-y" aria-live="polite">
              {visibles.map((e) => {
                const t = tipoEvento(e)
                return (
                  <li key={e._id} className="border-b last:border-b-0">
                    <button type="button" onClick={() => abrir(e._id)}
                      className={cn("group grid w-full grid-cols-[56px_minmax(0,1fr)_96px_16px] items-center gap-4 px-6 py-2.5 text-left transition-colors duration-700 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none")}>
                      <span className="text-xs text-muted-foreground tabular-nums">{hace(e.fecha, reloj).replace("hace ", "")}</span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium decoration-muted-foreground/60 underline-offset-[3px] group-hover:underline" title={e.titulo}>{e.titulo}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {wiki === "ambas" && <span className="rounded border px-1 py-px font-mono text-[10px] font-medium">{e.wiki === "eswiki" ? "ES" : "EN"}</span>}
                          <span>{NOMBRE_TIPO[t]}</span>
                          <span className="text-muted-foreground/60" aria-hidden>·</span>
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorTipo(e.tipo_editor) }} aria-hidden />
                          <span className="truncate text-foreground/75">{e.editor}</span>
                        </span>
                      </span>
                      <span className={cn("text-right font-mono text-[13px] tabular-nums",
                        e.delta_bytes == null ? "text-muted-foreground/60" : e.delta_bytes > 0 ? "font-medium text-green-700 dark:text-green-400" : e.delta_bytes < 0 ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                        {e.delta_bytes == null ? "—" : `${e.delta_bytes > 0 ? "+" : e.delta_bytes < 0 ? "−" : ""}${entero(Math.abs(e.delta_bytes))} B`}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {data && (
            <div className="-mb-1 flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
              <span className="flex flex-wrap items-center gap-3.5">
                {(["registrado", "temporal", "bot"] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: colorTipo(k) }} />{k === "temporal" ? "cuenta temporal" : k}</span>
                ))}
              </span>
              <span>Mostrando {entero(visibles.length)} {hayFiltros ? "eventos filtrados" : "eventos más recientes"}</span>
            </div>
          )}
        </Seccion>
      </Pagina>
      {metrica && data && (
        <ModalMetrica m={metricaVivo(metrica, data, etiqueta)}
          anterior={{ nombre: NOMBRE_METRICA[ORDEN_VIVO[(ORDEN_VIVO.indexOf(metrica) + 3) % 4]], ir: () => setMetrica(ORDEN_VIVO[(ORDEN_VIVO.indexOf(metrica) + 3) % 4]) }}
          siguiente={{ nombre: NOMBRE_METRICA[ORDEN_VIVO[(ORDEN_VIVO.indexOf(metrica) + 1) % 4]], ir: () => setMetrica(ORDEN_VIVO[(ORDEN_VIVO.indexOf(metrica) + 1) % 4]) }}
          onCerrar={() => setMetrica(null)} />
      )}
      <DetalleEvento id={abierto} lista={listaModal} mostrarWiki={wiki === "ambas"} hace={(iso) => hace(iso, reloj)} onCambiar={setAbierto} />
    </>
  )
}
