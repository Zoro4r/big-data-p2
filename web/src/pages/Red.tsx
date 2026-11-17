import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useTheme } from "next-themes"

import { Cargando, FilaBarra, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Base, ModalMetrica, type MetricaModal } from "@/components/modal-metrica"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, entero, intervaloLocal } from "@/lib/format"

interface Ranking { editor: string; tipo: string; reversiones: number }
interface Tarjetas {
  horas: number; inicio: string; fin: string; reversiones: number; editores_revertidos: number; revertidos_por_varios: number
  pares_agradecimiento: number; editores_agradecidos: number
}
interface Red {
  tarjetas: Tarjetas
  revertidos: (Ranking & { revertido_por: number })[]
  patrulleros: (Ranking & { editores_revertidos: number })[]
  conectados: { editor: string; tipo: string; coeditores: number }[]
}
interface Ego {
  centro: { user: string; tipo: string } | null
  relaciones: { origen: string; destino: string; tipo: string; peso: number; vecino: string; tipo_vecino: string }[]
}
type MetricaRed = "reversiones" | "varios" | "agradecidos"
const ORDEN_RED: MetricaRed[] = ["reversiones", "varios", "agradecidos"]

/** Anterior y siguiente (circular) para recorrer las tarjetas desde el modal. */
function vecinos<T>(lista: T[], actual: T, nombre: (x: T) => string, ir: (x: T) => void) {
  const i = lista.indexOf(actual), n = lista.length
  const a = lista[(i - 1 + n) % n], s = lista[(i + 1) % n]
  return { anterior: { nombre: nombre(a), ir: () => ir(a) }, siguiente: { nombre: nombre(s), ir: () => ir(s) } }
}

/** Detalle de las tres tarjetas de las últimas 24 horas consolidadas. */
function metricaRed(k: MetricaRed, t: Tarjetas, etiqueta: string): MetricaModal {
  const comun = { etiqueta, momento: intervaloLocal(t.inicio, t.fin) }
  const grafo = <>Se calcula en <Base base="neo4j" /> al abrir la página, sobre las relaciones con actividad en las últimas {t.horas} horas.</>
  if (k === "reversiones") return {
    ...comun, titulo: "Reversiones detectadas", valor: entero(t.reversiones),
    datos: [["Editores revertidos", entero(t.editores_revertidos)]],
    definicion: "Ediciones que deshicieron el cambio de otro editor en las últimas 24 horas, y cuántos editores distintos fueron revertidos.",
    calculo: { texto: "Suma de las reversiones de cada hora (resumen_por_hora) · editores con al menos una relación REVIRTIO recibida en 24 h" },
    lectura: "Muestra cuánto se deshicieron cambios de otros editores. Por sí sola, una reversión no indica vandalismo ni explica el motivo del cambio.",
    origen: <>Las reversiones salen de <Base base="cassandra" />, ya sumadas por hora; los editores revertidos, de <Base base="neo4j" />.</>,
  }
  if (k === "varios") return {
    ...comun, titulo: "Editores revertidos por varios", valor: entero(t.revertidos_por_varios),
    datos: [["Editores revertidos", entero(t.editores_revertidos)]],
    definicion: "Editores a los que dos o más editores distintos les deshicieron cambios en las últimas 24 horas.",
    calculo: { codigo: "MATCH (a:Editor)-[r:REVIRTIO]->(b:Editor)\nWHERE r.ventana >= $desde AND r.ventana < $hasta\nWITH b, count(DISTINCT a) AS por\nRETURN sum(CASE WHEN por >= 2 THEN 1 ELSE 0 END)" },
    lectura: "Cuando varios patrulleros revierten a la misma cuenta, lo más probable es un vándalo persistente o un recién llegado que necesita orientación. Son los casos a revisar primero.",
    origen: grafo,
  }
  return {
    ...comun, titulo: "Editores que recibieron gracias", valor: entero(t.editores_agradecidos),
    datos: [["Pares que se agradecieron", entero(t.pares_agradecimiento)]],
    definicion: "Editores que recibieron al menos un agradecimiento (la función «agradecer» de Wikipedia) en las últimas 24 horas.",
    calculo: { codigo: "MATCH (a:Editor)-[r:AGRADECIO]->(b:Editor)\nWHERE r.ventana >= $desde AND r.ventana < $hasta\nRETURN count(DISTINCT b)" },
    lectura: "Señal de colaboración positiva: muestra a quién reconoce la comunidad por su trabajo.",
    origen: grafo,
  }
}

type Nodo = { id: string; tipo: string; centro: boolean; x?: number; y?: number }

