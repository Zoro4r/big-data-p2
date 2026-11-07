import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useTheme } from "next-themes"

import { Cargando, FilaBarra, Leyenda, Seccion, TarjetaKpi, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Base, ModalMetrica, type MetricaModal } from "@/components/modal-metrica"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { COLOR, colorTipo, entero, horaUTC } from "@/lib/format"

interface Ranking { editor: string; tipo: string; reversiones: number }
interface Red {
  conteo: { nodos: Record<string, number>; relaciones: Record<string, number>; ventana?: string } | null
  revertidos: (Ranking & { revertido_por: number })[]
  patrulleros: (Ranking & { editores_revertidos: number })[]
  disputadas: { pagina: string; wiki: string; titulo: string; editores: number; humanos: number; ediciones: number }[]
}
interface Ego {
  centro: { user: string; tipo: string } | null
  relaciones: { origen: string; destino: string; tipo: string; peso: number; vecino: string; tipo_vecino: string }[]
}
type MetricaRed = "editores" | "ediciones" | "reversiones" | "colaboracion"
const ORDEN_RED: MetricaRed[] = ["editores", "ediciones", "reversiones", "colaboracion"]

/** Anterior y siguiente (circular) para recorrer las tarjetas desde el modal. */
function vecinos<T>(lista: T[], actual: T, nombre: (x: T) => string, ir: (x: T) => void) {
  const i = lista.indexOf(actual), n = lista.length
  const a = lista[(i - 1 + n) % n], s = lista[(i + 1) % n]
  return { anterior: { nombre: nombre(a), ir: () => ir(a) }, siguiente: { nombre: nombre(s), ir: () => ir(s) } }
}

