import { useEffect, useMemo, useRef, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Undo2 } from "lucide-react"

import { Cargando, Leyenda, Seccion, TarjetaKpi } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, entero, horaUTC } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Vivo {
  ahora: string
  eventos_ultimo_minuto: number
  por_minuto: { wiki: string; t: string; eventos: number; ediciones: number; eventos_bot: number; reversiones: number }[]
  ultimos: { _id: string; fecha: string; wiki: string; tipo: string; titulo: string; editor: string; tipo_editor: string; delta_bytes: number | null; revierte_a: string | null }[]
  stream: { ultimo_evento: string | null; actualizado: string | null }
}

const REFRESCO_MS = 4000

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
  const vistos = useRef<Set<string>>(new Set())
  const [nuevos, setNuevos] = useState<Set<string>>(new Set())

  // Consulta la API cada pocos segundos mientras la página está abierta.
  useEffect(() => {
    let vigente = true
    vistos.current = new Set()  // al cambiar de wiki no se resaltan como nuevas las ya existentes
    const cargar = () =>
      api<Vivo>(`/api/vivo?minutos=30&wiki=${wiki}`)
        .then((d) => {
          if (!vigente) return
          const frescos = new Set(d.ultimos.filter((e) => vistos.current.size > 0 && !vistos.current.has(e._id)).map((e) => e._id))
          d.ultimos.forEach((e) => vistos.current.add(e._id))
          setNuevos(frescos)
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
              <TarjetaKpi etiqueta="Eventos por segundo" valor={(data.eventos_ultimo_minuto / 60).toFixed(1)} pie={`${entero(data.eventos_ultimo_minuto)} en el último minuto`} ruta={["mongo"]} />
              <TarjetaKpi etiqueta="Últimos 30 minutos" valor={entero(tot.ev)} pie={`eventos de ${etiqueta}`} ruta={["cassandra"]} />
              <TarjetaKpi etiqueta="Hechos por bots" valor={tot.ev ? `${((tot.bots / tot.ev) * 100).toFixed(1)} %` : "—"} pie={`${entero(tot.bots)} eventos en 30 min`} ruta={["cassandra"]} />
              <TarjetaKpi etiqueta="Reversiones" valor={entero(tot.rev)} pie="en los últimos 30 minutos" ruta={["cassandra"]} />
            </>
          )}
        </div>

        <Seccion titulo="Pulso por minuto" descripcion="Últimos 30 minutos · el minuto en curso todavía se está llenando" accion={<Leyenda items={wikis.map((w) => ({ nombre: w, color: COLOR[w as "enwiki"] }))} />}>
          {!data ? <Cargando alto={240} /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={serie} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="t" tickFormatter={(t) => horaUTC(t, false)} tickLine={false} axisLine={false} minTickGap={40} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} width={40} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip labelFormatter={(t) => `${horaUTC(String(t), false)} UTC`} contentStyle={{ borderRadius: 8, fontSize: 12, background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} formatter={(v: number, n: string) => [entero(v), n]} />
                {wikis.includes("enwiki") && <Area type="monotone" dataKey="enwiki" stackId="a" stroke={COLOR.enwiki} fill={COLOR.enwiki} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />}
                {wikis.includes("eswiki") && <Area type="monotone" dataKey="eswiki" stackId="a" stroke={COLOR.eswiki} fill={COLOR.eswiki} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Seccion>

        <Seccion titulo="Últimas ediciones" descripcion="Llegan del stream de Wikipedia y se guardan en MongoDB en ~2 segundos · las nuevas se resaltan">
          {!data ? <Cargando alto={400} /> : (
            <ul className="flex flex-col divide-y divide-zinc-100" aria-live="polite">
              {data.ultimos.map((e) => (
                <li key={e._id} className={cn("grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2.5 text-[13px] transition-colors duration-1000", nuevos.has(e._id) ? "bg-blue-50 dark:bg-blue-950/40" : "bg-transparent")}>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{hace(e.fecha, reloj)}</span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR[e.wiki as "enwiki"] ?? COLOR.otro }} title={e.wiki} />
                      <span className="truncate font-medium" title={e.titulo}>{e.titulo}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorTipo(e.tipo_editor) }} />
                      <span className="truncate">{e.editor}</span>
                      <span>· {e.tipo}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.revierte_a && (
                      <Badge variant="outline" className="gap-1 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"><Undo2 className="size-3" aria-hidden />revierte a {e.revierte_a}</Badge>
                    )}
                    {e.tipo_editor === "bot" && <Badge variant="outline" className="border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">bot</Badge>}
                    {e.delta_bytes != null && (
                      <span className={cn("w-16 text-right font-mono text-xs tabular-nums", e.delta_bytes < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>{e.delta_bytes > 0 ? "+" : ""}{entero(e.delta_bytes)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </Pagina>
    </>
  )
}
