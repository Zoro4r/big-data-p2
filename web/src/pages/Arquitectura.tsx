import { useState, type ReactNode } from "react"
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"

import { Cargando, TarjetaKpi } from "@/components/common"
import { resaltar } from "@/components/crear-evento"
import { LogoBase, type Base } from "@/components/fuente"
import { Header, Pagina } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useApi } from "@/lib/api"
import { entero, horaUTC } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Arquitectura del proyecto: el diagrama del flujo es la página y cada componente abre un modal con su detalle
 *  (los datos que llegan, cómo se procesan y qué guarda cada base). Las cifras vienen de /api/arquitectura. */

interface Ejecucion { ventana: string; extraidos: number; validos: number; rechazados: number; calidad_pct: number; segundos_extraccion: number }
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

interface Caja { id: Id; x: number; y: number; w: number; h: number; titulo: string; lineas: string[]; oscura?: boolean; logo?: Base; etiqueta: string }
const CAJAS: Caja[] = [
  { id: "fuente", x: 16, y: 120, w: 160, h: 100, titulo: "Wikimedia EventStreams", lineas: ["stream recentchange · JSON por SSE"], oscura: true, etiqueta: "Los datos que llegan · origen, estructura y características" },
  { id: "rapida", x: 214, y: 40, w: 200, h: 80, titulo: "Capa rápida", lineas: ["servicio stream · guarda cada ~2 s"], etiqueta: "Servicio stream · eventos al instante" },
  { id: "lotes", x: 214, y: 200, w: 200, h: 120, titulo: "Capa por lotes", lineas: ["DAG de Airflow · cada hora", "extraer → validar → cargar → KPIs"], etiqueta: "El flujo de Airflow, paso a paso" },
  { id: "mongo", x: 470, y: 30, w: 190, h: 70, titulo: "MongoDB", lineas: ["eventos originales"], logo: "mongo", etiqueta: "Almacenamiento · los eventos tal como llegan" },
  { id: "cassandra", x: 470, y: 145, w: 190, h: 70, titulo: "Cassandra", lineas: ["series de tiempo y KPIs"], logo: "cassandra", etiqueta: "Almacenamiento · series de tiempo y KPIs" },
  { id: "neo4j", x: 470, y: 260, w: 190, h: 70, titulo: "Neo4j", lineas: ["red de editores y páginas"], logo: "neo4j", etiqueta: "Almacenamiento · la red de colaboración" },
  { id: "api", x: 720, y: 130, w: 150, h: 100, titulo: "API FastAPI", lineas: ["lee las tres bases"], etiqueta: "Qué base consulta cada vista" },
  { id: "dashboard", x: 930, y: 130, w: 170, h: 100, titulo: "Dashboard", lineas: ["React + shadcn"], oscura: true, etiqueta: "Lo que estás viendo" },
]
const NOMBRE = Object.fromEntries(CAJAS.map((c) => [c.id, c.titulo])) as Record<Id, string>

const FLECHAS = [
  "M176 170 C 195 170, 195 80, 214 80", "M176 170 C 195 170, 195 260, 214 260",
  "M414 70 C 440 70, 440 62, 470 62", "M414 92 C 445 92, 445 172, 470 172",
  "M414 245 C 445 245, 445 70, 470 70", "M414 255 C 445 255, 445 182, 470 182", "M414 275 C 445 275, 445 295, 470 295",
  "M660 65 C 690 65, 690 172, 720 172", "M660 180 L 720 180", "M660 295 C 690 295, 690 188, 720 188", "M870 180 L 930 180",
]

