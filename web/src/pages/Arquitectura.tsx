import { useState, type ReactNode } from "react"
import { ArrowUpRight, Braces, ChevronLeft, ChevronRight, Cloud, PanelsTopLeft, Radio, RefreshCw, Workflow, Zap } from "lucide-react"

import { Cargando } from "@/components/common"
import { resaltar } from "@/components/crear-evento"
import { LogoBase, type Base } from "@/components/fuente"
import { Header, Pagina } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApi } from "@/lib/api"
import { entero, horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Arquitectura del proyecto: el diagrama del flujo es la página y cada componente abre un modal con su detalle
 *  (los datos que llegan, cómo se procesan y qué guarda cada base). Las cifras vienen de /api/arquitectura. */

interface Ejecucion { ventana: string; extraidos: number; validos: number; rechazados: number; calidad_pct: number; segundos_extraccion: number; fuente: string | null }
interface Datos {
  mongo: { eventos: number; desde: string | null; tamano_bytes: number; disco_bytes: number; indices: string[] }
  ritmo: { promedio_hora: number | null; min_hora: number | null; max_hora: number | null; horas: number }
  calidad_pct: number | null
  tipos_24h: Record<string, number>
  dag: { corridas: number; ultimas: Ejecucion[] }
  grafo: { nodos: Record<string, number>; relaciones: Record<string, number> }
  stream: { ultima_hora: string | null; stream_ultimo_evento: string | null }
}

type Id = "fuente" | "rapida" | "lotes" | "mongo" | "cassandra" | "neo4j" | "api" | "dashboard"
const ORDEN: Id[] = ["fuente", "rapida", "lotes", "mongo", "cassandra", "neo4j", "api", "dashboard"]

interface Caja { id: Id; titulo: string; oscura?: boolean; logo?: Base; etiqueta: string }
const CAJAS: Caja[] = [
  { id: "fuente", titulo: "Wikimedia EventStreams", oscura: true, etiqueta: "Los datos que llegan · origen, estructura y características" },
  { id: "rapida", titulo: "Capa rápida", etiqueta: "Servicio stream · eventos al instante" },
  { id: "lotes", titulo: "Capa por lotes", etiqueta: "El flujo de Airflow, paso a paso" },
  { id: "mongo", titulo: "MongoDB", logo: "mongo", etiqueta: "Almacenamiento · los eventos tal como llegan" },
  { id: "cassandra", titulo: "Cassandra", logo: "cassandra", etiqueta: "Almacenamiento · series de tiempo y KPIs" },
  { id: "neo4j", titulo: "Neo4j", logo: "neo4j", etiqueta: "Almacenamiento · la red de colaboración" },
  { id: "api", titulo: "API FastAPI", etiqueta: "Qué base consulta cada vista" },
  { id: "dashboard", titulo: "Dashboard", oscura: true, etiqueta: "Lo que estás viendo" },
]
const NOMBRE = Object.fromEntries(CAJAS.map((c) => [c.id, c.titulo])) as Record<Id, string>
const ICONOS_NODO: Partial<Record<Id, typeof Radio>> = { fuente: Radio, rapida: Zap, lotes: Workflow, api: Braces, dashboard: PanelsTopLeft }

const gb = (b?: number | null) => (b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`)
const millones = (n?: number | null) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : entero(n))
const hace = (iso?: string | null) => {
  if (!iso) return "—"
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  return s < 60 ? `hace ${Math.round(s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : horaLocal(iso)
}

function NodoArquitectura({ id, detalle, onAbrir, compact = false }: { id: Id; detalle: string; onAbrir: (id: Id) => void; compact?: boolean }) {
    const c = CAJAS.find((caja) => caja.id === id)!
    if (compact) {
      const Icono = ICONOS_NODO[id]
      return (
        <button type="button" onClick={() => onAbrir(id)} aria-label={`${c.titulo}: ver detalle`}
          className={cn("group relative flex h-[88px] w-full flex-col justify-center gap-1.5 rounded-xl border p-3 text-left transition-[border-color,box-shadow] hover:border-foreground/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            c.oscura ? "border-border bg-muted/40" : "border-border bg-card shadow-xs")}>
          <ArrowUpRight className="absolute right-2 top-2 size-2.5 text-muted-foreground/50 transition-colors group-hover:text-foreground" aria-hidden />
          <span className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/70">
              {c.logo ? <LogoBase base={c.logo} className="size-4" /> : Icono && <Icono className="size-4 text-foreground/75" strokeWidth={1.7} aria-hidden />}
            </span>
            <span className="text-[13px] font-semibold leading-4">{c.titulo}</span>
          </span>
          <span className="pl-[38px] text-[11px] leading-4 text-muted-foreground">{detalle}</span>
        </button>
      )
    }
    return (
      <button type="button" onClick={() => onAbrir(id)} aria-label={`${c.titulo}: ver detalle`}
        className={cn("relative flex w-full flex-col justify-center gap-1 rounded-xl border text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
          "min-h-20 p-4", c.oscura ? "border-foreground bg-foreground text-background" : "bg-card")}>
        <ArrowUpRight className="absolute right-3 top-3 size-3 opacity-40" aria-hidden />
        <span className="flex items-center gap-2 pr-3 text-sm font-semibold">{c.logo && <LogoBase base={c.logo} />}{c.titulo}</span>
        <span className={cn("text-xs", c.oscura ? "opacity-75" : "text-muted-foreground")}>{detalle}</span>
      </button>
    )
}

export function Diagrama({ onAbrir }: { onAbrir: (id: Id) => void }) {
  const nodo = (id: Id, detalle: string) => <NodoArquitectura id={id} detalle={detalle} onAbrir={onAbrir} />
  const flecha = <ChevronRight className="mx-auto size-5 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />
  return (
    <div className="space-y-6 rounded-xl border bg-card p-5 shadow-xs sm:p-6">
      <section className="space-y-3" aria-label="Flujo en vivo">
        <h2 className="text-sm font-semibold">En vivo · cada ~2 segundos</h2>
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1.25fr]">
          {nodo("fuente", "Envía eventos JSON")}{flecha}
          {nodo("rapida", "Valida los eventos y escribe dos resultados")}{flecha}
          <div className="space-y-2">
            {nodo("mongo", "Documento completo de cada evento")}
            {nodo("cassandra", "Conteos por minuto · provisionales")}
          </div>
        </div>
      </section>
      <section className="space-y-3 border-t pt-5" aria-label="Consolidación horaria">
        <h2 className="text-sm font-semibold">Consolidación · cada hora</h2>
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1.25fr]">
          {nodo("mongo", "Airflow lee los eventos de la hora completa")}{flecha}
          {nodo("lotes", "Valida, transforma y calcula indicadores")}{flecha}
          <div className="space-y-2">
            {nodo("cassandra", "Resúmenes y KPIs · corrige los minutos")}
            {nodo("neo4j", "Relaciones de esa hora entre editores y páginas")}
          </div>
        </div>
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Recuperación de una hora incompleta · Airflow la solicita a Wikimedia y guarda los eventos faltantes en MongoDB antes de consolidar.
        </p>
      </section>
      <section className="space-y-3 border-t pt-5" aria-label="Consulta del dashboard">
        <h2 className="text-sm font-semibold">Consulta y visualización</h2>
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1.25fr]">
          <div className="grid gap-1.5">
            {([ ["mongo", "MongoDB", "Eventos"], ["cassandra", "Cassandra", "Métricas"], ["neo4j", "Neo4j", "Relaciones"] ] as const).map(([id, nombre, descripcion]) => (
              <button key={id} type="button" onClick={() => onAbrir(id)} aria-label={`${nombre}: ver detalle`}
                className="flex min-h-8 items-center justify-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <LogoBase base={id} className="size-3.5" />
                <span className="font-semibold">{nombre}</span>
                <span className="text-muted-foreground">· {descripcion}</span>
              </button>
            ))}
          </div>
          {flecha}{nodo("api", "Consulta cada base según la vista")}{flecha}{nodo("dashboard", "En vivo, horas consolidadas e historial")}
        </div>
      </section>
    </div>
  )
}

const POSICIONES: { id: Id; x: number; y: number; w: number; detalle: string }[] = [
  { id: "fuente", x: 24, y: 286, w: 144, detalle: "JSON · SSE" },
  { id: "rapida", x: 216, y: 176, w: 168, detalle: "Ingesta continua" },
  { id: "lotes", x: 216, y: 396, w: 168, detalle: "Apache Airflow" },
  { id: "mongo", x: 448, y: 176, w: 168, detalle: "Eventos originales" },
  { id: "cassandra", x: 448, y: 356, w: 168, detalle: "Minutos y KPIs" },
  { id: "neo4j", x: 448, y: 496, w: 168, detalle: "Editores y páginas" },
  { id: "api", x: 696, y: 356, w: 152, detalle: "API de consultas" },
  { id: "dashboard", x: 896, y: 356, w: 144, detalle: "Interfaz web" },
]

const COLOR_CONEXION = { flujo: "#94a3b8", conteos: "#5b8fd1", recuperacion: "#9671c6" }
const LEYENDAS_ARQUITECTURA = [
  { texto: "Flujo y consultas", color: COLOR_CONEXION.flujo, discontinua: false },
  { texto: "Conteos por minuto", color: COLOR_CONEXION.conteos, discontinua: false },
  { texto: "Recuperación de horas incompletas", color: COLOR_CONEXION.recuperacion, discontinua: true },
]

export function ArquitecturaGeneral({ onAbrir }: { onAbrir: (id: Id) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs" role="region" aria-label="Arquitectura del sistema">
      <div className="overflow-x-auto">
        <div className="relative h-[640px] min-w-[1060px]">
          <div className="absolute left-[18.1%] right-[17.7%] top-6 bottom-6 rounded-2xl border bg-muted/15" />
          <div className="absolute left-[20.4%] right-[20%] top-11 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold"><Cloud className="size-4 text-muted-foreground" strokeWidth={1.7} aria-hidden />Google Cloud<span className="font-normal text-muted-foreground">· Máquina virtual</span></span>
            <span className="rounded-md border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">Docker Compose</span>
          </div>
          {([ [216, "Procesamiento"], [448, "Almacenamiento"], [696, "Consultas"] ] as const).map(([x, nombre]) => (
            <span key={nombre} className="absolute top-[116px] text-[11px] font-semibold tracking-wide text-muted-foreground" style={{ left: `${100 * x / 1060}%` }}>{nombre}</span>
          ))}
          <span className="absolute left-[2.3%] top-[254px] text-[11px] font-medium text-muted-foreground">Origen</span>
          <span className="absolute left-[84.5%] top-[324px] text-[11px] font-medium text-muted-foreground">Cliente web</span>
          <svg className="absolute inset-0 size-full" viewBox="0 0 1060 640" preserveAspectRatio="none" aria-hidden>
            <defs>
              <marker id="arquitectura-flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke" /></marker>
            </defs>
            <g style={{ color: COLOR_CONEXION.flujo }} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#arquitectura-flecha)">
              <path d="M168 316 H176 Q184 316 184 308 V228 Q184 220 192 220 H216" />
              <path d="M384 220 H448" />
              <path d="M532 264 V288 Q532 300 520 300 H420 Q408 300 408 312 V428 Q408 440 396 440 H384" />
              <path d="M384 412 H416 Q428 412 428 400 H448" />
              <path d="M384 464 H404 Q416 464 416 476 V528 Q416 540 428 540 H448" />
              <path d="M616 220 H644 Q656 220 656 232 V368 Q656 380 668 380 H696" />
              <path d="M616 400 H696" />
              <path d="M616 540 H644 Q656 540 656 528 V432 Q656 420 668 420 H696" />
              <path d="M848 400 H896" />
            </g>
            <path d="M300 264 V324 Q300 336 312 336 H520 Q532 336 532 348 V356" fill="none" stroke="var(--card)" strokeWidth="7" />
            <path d="M300 264 V324 Q300 336 312 336 H520 Q532 336 532 348 V356" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" markerEnd="url(#arquitectura-flecha)" style={{ color: COLOR_CONEXION.conteos }} />
            <path d="M168 348 H184 Q196 348 196 360 V428 Q196 440 208 440 H216" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 4" markerEnd="url(#arquitectura-flecha)" style={{ color: COLOR_CONEXION.recuperacion }} />
          </svg>
          {POSICIONES.map((node) => (
            <div key={node.id} className="absolute" style={{ left: `${100 * node.x / 1060}%`, top: node.y, width: `${100 * node.w / 1060}%` }}>
              <NodoArquitectura id={node.id} detalle={node.detalle} onAbrir={onAbrir} compact />
            </div>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap justify-between gap-x-6 gap-y-3 border-t bg-muted/10 px-6 py-5 text-xs font-semibold text-foreground" aria-label="Leyenda de conexiones">
        {LEYENDAS_ARQUITECTURA.map(({ texto, color, discontinua }) => (
          <li key={texto} className="flex items-center gap-2">
            <svg width="32" height="12" viewBox="0 0 32 12" fill="none" style={{ color }} aria-hidden>
              <path d="M1 6H30" stroke="currentColor" strokeWidth="2" strokeDasharray={discontinua ? "4 3" : undefined} />
              <path d="M26 2L30 6L26 10" stroke="currentColor" strokeWidth="2" />
            </svg>
            {texto}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- piezas de los modales

function Bloque({ titulo, children, className }: { titulo?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3.5", className)}>
      {titulo && <span className="text-xs font-medium text-muted-foreground">{titulo}</span>}
      <div className="text-[13.5px] leading-relaxed">{children}</div>
    </div>
  )
}

function Cifra({ titulo, valor, texto }: { titulo: string; valor: string; texto: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5">
      <span className="text-xs text-muted-foreground">{titulo}</span>
      <span className="text-[22px] leading-tight font-semibold tracking-tight tabular-nums">{valor}</span>
      <span className="text-[12.5px] leading-relaxed text-muted-foreground">{texto}</span>
    </div>
  )
}

/** minimo: ancho mínimo antes de pasar a scroll horizontal (las tablas angostas, como Origen, no lo necesitan). */
function Tabla({ columnas, filas, anchos, minimo = 560 }: { columnas: string[]; filas: ReactNode[][]; anchos: string; minimo?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="grid gap-3 border-b bg-muted/50 px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase" style={{ gridTemplateColumns: anchos, minWidth: minimo }}>
        {columnas.map((c) => <span key={c}>{c}</span>)}
      </div>
      {filas.map((f, i) => (
        <div key={i} className="grid gap-3 border-b px-4 py-2.5 text-[13px] last:border-0" style={{ gridTemplateColumns: anchos, minWidth: minimo }}>
          {f.map((c, j) => <span key={j} className="min-w-0 break-words">{c}</span>)}
        </div>
      ))}
    </div>
  )
}

const Codigo = ({ children }: { children: ReactNode }) => <span className="font-mono text-xs">{children}</span>
const Chips = ({ items }: { items: string[] }) => (
  <span className="flex flex-wrap gap-1">{items.map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-px font-mono text-[11px] text-foreground/80">{t}</span>)}</span>
)

function TresBloques({ que, porque, quien }: { que: ReactNode; porque: ReactNode; quien: ReactNode }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Bloque titulo="Qué guarda">{que}</Bloque>
      <Bloque titulo="Por qué ahí">{porque}</Bloque>
      <Bloque titulo="Quién escribe">{quien}</Bloque>
    </div>
  )
}

// ---------------------------------------------------------------- contenido de cada componente

const TIPOS: [string, string, string, string[]][] = [
  ["edit", "Edición", "Cambio en una página que ya existe.", ["length.old/new", "revision.old/new", "minor", "patrolled", "notify_url"]],
  ["categorize", "Categorización", "Una página entra o sale de una categoría; la página afectada va en el comentario.", ["comment", "notify_url"]],
  ["log", "Registro", "Acción administrativa: bloqueo, traslado, subida de archivo, agradecimiento, filtro antiabuso, alta de usuario…", ["log_type", "log_action", "log_id", "log_params (estructura libre)"]],
  ["new", "Página nueva", "Creación de una página: los mismos campos que una edición, sin los valores anteriores.", ["length.new", "revision.new", "patrolled"]],
]

/** Métricas de la captura de prueba del 31 oct 2026 (docs/justificacion-dataset.md). */
const CAPTURA: [string, string][] = [
  ["Eventos por tipo", "categorize 2,323 · edit 2,105 · new 260 · log 227"],
  ["Ediciones hechas por bots", "51.4 %"],
  ["Cuentas temporales (formato ~2026-NNNNN-NN)", "2.6 %"],
  ["Wikis distintas", "93"],
  ["Usuarios distintos", "607"],
  ["Páginas distintas", "2,758"],
  ["Usuarios que tocaron más de una página", "135 (el máximo: 216 páginas, un bot)"],
  ["Ediciones menores (minor)", "27.9 % de las ediciones"],
  ["Cambio de tamaño por edición", "mediana +38 bytes · promedio absoluto 950 bytes"],
]

const REQUISITOS: [string, string][] = [
  ["Semiestructurado", "JSON con 4 tipos de evento de forma distinta, objetos anidados y un log_params de estructura libre."],
  ["Al menos 50,000 registros", "~37 eventos/s medidos en todo el stream: 50,000 en ~23 min. Hoy guardamos millones solo de enwiki y eswiki."],
  ["Actualización periódica", "Stream continuo: el servicio stream lo lee sin parar y cada corrida del DAG captura una hora nueva."],
  ["Origen, estructura y características documentados", "Esquema JSON público y versionado (/mediawiki/recentchange/1.0.x) y documentación oficial en Wikitech."],
]

function Imagen({ src, alt, pie }: { src: string; alt: string; pie: string }) {
  return (
    <figure className="m-0 flex flex-col gap-2 overflow-hidden rounded-xl border bg-card">
      {/* Las imágenes tienen fondo blanco: se muestran sobre blanco también en modo oscuro. */}
      <div className="bg-white"><img src={src} alt={alt} loading="lazy" className="mx-auto w-full max-w-[760px]" /></div>
      <figcaption className="px-4 pb-3 text-xs text-muted-foreground">{pie}</figcaption>
    </figure>
  )
}

function EventoEjemplo() {
  const [tipo, setTipo] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  // «v» solo cambia la URL para que «Ver otro» pida un evento nuevo.
  const { data } = useApi<Record<string, unknown>>(`/api/arquitectura/ejemplo?${new URLSearchParams({ ...(tipo ? { tipo } : {}), v: String(vuelta) })}`)
  // Se ocultan campos largos que no aportan a entender la estructura.
  const resumen = data && Object.fromEntries(Object.entries(data).filter(([k]) => !["parsedcomment", "server_url", "server_script_path", "schema", "title_url", "notify_url"].includes(k)))
  const json = resumen ? JSON.stringify(resumen, null, 2) : ""
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">Un evento real</span>
        <span className="flex items-center gap-1.5">
          {[null, "edit", "categorize", "log", "new"].map((t) => (
            <button key={t ?? "todos"} type="button" onClick={() => setTipo(t)}
              className={cn("rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors", tipo === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>
              {t ?? "cualquiera"}
            </button>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setVuelta((v) => v + 1)}><RefreshCw aria-hidden />Ver otro</Button>
        </span>
      </div>
      <pre className="m-0 max-h-[320px] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: data ? resaltar(json) : "Cargando…" }} />
      <span className="border-t px-4 py-2 text-xs text-muted-foreground">Documento real de MongoDB (sin algunos campos largos). El bloque <Codigo>derived</Codigo> lo agrega la limpieza.</span>
    </div>
  )
}

function Fuente({ d }: { d: Datos }) {
  const total = Object.values(d.tipos_24h).reduce((a, b) => a + b, 0)
  const porSeg = d.ritmo.promedio_hora != null ? d.ritmo.promedio_hora / 3600 : null
  return (
    <>
      <Bloque titulo="El problema que planteamos">
        Monitorear la actividad colaborativa en Wikipedia: quién edita qué, cuánto del trabajo hacen los bots y qué páginas concentran ediciones de muchos
        editores (posibles conflictos o vandalismo). El stream de cambios en tiempo real de Wikimedia trae exactamente esos datos.
      </Bloque>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Volumen" valor={`${millones(d.mongo.eventos)} eventos`} texto={`Guardados en MongoDB desde el ${d.mongo.desde ? horaLocal(d.mongo.desde).split(" · ")[0] : "—"} (el mínimo pedido es 50 mil).`} />
        <Cifra titulo="Velocidad" valor={porSeg != null ? `~${porSeg.toFixed(1)} por segundo` : "—"}
          texto={`En enwiki + eswiki: ~${entero(d.ritmo.promedio_hora)} por hora, entre ${entero(d.ritmo.min_hora)} y ${entero(d.ritmo.max_hora)} en las últimas ${d.ritmo.horas} h.`} />
        <Cifra titulo="Variedad" valor="4 tipos" texto="Cada tipo trae campos distintos y objetos anidados: es semiestructurado." />
        <Cifra titulo="Calidad" valor={d.calidad_pct != null ? `${d.calidad_pct.toFixed(1)} %` : "—"} texto="Eventos de la última hora que pasaron la validación; los rechazados se guardan con su motivo." />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Tabla columnas={["Origen", ""]} anchos="120px minmax(0,1fr)" minimo={0} filas={[
          ["Fuente", "EventStreams de la Wikimedia Foundation: cada cambio en Wikipedia, Wikidata, Commons y los demás proyectos, en todos los idiomas, en tiempo real"],
          ["Endpoint", <Codigo key="e">stream.wikimedia.org/v2/stream/<wbr />recentchange</Codigo>],
          ["Protocolo", <>Server-Sent Events (SSE): una línea <Codigo>data: {"{json}"}</Codigo> por evento</>],
          ["Formato", <>JSON validado con el esquema público y versionado <Codigo>/mediawiki/recentchange/1.0.x</Codigo></>],
          ["Autenticación", <>Ninguna; solo se pide un <Codigo>User-Agent</Codigo> que identifique al cliente</>],
          ["Datos pasados", <>El parámetro <Codigo>?since=fecha</Codigo> vuelve a emitir eventos de hasta unos 9 días atrás; el DAG lo usa como respaldo si el servicio stream tuvo un corte</>],
          ["Qué guardamos", "Solo enwiki y eswiki (el stream trae ~90 wikis)"],
          ["Licencia", "Contenido bajo CC BY-SA 4.0; los metadatos de los cambios son públicos"],
          ["Documentación", <a key="d" className="underline underline-offset-2" href="https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service" target="_blank" rel="noreferrer">EventStreams en Wikitech</a>],
        ]} />
        <EventoEjemplo />
      </div>
      <Bloque titulo="Campos comunes a todos los eventos">
        <div className="flex flex-col gap-2">
          <Chips items={["id", "meta.dt", "meta.domain", "type", "wiki", "server_name", "title", "namespace", "user", "bot", "timestamp", "comment"]} />
          <span className="text-[12.5px] text-muted-foreground">Y según el tipo, campos extra (abajo). Al limpiar agregamos el bloque <Codigo>derived</Codigo>: fecha, tipo de editor, bytes cambiados, a quién revierte…</span>
        </div>
      </Bloque>
      <div className="grid gap-3 md:grid-cols-2">
        {TIPOS.map(([cod, nombre, desc, extra]) => {
          const pct = total ? ((d.tipos_24h[cod] ?? 0) / total) * 100 : 0
          return (
            <div key={cod} className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3.5">
              <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">{nombre} <Codigo>{cod}</Codigo></span><span className="text-sm font-semibold tabular-nums">{pct.toFixed(1)} %</span></div>
              <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${pct}%` }} /></div>
              <span className="text-[12.5px] text-muted-foreground">{desc}</span>
              <Chips items={extra} />
            </div>
          )
        })}
      </div>
      <span className="text-xs text-muted-foreground">Porcentajes de las últimas 24 horas en enwiki y eswiki.</span>

      <h3 className="mt-2 text-sm font-semibold">Captura de prueba</h3>
      <span className="-mt-2 text-[13px] text-muted-foreground">
        Antes de construir el pipeline medimos el stream completo (todas las wikis) durante 134 segundos el 31 de octubre de 2026: llegaron 4,915 eventos
        válidos, unos 37 por segundo (~132 mil por hora, ~3 millones por día).
      </span>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Tabla columnas={["Métrica de la muestra", "Valor"]} anchos="minmax(0,1fr) minmax(0,1fr)" minimo={0} filas={CAPTURA} />
        <Imagen src="/img/eventos-por-wiki.png" alt="Gráfico de barras: eventos por wiki en la muestra; commonswiki concentra el 37 %"
          pie="Captura propia del stream recentchange · 31 oct 2026, 11:02 UTC−5 · 134 s. La actividad está muy concentrada: 4 wikis suman el 70 % de los eventos." />
      </div>

      <h3 className="mt-2 text-sm font-semibold">Cumple los requisitos del dataset</h3>
      <Tabla columnas={["Requisito", "Cómo lo cumple"]} anchos="220px minmax(0,1fr)" filas={REQUISITOS} />
    </>
  )
}

function CapaRapida({ d }: { d: Datos }) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Cifra titulo="Último evento recibido" valor={hace(d.stream.stream_ultimo_evento)} texto="Lo que tarda un cambio de Wikipedia en llegar a MongoDB: unos 2 segundos." />
        <Cifra titulo="Escribe en" valor="MongoDB + Cassandra" texto="El evento completo y los conteos por minuto." />
        <Cifra titulo="Alimenta" valor="En vivo" texto="Eventos por segundo y las últimas ediciones al instante." />
      </div>
      <Bloque titulo="Cómo funciona">
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>El servicio <Codigo>stream</Codigo> mantiene abierta la conexión SSE con Wikimedia y lee los eventos a medida que ocurren.</li>
          <li>Cada ~2 segundos valida y limpia el lote leído con las mismas reglas del DAG.</li>
          <li>Guarda los eventos en MongoDB (<Codigo>events</Codigo>) y suma los conteos del minuto en Cassandra (<Codigo>eventos_por_minuto</Codigo>).</li>
          <li>Guarda dónde se quedó; si la conexión se corta, retoma desde ahí.</li>
        </ol>
      </Bloque>
      <Bloque titulo="Por qué existe, si ya está el DAG">
        El DAG corre una vez por hora: sin esta capa, el dashboard mostraría datos con hasta una hora de atraso. Es una arquitectura Lambda: la capa rápida da
        inmediatez y la capa por lotes da exactitud (cada hora recalcula y corrige los conteos). Los eventos se identifican por <Codigo>meta.id</Codigo>. Los conteos se reconstruyen desde MongoDB y las escrituras se coordinan por hora.
      </Bloque>
    </>
  )
}

// De dónde leyó la hora la tarea extraer. Antes de registrar la fuente, siempre era EventStreams.
const FUENTE: Record<string, string> = { mongodb: "MongoDB", eventstreams: "EventStreams" }

const PASOS: [string, string, string][] = [
  ["extraer", "Toma la hora completa de MongoDB si el servicio stream la cubrió sin cortes; si no, la vuelve a pedir al stream (con ?since=). La guarda cruda en un archivo .jsonl.gz.", "Archivo crudo"],
  ["validar_y_limpiar", "Descarta eventos sin meta, sin campos obligatorios, de tipo desconocido o con fecha mal formada, y agrega el bloque derived. Los rechazados se guardan con su motivo.", "Archivo limpio + rechazados"],
  ["cargar_mongo", "Inserta o reemplaza los eventos limpios en la colección events. Si la hora se leyó de MongoDB no escribe nada: ya está ahí completa.", "MongoDB"],
  ["cargar_cassandra", "Agrega la hora: totales, serie por minuto, actividad por editor y páginas más editadas.", "Cassandra"],
  ["cargar_neo4j", "Reemplaza las contribuciones de la hora y de cada wiki, y actualiza las relaciones acumuladas afectadas.", "Neo4j"],
  ["calcular_kpis", "Calcula los 12 KPIs de la hora (global y por wiki) con las tres bases y los guarda.", "Cassandra"],
]

function CapaLotes({ d }: { d: Datos }) {
  const paso = (i: number) => {
    const [t, , destino] = PASOS[i]
    return (
      <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">{i + 1}</span>{destino}</span>
        <span className="truncate font-mono text-xs font-medium">{t}</span>
      </div>
    )
  }
  const flecha = <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Cifra titulo="Programación" valor="Cada hora" texto="DAG wikipedia_recent_changes (@hourly), una corrida a la vez, 2 reintentos por tarea." />
        <Cifra titulo="Corridas registradas" valor={entero(d.dag.corridas)} texto="Cada corrida procesa una hora completa de eventos." />
        <Cifra titulo="Última hora consolidada" valor={d.stream.ultima_hora ? `${horaLocal(d.stream.ultima_hora)} UTC−5` : "—"} texto="La hora más reciente que el DAG terminó de procesar." />
      </div>
      <Bloque titulo="El flujo de Airflow">
        <div className="flex flex-col gap-3">
          <span>
            En Airflow, un flujo de trabajo se llama <b className="font-medium">DAG</b> (grafo dirigido acíclico): tareas unidas por dependencias, sin vueltas atrás.
            Cada tarea corre cuando terminan las anteriores; Cassandra y Neo4j se cargan en paralelo porque solo dependen de MongoDB.
          </span>
          <div className="overflow-x-auto">
            <div className="flex min-w-[720px] items-center gap-1.5">
              {paso(0)}{flecha}{paso(1)}{flecha}{paso(2)}{flecha}
              <div className="flex flex-col gap-1.5">{paso(3)}{paso(4)}</div>{flecha}{paso(5)}
            </div>
          </div>
        </div>
      </Bloque>
      <Tabla columnas={["Tarea", "Qué hace", "Escribe en"]} anchos="160px minmax(0,1fr) 150px"
        filas={PASOS.map(([t, q, dst], i) => [<Codigo key={t}>{i + 1}. {t}</Codigo>, q, dst])} />
      <Bloque titulo="Por qué así">
        Las cargas son <b className="font-medium">idempotentes</b>: volver a correr una hora reemplaza los datos en vez de duplicarlos, así un reintento o
        una corrida manual (backfill) no ensucia nada. Los archivos crudos se respaldan en Cloud Storage.
      </Bloque>
      {d.dag.ultimas.length > 0 && (
        <Tabla columnas={["Hora procesada", "Fuente", "Extraídos", "Válidos", "Rechazados", "Calidad", "Extracción"]} anchos="minmax(0,1.4fr) minmax(0,1.2fr) repeat(5,minmax(0,1fr))"
          filas={d.dag.ultimas.map((e) => [`${horaLocal(e.ventana)} UTC−5`, FUENTE[e.fuente ?? ""] ?? "EventStreams", entero(e.extraidos), entero(e.validos), entero(e.rechazados),
            e.calidad_pct != null ? `${e.calidad_pct.toFixed(1)} %` : "—", e.segundos_extraccion != null ? `${Math.round(e.segundos_extraccion)} s` : "—"])} />
      )}
    </>
  )
}

function Mongo({ d }: { d: Datos }) {
  return (
    <>
      <TresBloques
        que="Cada evento completo, tal como llega del stream, más el bloque derived que agrega la limpieza. Un documento por evento en la colección events."
        porque="Los 4 tipos de evento tienen campos distintos y objetos anidados; un esquema flexible los guarda sin forzar columnas vacías y permite consultar campos anidados (length.new, log_params…)."
        quien="El servicio stream guarda cada evento. Airflow completa los eventos de horas sin cobertura. Ambos identifican el evento mediante meta.id." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra titulo="Documentos" valor={millones(d.mongo.eventos)} texto={`Desde el ${d.mongo.desde ? horaLocal(d.mongo.desde) : "—"} UTC−5.`} />
        <Cifra titulo="Tamaño de los datos" valor={gb(d.mongo.tamano_bytes)} texto={`${gb(d.mongo.disco_bytes)} en disco, comprimido.`} />
        <Cifra titulo="Índices" valor={entero(d.mongo.indices.length)} texto="Para buscar por fecha, wiki y tipo, editor, página y reversiones." />
      </div>
      <Bloque titulo="Validador de la colección ($jsonSchema)">
        Exige <Codigo>_id</Codigo>, <Codigo>type</Codigo> (edit, new, categorize o log), <Codigo>wiki</Codigo>, <Codigo>title</Codigo>, <Codigo>user</Codigo>,
        <Codigo> meta</Codigo> y <Codigo>derived</Codigo> con fecha, hora y tipo de editor. Un documento que no cumple se rechaza: se puede probar en Operaciones CRUD.
      </Bloque>
      <Bloque titulo="Índices"><Chips items={d.mongo.indices} /></Bloque>
    </>
  )
}

const TABLAS_CASS: [string, string, string][] = [
  ["resumen_por_hora", "((fecha), hora, wiki)", "Totales de cada hora por wiki: tarjetas y gráficos del Resumen."],
  ["eventos_por_minuto", "((wiki, fecha), minuto)", "Serie por minuto; la escribe el servicio stream y la corrige el DAG."],
  ["actividad_editor", "((editor), fecha, hora, wiki)", "Historial de un editor, hora por hora."],
  ["paginas_top_por_hora", "((wiki, fecha), hora, posicion)", "Las 20 páginas con más editores de cada hora."],
  ["paginas_disputadas_por_hora", "((wiki, fecha), hora, posicion)", "Las 20 páginas con más reversiones recibidas de cada hora."],
  ["kpis", "((kpi), ventana)", "Los 12 KPIs de cada hora, de ambas wikis juntas."],
  ["kpis_por_wiki", "((kpi, wiki), ventana)", "Los mismos KPIs, por wiki."],
  ["ejecuciones", "((fecha), ventana)", "Registros procesados por cada corrida del DAG."],
]

function Cassandra() {
  return (
    <>
      <TresBloques
        que="Series de tiempo y agregados que calcula el pipeline: por minuto, por hora, por editor, y los KPIs."
        porque="Escrituras continuas y lecturas por partición (un día, una wiki, un editor) ya ordenadas por tiempo. Cada tabla está diseñada para una consulta del dashboard."
        quien="El servicio stream (eventos por minuto) y el DAG de Airflow (todo lo demás, cada hora)." />
      <Tabla columnas={["Tabla", "Clave primaria", "Para qué"]} anchos="190px 230px minmax(0,1fr)"
        filas={TABLAS_CASS.map(([t, k, p]) => [<Codigo key={t}>{t}</Codigo>, <Codigo key={k}>{k}</Codigo>, p])} />
      <span className="text-[12.5px] text-muted-foreground">
        La primera parte de la clave (entre doble paréntesis) es la partición: decide en qué nodo vive el dato y por qué columnas hay que consultar.
        Re-ejecutar una hora sobrescribe sus filas, no las duplica.
      </span>
    </>
  )
}

const RELACIONES: [string, string, string][] = [
  ["EDITO", "Editor → Página", "eventos edit"],
  ["CREO", "Editor → Página", "eventos new"],
  ["SUBIO", "Editor → Página (archivo)", "log de tipo upload"],
  ["MOVIDA_A", "Página → Página", "log de tipo move (log_params.target)"],
  ["PERTENECE_A", "Página o Categoría → Wiki", "campo wiki"],
  ["EN_CATEGORIA", "Página → Categoría", "eventos categorize (enlace [[…]] del comentario)"],
  ["REVIRTIO", "Editor → Editor", "edit cuyo comentario es una reversión y enlaza a Special:Contributions/X"],
  ["MENSAJE_A", "Editor → Editor", "edit en la página de discusión de otro usuario (namespace 3)"],
  ["AGRADECIO", "Editor → Editor", "log de tipo thanks"],
  ["BLOQUEO", "Editor → Editor", "log de tipo block"],
  ["COEDITA", "Editor — Editor", "calculada en Neo4j: dos EDITO hacia la misma página"],
]

function Neo4j({ d }: { d: Datos }) {
  const nodos = Object.values(d.grafo.nodos).reduce((a, b) => a + b, 0)
  const rels = Object.values(d.grafo.relaciones).reduce((a, b) => a + b, 0)
  return (
    <>
      <TresBloques
        que="Editores, páginas, categorías y wikis, unidos por lo que hacen: editar, crear, revertir, agradecer, bloquear, compartir páginas…"
        porque="Las preguntas son de conexiones: quién revierte a quién, qué editores comparten páginas, qué página atrae a más editores. En un grafo se responden recorriendo vecinos, sin joins costosos."
        quien="La tarea cargar_neo4j del DAG reemplaza las contribuciones de cada hora y wiki mediante una transacción." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Cifra titulo="Nodos" valor={millones(nodos)} texto={Object.entries(d.grafo.nodos).map(([k, v]) => `${k} ${millones(v)}`).join(" · ")} />
        <Cifra titulo="Relaciones almacenadas" valor={millones(rels)} texto="Contribuciones de cada hora y wiki, junto con las relaciones acumuladas del grafo." />
      </div>
      <Imagen src="/img/esquema-grafo.png" alt="Esquema del grafo: nodos Editor, Página, Wiki y Categoría con sus 11 relaciones"
        pie="Esquema del grafo · 4 tipos de nodo y 11 tipos de relación. Arriba, la capa entre editores; abajo, la que los une con el contenido." />
      <Tabla columnas={["Relación", "Une", "Se obtiene de", "Cantidad"]} anchos="140px 190px minmax(0,1fr) 100px"
        filas={RELACIONES.map(([r, u, o]) => [<Codigo key={r}>{r}</Codigo>, u, o, <span key="n" className="tabular-nums">{entero(d.grafo.relaciones[r])}</span>])} />
      <Bloque titulo="Un ejemplo real">
        En la captura de prueba, en 93 segundos un patrullero de enwiki revirtió ediciones de 5 editores en 5 páginas y dejó un aviso en la página de discusión
        de cada uno: 5 relaciones REVIRTIO y 5 MENSAJE_A. Tres de los cinco usaban cuentas temporales. Ese patrón (un nodo central con muchas reversiones
        salientes) es lo que miden los rankings de la Red de editores.
      </Bloque>
      <Imagen src="/img/ejemplo-reversiones.png" alt="Subgrafo real: un patrullero con cinco relaciones REVIRTIO y MENSAJE_A hacia cinco editores"
        pie="Datos reales de la captura del 31 oct 2026 · enwiki, 11:02:29–11:04:02 UTC−5." />
    </>
  )
}

const VISTAS: [string, Base[], string][] = [
  ["Resumen y KPIs", ["cassandra", "mongo"], "KPIs y protagonistas de una hora, calculados por el DAG y almacenados en Cassandra."],
  ["En vivo", ["mongo", "cassandra"], "Últimos eventos (MongoDB) y conteos por minuto (Cassandra)."],
  ["Actividad en el tiempo", ["cassandra"], "Serie por minuto e historial de cada editor."],
  ["Explorador de eventos", ["mongo"], "Búsqueda y conteos sobre los eventos."],
  ["Red de editores", ["neo4j", "cassandra"], "Rankings, páginas disputadas y la red alrededor de un editor."],
  ["Operaciones CRUD", ["mongo", "cassandra", "neo4j"], "Crear, consultar, actualizar y eliminar en las tres bases."],
  ["Arquitectura", ["mongo", "cassandra", "neo4j"], "Cifras de esta página."],
]

function Api() {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Bloque titulo="Qué es">Una API en FastAPI (Python) que consulta las tres bases y entrega JSON al dashboard. Reutiliza el mismo código del pipeline (por ejemplo, la limpieza que calcula derived en el CRUD).</Bloque>
        <Bloque titulo="Cómo responde rápido">Guarda en memoria las consultas pesadas durante 60 segundos y usa los índices de cada base; los totales del grafo por wiki los precalcula el DAG.</Bloque>
      </div>
      <Tabla columnas={["Vista", "Bases que consulta", "Qué lee"]} anchos="190px 170px minmax(0,1fr)"
        filas={VISTAS.map(([v, bases, q]) => [v, <span key="b" className="flex gap-1.5">{bases.map((b) => <LogoBase key={b} base={b} />)}</span>, q])} />
    </>
  )
}

function Dashboard() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Bloque titulo="Tecnología">React con componentes shadcn/ui, gráficos con Recharts y el grafo con un canvas propio. Modo claro y oscuro.</Bloque>
      <Bloque titulo="Dónde corre">En una máquina virtual de Google Cloud, junto con las bases, Airflow y la API, todo con Docker Compose. El acceso pide contraseña.</Bloque>
      <Bloque titulo="Cómo leerlo">Cada tarjeta abre un detalle con su definición, cálculo y origen; el logo indica de qué base sale el dato y el filtro de la cabecera elige la wiki.</Bloque>
    </div>
  )
}

function Contenido({ id, d }: { id: Id; d: Datos }) {
  switch (id) {
    case "fuente": return <Fuente d={d} />
    case "rapida": return <CapaRapida d={d} />
    case "lotes": return <CapaLotes d={d} />
    case "mongo": return <Mongo d={d} />
    case "cassandra": return <Cassandra />
    case "neo4j": return <Neo4j d={d} />
    case "api": return <Api />
    case "dashboard": return <Dashboard />
  }
}

function Detalle({ id, d, onCambiar }: { id: Id | null; d: Datos | null; onCambiar: (id: Id | null) => void }) {
  if (!id) return null
  const caja = CAJAS.find((c) => c.id === id)!
  const i = ORDEN.indexOf(id)
  const anterior = ORDEN[(i - 1 + ORDEN.length) % ORDEN.length]
  const siguiente = ORDEN[(i + 1) % ORDEN.length]
  const boton = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
  return (
    <Dialog open onOpenChange={(a) => !a && onCambiar(null)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-6 py-4 pr-14">
          <DialogTitle className="flex items-center gap-2 text-lg">{caja.logo && <LogoBase base={caja.logo} className="size-[18px]" />}{caja.titulo}</DialogTitle>
          <DialogDescription className="text-[13px]">{caja.etiqueta}</DialogDescription>
        </div>
        <div className="grid max-h-[72vh] content-start gap-3.5 overflow-y-auto bg-muted/30 px-6 py-5">
          {d ? <Contenido id={id} d={d} /> : <Cargando alto={280} />}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <button type="button" onClick={() => onCambiar(anterior)} className={boton}><ChevronLeft className="size-3.5" aria-hidden />{NOMBRE[anterior]}</button>
          <button type="button" onClick={() => onCambiar(siguiente)} className={boton}>{NOMBRE[siguiente]}<ChevronRight className="size-3.5" aria-hidden /></button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ArquitecturaPage() {
  const { data } = useApi<Datos>("/api/arquitectura")
  const [abierto, setAbierto] = useState<Id | null>(null)
  return (
    <>
      <Header ruta={["Proyecto", "Arquitectura"]} />
      <Pagina titulo="Arquitectura" descripcion="Cómo llegan los datos de Wikipedia, cómo se procesan y en qué base se guarda cada parte. Haz clic en un componente para ver su detalle.">
        <Tabs defaultValue="arquitectura" className="gap-5">
          <TabsList aria-label="Vista de arquitectura">
            <TabsTrigger value="arquitectura">Arquitectura</TabsTrigger>
            <TabsTrigger value="funcionamiento">Cómo funciona</TabsTrigger>
          </TabsList>
          <TabsContent value="arquitectura"><ArquitecturaGeneral onAbrir={setAbierto} /></TabsContent>
          <TabsContent value="funcionamiento"><Diagrama onAbrir={setAbierto} /></TabsContent>
        </Tabs>
      </Pagina>
      <Detalle id={abierto} d={data} onCambiar={setAbierto} />
    </>
  )
}
