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
import { COLOR, colorTipo, entero, horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Vivo {
  ahora: string
  eventos_ultimo_minuto: number
  por_minuto: { wiki: string; t: string; eventos: number; ediciones: number; eventos_bot: number; reversiones: number }[]
  ultimos: EventoResumen[]
  /** Cambios que borraron más de BORRADO_GRANDE bytes en la ventana. */
  borrados: EventoResumen[]
  stream: { ultimo_evento: string | null; actualizado: string | null }
}

const REFRESCO_MS = 4000
const MOSTRAR = 25

/** Tarjetas de En vivo que abren su detalle. */
type MetricaVivo = "eps" | "ult30" | "bots" | "rev"
const ORDEN_VIVO: MetricaVivo[] = ["eps", "ult30", "bots", "rev"]
const NOMBRE_METRICA: Record<MetricaVivo, string> = { eps: "Eventos por segundo", ult30: "Últimos 30 minutos", bots: "Hechos por bots", rev: "Reversiones" }

/** Definición y datos de cada tarjeta de En vivo, a partir de la serie por minuto de Cassandra. */
function metricaVivo(k: MetricaVivo, d: Vivo, etiqueta: string): MetricaModal {
  const porMinuto = new Map<string, { eventos: number; bots: number; rev: number; ediciones: number }>()
  for (const p of d.por_minuto) {
    const f = porMinuto.get(p.t) ?? { eventos: 0, bots: 0, rev: 0, ediciones: 0 }
    f.eventos += p.eventos; f.bots += p.eventos_bot; f.rev += p.reversiones; f.ediciones += p.ediciones
    porMinuto.set(p.t, f)
  }
  const minutos = [...porMinuto.entries()].sort(([a], [b]) => a.localeCompare(b))
  const sum = (c: "eventos" | "bots" | "rev" | "ediciones") => minutos.reduce((s, [, f]) => s + f[c], 0)
  const ev = sum("eventos"), bots = sum("bots"), rev = sum("rev"), ediciones = sum("ediciones")
  const pico = (c: "eventos" | "rev") => minutos.reduce((a, b) => (b[1][c] > a[1][c] ? b : a), minutos[0])
  const hora = (t: string) => horaLocal(t, false)
  const desde = `hace ${minutos.length} min`
  const enCassandra = <>El servicio de streaming suma cada evento por minuto en <Base base="cassandra" /> (tabla eventos_por_minuto) y aquí se suman los últimos 30 minutos.</>
  const comun = { etiqueta, momento: "Últimos 30 minutos · se actualiza cada 4 s" }

  if (k === "eps") return {
    ...comun, titulo: NOMBRE_METRICA.eps, momento: "Último minuto · se actualiza cada 4 s",
    valor: (d.eventos_ultimo_minuto / 60).toFixed(1), nota: `${entero(d.eventos_ultimo_minuto)} eventos en el último minuto`,
    serie: { valores: minutos.map(([, f]) => f.eventos / 60), desde },
    datos: [["Promedio 30 min", `${minutos.length ? (ev / (minutos.length * 60)).toFixed(1) : "—"} por segundo`],
      ["Minuto más activo", minutos.length ? `${entero(pico("eventos")[1].eventos)} · ${hora(pico("eventos")[0])}` : "—"]],
    definicion: "Ritmo actual del stream: cuántos eventos de Wikipedia se guardan por segundo.",
    calculo: { fraccion: ["eventos guardados en el último minuto", "60 segundos"] },
    lectura: "Muestra qué tan activa está Wikipedia en este momento. Varía con la hora del día y sube con noticias o con bots que trabajan en lote.",
    origen: <>Se cuenta en <Base base="mongo" /> (colección events) cada vez que se actualiza la página.</>,
  }
  if (k === "ult30") return {
    ...comun, titulo: NOMBRE_METRICA.ult30, valor: entero(ev), nota: `eventos de ${etiqueta}`,
    serie: { valores: minutos.map(([, f]) => f.eventos), desde },
    datos: [["Promedio por minuto", minutos.length ? entero(ev / minutos.length) : "—"],
      ["Minuto más activo", minutos.length ? `${entero(pico("eventos")[1].eventos)} · ${hora(pico("eventos")[0])}` : "—"],
      ["Ediciones", entero(ediciones)]],
    definicion: "Eventos guardados por la capa de streaming en los últimos 30 minutos: ediciones, páginas nuevas, categorizaciones y registros.",
    calculo: { texto: "Σ eventos por minuto de los últimos 30 minutos" },
    lectura: "Volumen reciente de actividad. Sirve para comparar con la hora consolidada que muestra el Resumen.",
    origen: enCassandra,
  }
  if (k === "bots") return {
    ...comun, titulo: NOMBRE_METRICA.bots, valor: ev ? `${((bots / ev) * 100).toFixed(1)} %` : "—", nota: `${entero(bots)} eventos en 30 min`,
    serie: { valores: minutos.map(([, f]) => (f.eventos ? (f.bots / f.eventos) * 100 : 0)), desde },
    datos: [["Eventos de bots", entero(bots)], ["Eventos humanos", entero(ev - bots)]],
    definicion: "Porcentaje de los eventos de los últimos 30 minutos hechos por bots.",
    calculo: { fraccion: ["eventos de bots", "total de eventos", "× 100"] },
    lectura: "Cuánto del trabajo reciente hacen bots (marca bot=true o «bot» en el nombre). Sube cuando un bot procesa muchas páginas seguidas.",
    origen: enCassandra,
  }
  return {
    ...comun, titulo: NOMBRE_METRICA.rev, valor: entero(rev), nota: "en los últimos 30 minutos",
    serie: { valores: minutos.map(([, f]) => f.rev), desde },
    datos: [["Por cada 100 ediciones", ediciones ? ((rev / ediciones) * 100).toFixed(2) : "—"],
      ["Minuto con más", minutos.length ? `${entero(pico("rev")[1].rev)} · ${hora(pico("rev")[0])}` : "—"]],
    definicion: "Ediciones de los últimos 30 minutos que deshacen el trabajo de otro editor.",
    calculo: { texto: "Σ reversiones por minuto de los últimos 30 minutos" },
    lectura: "Señal de vandalismo o de conflicto entre editores. Los picos suelen ser patrulleros o bots antivandalismo revirtiendo varias ediciones seguidas.",
    origen: enCassandra,
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
    let vigente = true
    const cargar = () =>
      api<Vivo>(`/api/vivo?minutos=30&wiki=${wiki}`)
        .then((d) => {
          if (!vigente) return
          setData(d)
          setError(null)
        })
        .catch((e: Error) => vigente && setError(e.message))
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

  const tot = useMemo(() => {
    const p = data?.por_minuto ?? []
    const ev = p.reduce((s, x) => s + x.eventos, 0)
    return { ev, bots: p.reduce((s, x) => s + x.eventos_bot, 0), rev: p.reduce((s, x) => s + x.reversiones, 0) }
  }, [data])

  return (
    <>
      <Header ruta={["Panel", "En vivo"]} />
      <Pagina titulo="En vivo" descripcion="Capa rápida del pipeline: el servicio de streaming guarda cada edición de enwiki y eswiki en segundos (MongoDB y Cassandra). Esta página se actualiza sola cada 4 segundos; el grafo, los rankings y los KPIs se consolidan cada hora con Airflow.">
        {error && <p className="text-sm text-red-700 dark:text-red-400">No se pudo actualizar: {error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : (
            <>
              <TarjetaKpi etiqueta="Eventos por segundo" valor={(data.eventos_ultimo_minuto / 60).toFixed(1)} pie={`${entero(data.eventos_ultimo_minuto)} en el último minuto`} onAbrir={() => setMetrica("eps")} />
              <TarjetaKpi etiqueta="Últimos 30 minutos" valor={entero(tot.ev)} pie={`eventos de ${etiqueta}`} onAbrir={() => setMetrica("ult30")} />
              <TarjetaKpi etiqueta="Hechos por bots" valor={tot.ev ? `${((tot.bots / tot.ev) * 100).toFixed(1)} %` : "—"} pie={`${entero(tot.bots)} eventos en 30 min`} onAbrir={() => setMetrica("bots")} />
              <TarjetaKpi etiqueta="Reversiones" valor={entero(tot.rev)} pie="en los últimos 30 minutos" onAbrir={() => setMetrica("rev")} />
            </>
          )}
        </div>

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