/** Detalle de cada total del grafo: qué cuenta, con qué consulta Cypher y de dónde sale. */
function metricaRed(k: MetricaRed, c: NonNullable<Red["conteo"]>, etiqueta: string): MetricaModal {
  const porWiki = Boolean(c.ventana)
  const n = (x: string) => entero(c.nodos[x]), r = (x: string) => entero(c.relaciones[x])
  const momento = porWiki ? `Al lote de ${horaUTC(c.ventana!)} UTC` : "Grafo acumulado desde el 31 oct"
  const origen = porWiki
    ? <>Lo calcula el DAG cada hora en <Base base="neo4j" /> y lo guarda en <Base base="mongo" /> (pipeline_runs), porque recorrer todas las páginas de una wiki toma unos segundos.</>
    : <>Se cuenta en <Base base="neo4j" /> al abrir la página, con los contadores internos del grafo.</>
  const comun = { etiqueta, momento, origen }
  if (k === "editores") return {
    ...comun, titulo: "Editores", valor: n("Editor"), nota: "nodos (:Editor)",
    datos: [["Páginas", n("Pagina")], ["Categorías", n("Categoria")]],
    definicion: "Editores distintos del grafo: personas registradas, cuentas temporales y bots que hicieron al menos un evento desde que empezó la recolección.",
    calculo: { codigo: porWiki ? "MATCH (:Wiki {nombre: $wiki})<-[:PERTENECE_A]-(:Pagina)<-[:EDITO]-(e:Editor) RETURN count(DISTINCT e)" : "MATCH (e:Editor) RETURN count(e)" },
    lectura: "Tamaño de la comunidad observada. Crece cada hora con los editores que aparecen por primera vez.",
  }
  if (k === "ediciones") return {
    ...comun, titulo: "Ediciones", valor: r("EDITO"), nota: "relaciones -[:EDITO]->",
    datos: [["Páginas creadas", r("CREO")], ["Páginas", n("Pagina")]],
    definicion: "Pares editor–página distintos: si un editor modifica la misma página varias veces, es una sola relación EDITO que guarda cuántas ediciones hizo.",
    calculo: { codigo: "MATCH (:Editor)-[r:EDITO]->(:Pagina) RETURN count(r)" },
    lectura: "Cuántas conexiones hay entre editores y páginas. Es la base para medir páginas disputadas y coedición.",
  }
  if (k === "reversiones") return {
    ...comun, titulo: "Reversiones", valor: r("REVIRTIO"), nota: "relaciones -[:REVIRTIO]->",
    datos: [["Avisos (MENSAJE_A)", r("MENSAJE_A")], ["Bloqueos", r("BLOQUEO")]],
    definicion: "Pares de editores en que uno deshizo ediciones del otro. La relación guarda cuántas veces ocurrió.",
    calculo: { codigo: "MATCH (:Editor)-[r:REVIRTIO]->(:Editor) RETURN count(r)" },
    lectura: "Base para detectar vandalismo y guerras de ediciones: los rankings de abajo usan estas relaciones.",
  }
  if (c.relaciones.COEDITA == null) return {
    ...comun, titulo: "Agradecimientos", valor: r("AGRADECIO"), nota: "relaciones -[:AGRADECIO]->",
    datos: [],
    definicion: "Un editor agradeció una edición de otro con la función «agradecer» de Wikipedia.",
    calculo: { codigo: "MATCH (:Editor)-[r:AGRADECIO]->(:Editor) WHERE r.wiki = $wiki RETURN count(r)" },
    lectura: "Señal de colaboración positiva. COEDITA no guarda la wiki, por eso con una sola wiki se muestran los agradecimientos.",
  }
  return {
    ...comun, titulo: "Colaboración", valor: r("COEDITA"), nota: "relaciones -[:COEDITA]-",
    datos: [["Agradecimientos", r("AGRADECIO")]],
    definicion: "Pares de editores humanos que editaron al menos una misma página.",
    calculo: { codigo: "MATCH (:Editor)-[r:COEDITA]-(:Editor) RETURN count(r)" },
    lectura: "Red de colaboración: los editores con más coeditores son los más centrales de la comunidad.",
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
  const ego = useApi<Ego>(centro ? `/api/red/ego/${encodeURIComponent(centro)}?limite=40` : null)
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

  const c = data?.conteo
  return (
    <>
      <Header ruta={["Panel", "Red de editores"]} />
      <Pagina titulo="Red de editores" descripcion="Quién interactúa con quién: reversiones, avisos, agradecimientos y bloqueos entre editores. Aquí aparecen los patrulleros, el vandalismo y las páginas en disputa. El grafo en Neo4j tiene 4 tipos de nodo y 11 tipos de relación.">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {!data ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={120} />) : !c ? (
            <div className="col-span-full"><Vacio titulo="Totales por wiki pendientes" texto="Se calculan en la próxima ejecución del DAG." /></div>
          ) : (
            <>
              <TarjetaKpi etiqueta="Editores" titulo={c.ventana ? `Totales de ${etiqueta} al lote de ${horaUTC(c.ventana)} UTC` : undefined} valor={entero(c.nodos.Editor)} pie={`${entero(c.nodos.Pagina)} páginas · ${entero(c.nodos.Categoria)} categorías`} onAbrir={() => setMetrica("editores")} />
              <TarjetaKpi etiqueta="Ediciones" valor={entero(c.relaciones.EDITO)} pie={`${entero(c.relaciones.CREO)} páginas creadas`} onAbrir={() => setMetrica("ediciones")} />
              <TarjetaKpi etiqueta="Reversiones" valor={entero(c.relaciones.REVIRTIO)} pie={`${entero(c.relaciones.MENSAJE_A)} avisos · ${entero(c.relaciones.BLOQUEO)} bloqueos`} onAbrir={() => setMetrica("reversiones")} />
              {c.relaciones.COEDITA != null
                ? <TarjetaKpi etiqueta="Colaboración" valor={entero(c.relaciones.COEDITA)} pie={`${entero(c.relaciones.AGRADECIO)} agradecimientos`} onAbrir={() => setMetrica("colaboracion")} />
                : <TarjetaKpi etiqueta="Agradecimientos" valor={entero(c.relaciones.AGRADECIO)} pie="COEDITA no distingue wiki" onAbrir={() => setMetrica("colaboracion")} />}
            </>
          )}
        </div>

        <Seccion titulo="Conexiones de un editor" descripcion={centro ? `Vecindario de ${centro}: arrastra los nodos, usa la rueda para acercar y haz clic en un vecino para explorarlo` : ""}
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Seccion titulo="Editores más revertidos" descripcion={`Reversiones recibidas en ${etiqueta} · posible vandalismo`}>
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
          <Seccion titulo="Patrulleros más activos" descripcion={`Reversiones hechas en ${etiqueta} · humanos y bots antivandalismo`}>
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
        </div>

        <Seccion titulo="Páginas más disputadas" descripcion={`${etiqueta} · editadas en las últimas 24 h · ordenadas por editores distintos en toda su historia`}>
          {!data ? <Cargando alto={260} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Página</TableHead><TableHead>Wiki</TableHead><TableHead className="w-[30%]">Editores distintos</TableHead><TableHead className="text-right">Humanos</TableHead><TableHead className="text-right">Ediciones</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.disputadas.map((p) => (
                  <TableRow key={p.pagina}>
                    <TableCell className="max-w-80 truncate font-medium" title={p.titulo}>{p.titulo}</TableCell>
                    <TableCell><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLOR[p.wiki as "enwiki"] ?? COLOR.otro }} />{p.wiki}</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/75" style={{ width: `${(p.editores / data.disputadas[0].editores) * 100}%` }} /></div>
                        <span className="w-6 text-right tabular-nums">{p.editores}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.humanos}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.ediciones}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Seccion>
      </Pagina>
      {metrica && c && (
        <ModalMetrica m={metricaRed(metrica, c, etiqueta)}
          {...vecinos(ORDEN_RED, metrica, (k) => metricaRed(k, c, etiqueta).titulo, setMetrica)} onCerrar={() => setMetrica(null)} />
      )}
    </>
  )
}