const gb = (b?: number | null) => (b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`)
const millones = (n?: number | null) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : entero(n))
const hace = (iso?: string | null) => {
  if (!iso) return "—"
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  return s < 60 ? `hace ${Math.round(s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : horaUTC(iso)
}

function Diagrama({ onAbrir }: { onAbrir: (id: Id) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <div className="relative mx-auto h-[372px] w-[1120px]">
        <svg aria-hidden className="absolute inset-0 size-full text-muted-foreground/50">
          <defs>
            <marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker>
          </defs>
          <g stroke="currentColor" strokeWidth={1.5} fill="none" markerEnd="url(#flecha)">{FLECHAS.map((d) => <path key={d} d={d} />)}</g>
        </svg>
        {CAJAS.map((c) => (
          <button key={c.id} type="button" onClick={() => onAbrir(c.id)} aria-label={`${c.titulo}: ver detalle`}
            style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            className={cn("group absolute flex flex-col justify-center gap-1 rounded-xl border px-3 py-2.5 text-left transition-[border-color,box-shadow] outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50",
              c.oscura ? "border-foreground bg-foreground text-background" : "bg-card hover:border-foreground/40")}>
            <ArrowUpRight className="absolute top-2 right-2 size-3.5 opacity-40 transition-opacity group-hover:opacity-100" aria-hidden />
            <span className="flex items-center gap-1.5 pr-4 text-[13.5px] leading-tight font-semibold">{c.logo && <LogoBase base={c.logo} />}{c.titulo}</span>
            {c.lineas.map((l) => <span key={l} className={cn("text-xs leading-snug", c.oscura ? "opacity-75" : "text-muted-foreground")}>{l}</span>)}
          </button>
        ))}
        <p className="absolute bottom-3 left-4 text-xs text-muted-foreground">
          Haz clic en cualquier componente para ver su detalle. Las dos capas guardan cada evento con el mismo _id: no hay duplicados.
        </p>
      </div>
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
  ["edit", "Edición", "Cambio en una página que ya existe.", ["length.old/new", "revision.old/new", "minor"]],
  ["categorize", "Categorización", "Una página entra o sale de una categoría; la página va en el comentario.", ["comment"]],
  ["log", "Registro", "Acción administrativa: bloqueo, traslado, subida de archivo, agradecimiento…", ["log_type", "log_action", "log_params"]],
  ["new", "Página nueva", "Creación de una página.", ["length.new", "revision.new"]],
]

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Volumen" valor={`${millones(d.mongo.eventos)} eventos`} texto={`Guardados en MongoDB desde el ${d.mongo.desde ? horaUTC(d.mongo.desde).split(" · ")[0] : "—"} (el mínimo pedido es 50 mil).`} />
        <Cifra titulo="Velocidad" valor={porSeg != null ? `~${porSeg.toFixed(1)} por segundo` : "—"}
          texto={`En enwiki + eswiki: ~${entero(d.ritmo.promedio_hora)} por hora, entre ${entero(d.ritmo.min_hora)} y ${entero(d.ritmo.max_hora)} en las últimas ${d.ritmo.horas} h.`} />
        <Cifra titulo="Variedad" valor="4 tipos" texto="Cada tipo trae campos distintos y objetos anidados: es semiestructurado." />
        <Cifra titulo="Calidad" valor={d.calidad_pct != null ? `${d.calidad_pct.toFixed(1)} %` : "—"} texto="Eventos de la última hora que pasaron la validación; los rechazados se guardan con su motivo." />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Tabla columnas={["Origen", ""]} anchos="120px minmax(0,1fr)" minimo={0} filas={[
          ["Fuente", "EventStreams de la Wikimedia Foundation: cada cambio de Wikipedia, en tiempo real"],
          ["Endpoint", <Codigo key="e">stream.wikimedia.org/v2/stream/<wbr />recentchange</Codigo>],
          ["Protocolo", <>Server-Sent Events (SSE): una línea <Codigo>data: {"{json}"}</Codigo> por evento</>],
          ["Formato", <>JSON validado con el esquema <Codigo>/mediawiki/recentchange/1.0</Codigo></>],
          ["Qué guardamos", "Solo enwiki y eswiki (el stream trae ~90 wikis)"],
          ["Licencia", "Datos públicos · contenido bajo CC BY-SA 4.0"],
        ]} />
        <EventoEjemplo />
      </div>
      <Bloque titulo="Campos comunes a todos los eventos">
        <div className="flex flex-col gap-2">
          <Chips items={["meta.dt", "meta.domain", "type", "wiki", "title", "namespace", "user", "bot", "timestamp", "comment"]} />
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
      <span className="text-xs text-muted-foreground">Porcentajes de las últimas 24 horas.</span>
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
        inmediatez y la capa por lotes da exactitud (cada hora recalcula y corrige los conteos). Las dos usan el mismo <Codigo>_id</Codigo>, así que no hay duplicados.
      </Bloque>
    </>
  )
}

const PASOS: [string, string, string][] = [
  ["extraer", "Lee del stream la hora completa (con ?since=) y la guarda cruda en un archivo .jsonl.gz.", "Archivo crudo"],
  ["validar_y_limpiar", "Descarta eventos sin meta, sin campos obligatorios, de tipo desconocido o con fecha mal formada, y agrega el bloque derived. Los rechazados se guardan con su motivo.", "Archivo limpio + rechazados"],
  ["cargar_mongo", "Inserta o reemplaza los eventos limpios en la colección events.", "MongoDB"],
  ["cargar_cassandra", "Agrega la hora: totales, serie por minuto, actividad por editor y páginas más editadas.", "Cassandra"],
  ["cargar_neo4j", "Crea o actualiza con MERGE los editores, páginas y categorías, y sus relaciones.", "Neo4j"],
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
        <Cifra titulo="Última hora consolidada" valor={d.stream.ultima_hora ? `${horaUTC(d.stream.ultima_hora)} UTC` : "—"} texto="La hora más reciente que el DAG terminó de procesar." />
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
        <Tabla columnas={["Hora procesada", "Extraídos", "Válidos", "Rechazados", "Calidad", "Extracción"]} anchos="minmax(0,1.4fr) repeat(5,minmax(0,1fr))"
          filas={d.dag.ultimas.map((e) => [`${horaUTC(e.ventana)} UTC`, entero(e.extraidos), entero(e.validos), entero(e.rechazados),
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
        quien="El servicio stream (cada ~2 s) y la tarea cargar_mongo del DAG (cada hora). Las dos usan el mismo _id, que es el meta.id del evento." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra titulo="Documentos" valor={millones(d.mongo.eventos)} texto={`Desde el ${d.mongo.desde ? horaUTC(d.mongo.desde) : "—"} UTC.`} />
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
  ["paginas_top_por_hora", "((wiki, fecha), hora, posicion)", "Las 20 páginas más editadas de cada hora."],
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

const RELACIONES: [string, string][] = [
  ["EDITO", "Editor → Página"], ["CREO", "Editor → Página"], ["SUBIO", "Editor → Página (archivo)"], ["MOVIDA_A", "Página → Página"],
  ["PERTENECE_A", "Página → Wiki"], ["EN_CATEGORIA", "Página → Categoría"], ["REVIRTIO", "Editor → Editor"], ["MENSAJE_A", "Editor → Editor"],
  ["AGRADECIO", "Editor → Editor"], ["BLOQUEO", "Editor → Editor"], ["COEDITA", "Editor — Editor (comparten páginas)"],
]

function Neo4j({ d }: { d: Datos }) {
  const nodos = Object.values(d.grafo.nodos).reduce((a, b) => a + b, 0)
  const rels = Object.values(d.grafo.relaciones).reduce((a, b) => a + b, 0)
  return (
    <>
      <TresBloques
        que="Editores, páginas, categorías y wikis, unidos por lo que hacen: editar, crear, revertir, agradecer, bloquear, compartir páginas…"
        porque="Las preguntas son de conexiones: quién revierte a quién, qué editores comparten páginas, qué página atrae a más editores. En un grafo se responden recorriendo vecinos, sin joins costosos."
        quien="La tarea cargar_neo4j del DAG, cada hora, con MERGE (si el nodo o la relación ya existe, se actualiza)." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Cifra titulo="Nodos" valor={millones(nodos)} texto={Object.entries(d.grafo.nodos).map(([k, v]) => `${k} ${millones(v)}`).join(" · ")} />
        <Cifra titulo="Relaciones" valor={millones(rels)} texto="De 11 tipos: con el contenido y entre editores." />
      </div>
      <Tabla columnas={["Relación", "Une", "Cantidad"]} anchos="160px minmax(0,1fr) 120px"
        filas={RELACIONES.map(([r, u]) => [<Codigo key={r}>{r}</Codigo>, u, <span key="n" className="tabular-nums">{entero(d.grafo.relaciones[r])}</span>])} />
    </>
  )
}

const VISTAS: [string, Base[], string][] = [
  ["Resumen y KPIs", ["cassandra", "neo4j"], "KPIs y resumen por hora (Cassandra) y protagonistas del grafo (Neo4j)."],
  ["En vivo", ["mongo", "cassandra"], "Últimos eventos (MongoDB) y conteos por minuto (Cassandra)."],
  ["Actividad en el tiempo", ["cassandra"], "Serie por minuto e historial de cada editor."],
  ["Explorador de eventos", ["mongo"], "Búsqueda y conteos sobre los eventos."],
  ["Red de editores", ["neo4j"], "Rankings, páginas disputadas y la red alrededor de un editor."],
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
  const porSeg = data?.ritmo.promedio_hora != null ? data.ritmo.promedio_hora / 3600 : null
  return (
    <>
      <Header ruta={["Proyecto", "Arquitectura"]} />
      <Pagina titulo="Arquitectura" descripcion="Cómo llegan los datos de Wikipedia, cómo se procesan y en qué base se guarda cada parte. Haz clic en un componente para ver su detalle.">
        <Diagrama onAbrir={setAbierto} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? Array.from({ length: 4 }, (_, i) => <Cargando key={i} alto={130} />) : (
            <>
              <TarjetaKpi etiqueta="Eventos guardados" valor={millones(data.mongo.eventos)} pie={`en MongoDB desde el ${data.mongo.desde ? horaUTC(data.mongo.desde).split(" · ")[0] : "—"}`} onAbrir={() => setAbierto("mongo")} />
              <TarjetaKpi etiqueta="Ritmo de llegada" valor={porSeg != null ? `~${porSeg.toFixed(1)} / s` : "—"} pie={`~${entero(data.ritmo.promedio_hora)} eventos por hora`} onAbrir={() => setAbierto("fuente")} />
              <TarjetaKpi etiqueta="Corridas del DAG" valor={entero(data.dag.corridas)} pie="una por hora, en Airflow" onAbrir={() => setAbierto("lotes")} />
              <TarjetaKpi etiqueta="Calidad de la última hora" valor={data.calidad_pct != null ? `${data.calidad_pct.toFixed(1)} %` : "—"} pie="eventos que pasaron la validación" onAbrir={() => setAbierto("lotes")} />
            </>
          )}
        </div>
      </Pagina>
      <Detalle id={abierto} d={data} onCambiar={setAbierto} />
    </>
  )
}