function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(800)
  useEffect(() => {
    if (!ref.current) return
    const obs = new ResizeObserver(([e]) => setAncho(Math.floor(e.contentRect.width)))
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return { ref, ancho }
}

export default function RedPage() {
  const { wiki, etiqueta } = useWiki()
  const [metrica, setMetrica] = useState<MetricaRed | null>(null)
  // El canvas del grafo no lee variables CSS: colores según el tema activo
  const oscuro = useTheme().resolvedTheme === "dark"
  const lienzo = oscuro
    ? { fondo: "#18181b", enlace: "#52525b", borde: "#18181b", etiquetaFondo: "rgba(24,24,27,0.85)", texto: "#fafafa" }
    : { fondo: "#fafafa", enlace: "#a1a1aa", borde: "#ffffff", etiquetaFondo: "rgba(255,255,255,0.9)", texto: "#18181b" }
  const { data } = useApi<Red>(`/api/red?wiki=${wiki}`)
  const [busqueda, setBusqueda] = useState("")
  const [usuario, setUsuario] = useState<string | null>(null)
  const centro = usuario ?? data?.patrulleros[0]?.editor ?? null
  const ego = useApi<Ego>(centro ? `/api/red/ego/${encodeURIComponent(centro)}?limite=40&wiki=${wiki}` : null)
  const { ref, ancho } = useAncho<HTMLDivElement>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null)

  const grafo = useMemo(() => {
    if (!ego.data?.centro) return { nodes: [] as Nodo[], links: [] as { source: string; target: string; tipo: string; peso: number }[] }
    const nodos = new Map<string, Nodo>([[ego.data.centro.user, { id: ego.data.centro.user, tipo: ego.data.centro.tipo, centro: true }]])
    for (const r of ego.data.relaciones) if (!nodos.has(r.vecino)) nodos.set(r.vecino, { id: r.vecino, tipo: r.tipo_vecino, centro: false })
    return {
      nodes: [...nodos.values()],
      links: ego.data.relaciones.map((r) => ({ source: r.origen, target: r.destino, tipo: r.tipo, peso: r.peso })),
    }
  }, [ego.data])

  // Más repulsión y aristas más largas: con decenas de vecinos el grafo no queda amontonado.
  useEffect(() => {
    fg.current?.d3Force("charge")?.strength(-260)
    fg.current?.d3Force("link")?.distance(90)
    fg.current?.d3ReheatSimulation()
  }, [grafo])

  const buscar = (e: FormEvent) => {
    e.preventDefault()
    if (busqueda.trim()) setUsuario(busqueda.trim())
  }

  const t = data?.tarjetas
  return (
    <>
      <Header ruta={["Panel", "Red de editores"]} />
      <Pagina titulo="Red de editores" descripcion="Explora las relaciones entre editores y descubre quiénes colaboran, revierten cambios o reciben agradecimientos.">
        <Seccion titulo="Conexiones de un editor" descripcion={`Historial acumulado · ${etiqueta}. Arrastra los nodos, acerca con la rueda o pulsa un editor para ver sus conexiones.`}
          accion={
            <form onSubmit={buscar} className="flex gap-2">
              <Input aria-label="Editor" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={centro ?? "Nombre de usuario"} className="w-56" />
              <Button type="submit" variant="outline">Ver red</Button>
            </form>
          }>
          <div ref={ref} className="relative h-[480px] overflow-hidden rounded-lg border border-border bg-muted/50">
            {ego.cargando ? <Cargando alto={480} /> : !ego.data?.centro ? (
              <div className="p-6"><Vacio titulo="Editor no encontrado" texto="Revisa el nombre exacto (mayúsculas incluidas)." /></div>
            ) : (
              <ForceGraph2D
                ref={fg}
                onEngineStop={() => fg.current?.zoomToFit(400, 40)}
                width={ancho}
                height={480}
                graphData={grafo}
                backgroundColor={lienzo.fondo}
                cooldownTicks={120}
                linkColor={() => lienzo.enlace}
                linkWidth={(l) => 1 + Math.min((l as { peso: number }).peso, 10) / 4}
                linkDirectionalArrowLength={(l) => ((l as { tipo: string }).tipo === "COEDITA" ? 0 : 5)}
                linkDirectionalArrowRelPos={0.9}
                linkLabel={(l) => { const x = l as { tipo: string; peso: number }; return `${x.tipo} · ${x.peso}` }}
                onNodeClick={(n) => setUsuario(String((n as Nodo).id))}
                nodeCanvasObject={(n, ctx, escala) => {
                  const nodo = n as Nodo
                  const r = nodo.centro ? 9 : 5.5
                  ctx.beginPath()
                  ctx.arc(nodo.x ?? 0, nodo.y ?? 0, r, 0, 2 * Math.PI)
                  ctx.fillStyle = colorTipo(nodo.tipo)
                  ctx.fill()
                  ctx.lineWidth = 2 / escala
                  ctx.strokeStyle = lienzo.borde
                  ctx.stroke()
                  const fuente = (nodo.centro ? 13 : 11) / escala
                  ctx.font = `${nodo.centro ? 600 : 400} ${fuente}px Geist, system-ui, sans-serif`
                  ctx.textAlign = "center"
                  ctx.textBaseline = "top"
                  const w = ctx.measureText(nodo.id).width
                  ctx.fillStyle = lienzo.etiquetaFondo
                  ctx.fillRect((nodo.x ?? 0) - w / 2 - 2 / escala, (nodo.y ?? 0) + r + 2 / escala, w + 4 / escala, fuente + 2 / escala)
                  ctx.fillStyle = lienzo.texto
                  ctx.fillText(nodo.id, nodo.x ?? 0, (nodo.y ?? 0) + r + 3 / escala)
                }}
                nodePointerAreaPaint={(n, color, ctx) => {
                  const nodo = n as Nodo
                  ctx.fillStyle = color
                  ctx.beginPath()
                  ctx.arc(nodo.x ?? 0, nodo.y ?? 0, 10, 0, 2 * Math.PI)
                  ctx.fill()
                }}
              />
            )}
            <div className="absolute bottom-3 left-3 rounded-lg border bg-card px-3 py-1.5">
              <Leyenda items={[{ nombre: "registrado", color: COLOR.registrado }, { nombre: "cuenta temporal", color: COLOR.temporal }, { nombre: "bot", color: COLOR.bot }]} />
            </div>
          </div>
        </Seccion>

        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Últimas 24 horas consolidadas · {etiqueta}</h2>
            {t && <p className="text-sm text-muted-foreground">{intervaloLocal(t.inicio, t.fin)}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {!t ? Array.from({ length: 3 }, (_, i) => <Cargando key={i} alto={160} />) : (
              <>
                <TarjetaKpi etiqueta="Reversiones detectadas" valor={entero(t.reversiones)} pie={`Deshicieron cambios de ${entero(t.editores_revertidos)} editores`} onAbrir={() => setMetrica("reversiones")} />
                <TarjetaKpi etiqueta="Editores revertidos por varios" valor={entero(t.revertidos_por_varios)} pie="Por 2 o más editores distintos" onAbrir={() => setMetrica("varios")} />
                <TarjetaKpi etiqueta="Editores que recibieron gracias" valor={entero(t.editores_agradecidos)} pie="Al menos un agradecimiento recibido" onAbrir={() => setMetrica("agradecidos")} />
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Seccion titulo="Editores más revertidos" descripcion={`Reversiones recibidas en todo el historial de ${etiqueta}`}>
            {!data ? <Cargando alto={260} /> : (
              <div className="flex flex-col gap-2.5">
                {data.revertidos.map((r) => (
                  <button key={r.editor} type="button" onClick={() => setUsuario(r.editor)} className="rounded-md text-left hover:bg-muted/50" title={`Revertido por ${r.revertido_por} editor(es) · ver su red`}>
                    <FilaBarra nombre={r.editor} valor={r.reversiones} max={data.revertidos[0].reversiones} color={colorTipo(r.tipo)} mono />
                  </button>
                ))}
              </div>
            )}
          </Seccion>
          <Seccion titulo="Patrulleros más activos" descripcion={`Reversiones hechas en todo el historial de ${etiqueta}`}>
            {!data ? <Cargando alto={260} /> : (
              <div className="flex flex-col gap-2.5">
                {data.patrulleros.map((r) => (
                  <button key={r.editor} type="button" onClick={() => setUsuario(r.editor)} className="rounded-md text-left hover:bg-muted/50" title={`Revirtió a ${r.editores_revertidos} editor(es) · ver su red`}>
                    <FilaBarra nombre={r.editor} valor={r.reversiones} max={data.patrulleros[0].reversiones} color={colorTipo(r.tipo)} mono />
                  </button>
                ))}
              </div>
            )}
          </Seccion>
          <Seccion titulo="Editores más conectados" descripcion={`Coeditores humanos distintos en todo el historial de ${etiqueta}`}>
            {!data ? <Cargando alto={260} /> : data.conectados.length === 0 ? <Vacio titulo="Sin datos" texto="No hay conexiones de coedición registradas." /> : (
              <div className="flex flex-col gap-2.5">
                {data.conectados.map((r) => (
                  <button key={r.editor} type="button" onClick={() => setUsuario(r.editor)} className="rounded-md text-left hover:bg-muted/50" title={`Comparte páginas con ${entero(r.coeditores)} editores · ver su red`}>
                    <FilaBarra nombre={r.editor} valor={r.coeditores} max={data.conectados[0].coeditores} color={colorTipo(r.tipo)} mono />
                  </button>
                ))}
              </div>
            )}
          </Seccion>
        </div>


      </Pagina>
      {metrica && t && (
        <ModalMetrica m={metricaRed(metrica, t, etiqueta)}
          {...vecinos(ORDEN_RED, metrica, (k) => metricaRed(k, t, etiqueta).titulo, setMetrica)} onCerrar={() => setMetrica(null)} />
      )}
    </>
  )
}
