import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertCircle, Check } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Creación de eventos en MongoDB: la columna izquierda es un formulario por tipo de evento y la derecha
 *  un editor JSON. Los dos trabajan sobre el mismo texto: el formulario lee y escribe campos del JSON. */

export type WikiCrud = "enwiki" | "eswiki"
type Doc = Record<string, unknown>
type Tipo = "edicion" | "nueva" | "categorizacion" | "otros"
type Accion = "bloqueo" | "agradecimiento" | "traslado" | "subida" | "otra"
type TipoEditor = "registrado" | "temporal" | "bot"

const TIPOS: [Tipo, string][] = [["edicion", "Edición"], ["nueva", "Página nueva"], ["categorizacion", "Categorización"], ["otros", "Otros"]]
const ACCIONES: [Accion, string][] = [
  ["bloqueo", "Bloqueo de usuario"], ["agradecimiento", "Agradecimiento"], ["traslado", "Traslado de página"],
  ["subida", "Subida de archivo"], ["otra", "Otra acción"],
]
const DURACIONES: [string, string][] = [["31 hours", "31 horas"], ["1 week", "1 semana"], ["1 month", "1 mes"], ["infinite", "Indefinida"]]
export const NOMBRE_WIKI: Record<WikiCrud, string> = { enwiki: "English Wikipedia", eswiki: "Wikipedia en español" }
const PREFIJO: Record<WikiCrud, { usuario: string; categoria: string; archivo: string }> = {
  enwiki: { usuario: "User:", categoria: "Category:", archivo: "File:" },
  eswiki: { usuario: "Usuario:", categoria: "Categoría:", archivo: "Archivo:" },
}
const TEXTO_CAT: Record<WikiCrud, { añadida: string; quitada: string }> = {
  enwiki: { añadida: "added to category", quitada: "removed from category" },
  eswiki: { añadida: "añadida a la categoría", quitada: "eliminada de la categoría" },
}

export const nuevoId = () => `demo-crud-${Date.now()}`
const sinPrefijo = (t: string) => t.split(":").slice(1).join(":") || t

function plantilla(tipo: Tipo, accion: Accion, wiki: WikiCrud, prueba = false): Doc {
  const id = nuevoId()
  const ahora = new Date()
  const dt = ahora.toISOString().replace(/\.\d+Z$/, "Z")
  const p = PREFIJO[wiki]
  const base: Doc = {
    _id: id, type: "edit", wiki, namespace: 0, title: "demo_titulo", user: "demo_editor", bot: false, comment: "",
    timestamp: Math.floor(ahora.getTime() / 1000),
  }
  const meta = { id, dt, domain: `${wiki.slice(0, 2)}.wikipedia.org`, stream: "mediawiki.recentchange" }
  let extra: Doc
  if (tipo === "edicion") {
    extra = { minor: false, comment: "Edición creada para la demostración del CRUD", length: { old: 1000, new: 1200 }, revision: { old: 1380853875, new: 1380853876 } }
  } else if (tipo === "nueva") {
    extra = { type: "new", title: "Demo página nueva", comment: "Página creada para la demostración del CRUD", length: { new: 1840 }, revision: { new: 1380853877 } }
  } else if (tipo === "categorizacion") {
    extra = { type: "categorize", namespace: 14, title: `${p.categoria}demo_categoria`, comment: `[[:demo_titulo]] ${TEXTO_CAT[wiki].añadida}` }
  } else {
    const log = (log_type: string, log_action: string, params: Doc = {}) => ({ type: "log", log_type, log_action, log_params: params })
    extra = {
      bloqueo: { ...log("block", "block", { duration: "31 hours", flags: "nocreate" }), namespace: 2, title: `${p.usuario}demo_vandalo`, user: "demo_admin", comment: "Vandalismo reiterado" },
      agradecimiento: { ...log("thanks", "thank"), namespace: 2, title: `${p.usuario}demo_patrullero` },
      traslado: { ...log("move", "move", { target: "demo_titulo_2", noredir: "0" }), comment: "Título más preciso" },
      subida: { ...log("upload", "upload"), namespace: 6, title: `${p.archivo}demo_archivo.png`, comment: "Imagen subida para la demostración" },
      otra: { ...log("delete", "delete"), comment: "Página de prueba" },
    }[accion]
  }
  const doc: Doc = { ...base, ...extra, meta }
  if (prueba) return doc
  // Sin datos de prueba: misma forma, con los campos que se escriben a mano vacíos.
  const vacio: Doc = { ...doc, title: "", user: "", comment: "" }
  if ("length" in doc) vacio.length = {}
  if ("revision" in doc) vacio.revision = {}
  if ("log_params" in doc) vacio.log_params = {}
  return vacio
}

const tipoDe = (d: Doc): Tipo => ({ edit: "edicion", new: "nueva", categorize: "categorizacion" } as Record<string, Tipo>)[String(d.type)] ?? "otros"
const accionDe = (d: Doc): Accion => ({ block: "bloqueo", thanks: "agradecimiento", move: "traslado", upload: "subida" } as Record<string, Accion>)[String(d.log_type)] ?? "otra"
const tipoEditorDe = (d: Doc): TipoEditor => (d.bot === true ? "bot" : String(d.user ?? "").startsWith("~") ? "temporal" : "registrado")
const texto = (d: Doc) => JSON.stringify(d, null, 2)
const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {})

/** Estado compartido por el formulario y el editor. */
export function useEventoNuevo(wikiCabecera: WikiCrud) {
  const [valor, setValor] = useState(() => texto(plantilla("edicion", "bloqueo", wikiCabecera)))
  const ultimoValido = useRef<Doc>({})
  const { doc, error } = useMemo(() => {
    try {
      const d = JSON.parse(valor)
      if (!d || typeof d !== "object" || Array.isArray(d)) return { doc: null, error: "El documento debe ser un objeto { … }" }
      return { doc: d as Doc, error: null }
    } catch (e) {
      return { doc: null, error: (e as Error).message }
    }
  }, [valor])
  if (doc) ultimoValido.current = doc
  const actual = doc ?? ultimoValido.current

  const cambiar = (f: (d: Doc) => Doc) => doc && setValor(texto(f(structuredClone(doc))))
  const wiki: WikiCrud = actual.wiki === "eswiki" ? "eswiki" : "enwiki"

  /** Cambia de wiki: ajusta el dominio y los prefijos traducibles del título (User: ↔ Usuario:). */
  const setWiki = (w: WikiCrud) => cambiar((d) => {
    const antes = PREFIJO[wiki], ahora = PREFIJO[w]
    const titulo = String(d.title ?? "")
    for (const k of ["usuario", "categoria", "archivo"] as const) {
      if (titulo.startsWith(antes[k])) d.title = ahora[k] + titulo.slice(antes[k].length)
    }
    if (typeof d.comment === "string") d.comment = d.comment.replace(TEXTO_CAT[wiki].añadida, TEXTO_CAT[w].añadida).replace(TEXTO_CAT[wiki].quitada, TEXTO_CAT[w].quitada)
    return { ...d, wiki: w, meta: { ...obj(d.meta), domain: `${w.slice(0, 2)}.wikipedia.org` } }
  })

  // El filtro de wiki de la cabecera manda: si cambia, el documento lo sigue.
  const cabeceraPrevia = useRef(wikiCabecera)
  useEffect(() => {
    if (cabeceraPrevia.current !== wikiCabecera) { cabeceraPrevia.current = wikiCabecera; setWiki(wikiCabecera) }
  })

  return {
    valor, setValor, doc, error, actual, wiki, setWiki, cambiar,
    tipo: tipoDe(actual), accion: accionDe(actual),
    setTipo: (t: Tipo) => setValor(texto(plantilla(t, "bloqueo", wiki))),
    setAccion: (a: Accion) => setValor(texto(plantilla("otros", a, wiki))),
    restablecer: () => setValor(texto(plantilla(tipoDe(actual), accionDe(actual), wiki))),
    /** Llena el documento con datos de demostración del tipo elegido. */
    completar: () => setValor(texto(plantilla(tipoDe(actual), accionDe(actual), wiki, true))),
    /** Tras insertar: mismo documento con un _id nuevo, listo para otra inserción. */
    renovarId: () => cambiar((d) => { const id = nuevoId(); return { ...d, _id: id, meta: { ...obj(d.meta), id } } }),
  }
}
export type EventoNuevo = ReturnType<typeof useEventoNuevo>

// ---------------------------------------------------------------- columna izquierda

export function Segmentado<T extends string>({ valor, opciones, onChange, etiqueta }: { valor: T; opciones: [T, string][]; onChange: (v: T) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex rounded-lg bg-muted p-[3px]">
      {opciones.map(([v, nombre]) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} onClick={() => onChange(v)}
          className={cn("h-8 flex-1 rounded-md px-2 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            valor === v ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>
          {nombre}
        </button>
      ))}
    </div>
  )
}

function Campo({ id, label, ayuda, children }: { id: string; label: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>}
    </div>
  )
}

function Texto({ id, valor, onChange, mono, ph }: { id: string; valor: unknown; onChange: (v: string) => void; mono?: boolean; ph?: string }) {
  return <Input id={id} placeholder={ph} className={mono ? "font-mono" : undefined} value={valor == null ? "" : String(valor)} onChange={(e) => onChange(e.target.value)} />
}

function Numero({ id, valor, onChange, sufijo, ph }: { id: string; valor: unknown; onChange: (v: number | undefined) => void; sufijo?: ReactNode; ph?: string }) {
  return (
    <div className="relative">
      <Input id={id} type="number" min={0} placeholder={ph} className="font-mono" value={typeof valor === "number" ? valor : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      {sufijo && <span className="pointer-events-none absolute top-1/2 right-9 -translate-y-1/2 font-mono text-xs">{sufijo}</span>}
    </div>
  )
}

function Desplegable({ id, valor, opciones, onChange }: { id: string; valor: string; opciones: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{opciones.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
    </Select>
  )
}

/** Wiki de destino, tipo de evento y los campos de ese tipo. */
export function FormularioEvento({ ev }: { ev: EventoNuevo }) {
  const d = ev.actual
  const p = PREFIJO[ev.wiki]
  const set = (campo: string, v: unknown) => ev.cambiar((x) => ({ ...x, [campo]: v }))
  const setEn = (padre: string, campo: string, v: unknown) => ev.cambiar((x) => ({ ...x, [padre]: { ...obj(x[padre]), [campo]: v } }))
  const titulo = String(d.title ?? "")
  const conPrefijo = (prefijo: string) => (v: string) => set("title", prefijo + v)
  const largo = obj(d.length), params = obj(d.log_params)

  const setTipoEditor = (t: string) => ev.cambiar((x) => {
    const user = String(x.user ?? "")
    if (t === "temporal") return { ...x, bot: false, user: user.startsWith("~") ? user : `~2026-${String(Date.now()).slice(-5)}` }
    return { ...x, bot: t === "bot", user: user.startsWith("~") ? "demo_editor" : user }
  })
  const tipoEditor = (id: string) => (
    <Campo id={id} label="Tipo de editor">
      <Desplegable id={id} valor={tipoEditorDe(d)} onChange={setTipoEditor} opciones={[["registrado", "Registrado"], ["temporal", "Temporal"], ["bot", "Bot"]]} />
    </Campo>
  )
  const editor = (label = "Editor") => <Campo id="ev-user" label={label}><Texto id="ev-user" ph="Ej. John Doe" valor={d.user} onChange={(v) => set("user", v)} /></Campo>
  const comentario = (label = "Comentario") => <Campo id="ev-com" label={label}><Texto id="ev-com" ph="Ej. Corrección de ortografía" valor={d.comment} onChange={(v) => set("comment", v)} /></Campo>
  const par = (a: ReactNode, b: ReactNode) => <div className="grid grid-cols-2 gap-3">{a}{b}</div>

  // Categorización: el comentario dice qué página entra o sale de la categoría.
  const cat = TEXTO_CAT[ev.wiki]
  const com = String(d.comment ?? "")
  const paginaCat = com.match(/\[\[:?([^|\]]*)/)?.[1] ?? ""
  const quitada = com.includes(cat.quitada)
  const setCat = (pagina: string, quitar: boolean) => set("comment", `[[:${pagina}]] ${quitar ? cat.quitada : cat.añadida}`)

  let campos: ReactNode
  if (ev.tipo === "edicion" || ev.tipo === "nueva") {
    const delta = typeof largo.new === "number" ? largo.new - (typeof largo.old === "number" ? largo.old : 0) : null
    campos = (
      <>
        <Campo id="ev-titulo" label={ev.tipo === "nueva" ? "Título de la página nueva" : "Título de la página"}><Texto id="ev-titulo" ph="Ej. Machu Picchu" valor={d.title} onChange={(v) => set("title", v)} /></Campo>
        {par(editor(), tipoEditor("ev-tipo-editor"))}
        {ev.tipo === "edicion" ? par(
          <Campo id="ev-antes" label="Bytes antes"><Numero id="ev-antes" ph="Ej. 12000" valor={largo.old} onChange={(v) => setEn("length", "old", v)} /></Campo>,
          <Campo id="ev-despues" label="Bytes después">
            <Numero id="ev-despues" ph="Ej. 12450" valor={largo.new} onChange={(v) => setEn("length", "new", v)}
              sufijo={delta != null && <span className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{delta >= 0 ? "+" : "−"}{Math.abs(delta)} B</span>} />
          </Campo>,
        ) : (
          <Campo id="ev-tam" label="Tamaño inicial (bytes)" ayuda="Una página nueva no tiene tamaño anterior.">
            <Numero id="ev-tam" ph="Ej. 3500" valor={largo.new} onChange={(v) => setEn("length", "new", v)} />
          </Campo>
        )}
        {comentario()}
      </>
    )
  } else if (ev.tipo === "categorizacion") {
    campos = (
      <>
        <Campo id="ev-cat" label="Categoría"><Texto id="ev-cat" ph="Ej. Patrimonio de la Humanidad" valor={sinPrefijo(titulo)} onChange={conPrefijo(p.categoria)} /></Campo>
        {par(
          <Campo id="ev-pag" label="Página"><Texto id="ev-pag" ph="Ej. Machu Picchu" valor={paginaCat} onChange={(v) => setCat(v, quitada)} /></Campo>,
          <Campo id="ev-cat-acc" label="La página se…">
            <Desplegable id="ev-cat-acc" valor={quitada ? "quitada" : "añadida"} onChange={(v) => setCat(paginaCat, v === "quitada")} opciones={[["añadida", "Añade"], ["quitada", "Quita"]]} />
          </Campo>,
        )}
        {par(editor(), tipoEditor("ev-tipo-editor"))}
      </>
    )
  } else {
    const a = ev.accion
    campos = (
      <>
        <Campo id="ev-accion" label="Acción" ayuda="Lo que quedó registrado en Wikipedia: log_type y log_action.">
          <Desplegable id="ev-accion" valor={a} onChange={(v) => ev.setAccion(v as Accion)} opciones={ACCIONES} />
        </Campo>
        {a === "bloqueo" && (
          <>
            {par(editor("Administrador"), <Campo id="ev-dest" label="Usuario bloqueado"><Texto id="ev-dest" ph="Ej. Vandalo123" valor={sinPrefijo(titulo)} onChange={conPrefijo(p.usuario)} /></Campo>)}
            {par(<Campo id="ev-dur" label="Duración"><Desplegable id="ev-dur" valor={String(params.duration ?? "31 hours")} onChange={(v) => setEn("log_params", "duration", v)} opciones={DURACIONES} /></Campo>, tipoEditor("ev-tipo-editor"))}
            {comentario("Motivo")}
          </>
        )}
        {a === "agradecimiento" && (
          <>
            {par(editor("Quién agradece"), <Campo id="ev-dest" label="Usuario agradecido"><Texto id="ev-dest" ph="Ej. Jane Doe" valor={sinPrefijo(titulo)} onChange={conPrefijo(p.usuario)} /></Campo>)}
            {tipoEditor("ev-tipo-editor")}
          </>
        )}
        {a === "traslado" && (
          <>
            {par(<Campo id="ev-titulo" label="Página original"><Texto id="ev-titulo" ph="Ej. Machu Pichu" valor={d.title} onChange={(v) => set("title", v)} /></Campo>,
              <Campo id="ev-dest" label="Nuevo título"><Texto id="ev-dest" ph="Ej. Machu Picchu" valor={params.target} onChange={(v) => setEn("log_params", "target", v)} /></Campo>)}
            {par(editor(), tipoEditor("ev-tipo-editor"))}
            {comentario("Motivo")}
          </>
        )}
        {a === "subida" && (
          <>
            <Campo id="ev-archivo" label="Nombre del archivo"><Texto id="ev-archivo" ph="Ej. Machu_Picchu.jpg" valor={sinPrefijo(titulo)} onChange={conPrefijo(p.archivo)} /></Campo>
            {par(editor(), tipoEditor("ev-tipo-editor"))}
            {comentario()}
          </>
        )}
        {a === "otra" && (
          <>
            {par(<Campo id="ev-logtipo" label="Tipo de registro"><Texto id="ev-logtipo" mono ph="Ej. protect" valor={d.log_type} onChange={(v) => ev.cambiar((x) => ({ ...x, log_type: v, log_action: v }))} /></Campo>,
              <Campo id="ev-titulo" label="Página afectada"><Texto id="ev-titulo" ph="Ej. Machu Picchu" valor={d.title} onChange={(v) => set("title", v)} /></Campo>)}
            {par(editor(), tipoEditor("ev-tipo-editor"))}
            {comentario()}
          </>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded border bg-background px-1.5 py-px font-mono text-[11px] font-medium">{ev.wiki.slice(0, 2).toUpperCase()}</span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-medium">Se insertará en {ev.wiki} · {NOMBRE_WIKI[ev.wiki]}</span>
            <span className="text-xs text-muted-foreground">Por defecto, la wiki elegida en el encabezado</span>
          </div>
        </div>
        <Segmentado etiqueta="Wiki de destino" valor={ev.wiki} onChange={ev.setWiki} opciones={[["enwiki", "enwiki"], ["eswiki", "eswiki"]]} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium">Tipo de evento</span>
        <Segmentado etiqueta="Tipo de evento" valor={ev.tipo} onChange={ev.setTipo} opciones={TIPOS} />
      </div>

      <fieldset disabled={!ev.doc} className="flex flex-col gap-3 border-t pt-3 disabled:opacity-50">
        <p className="text-xs text-muted-foreground">
          {ev.doc ? "Estos campos rellenan el JSON de la derecha. Lo que no esté aquí lo puedes cambiar en el editor." : "Corrige el JSON de la derecha para volver a usar el formulario."}
        </p>
        {campos}
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------- columna derecha

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Colorea el JSON: claves, textos, números y booleanos. */
export function resaltar(json: string) {
  return escapar(json).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, (m, cadena, dosPuntos, literal) => {
    if (cadena) return dosPuntos ? `<span class="text-zinc-700 dark:text-zinc-300">${cadena}</span>${dosPuntos}` : `<span class="text-green-700 dark:text-green-400">${cadena}</span>`
    if (literal) return `<span class="text-amber-700 dark:text-amber-400">${m}</span>`
    return `<span class="text-blue-700 dark:text-blue-400">${m}</span>`
  })
}

interface Previa { derived: Doc | null; faltan: string[] }

/** Editor JSON con números de línea, el bloque derived que calculará el servidor y el estado del validador. */
export function EditorEvento({ ev }: { ev: EventoNuevo }) {
  const pre = useRef<HTMLPreElement>(null)
  const numeros = useRef<HTMLDivElement>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const lineas = ev.valor.split("\n").length

  // Pide al servidor el derived y los campos que faltan (con una pausa para no llamar en cada tecla).
  useEffect(() => {
    if (!ev.doc) { setPrevia(null); return }
    const doc = ev.doc
    const t = setTimeout(() => {
      api<Previa>("/api/crud/mongo/previa", { method: "POST", body: JSON.stringify(doc) })
        .then(setPrevia)
        .catch(() => setPrevia(null))
    }, 350)
    return () => clearTimeout(t)
  }, [ev.doc])

  const desplazar = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget
    if (pre.current) { pre.current.scrollTop = scrollTop; pre.current.scrollLeft = scrollLeft }
    if (numeros.current) numeros.current.scrollTop = scrollTop
  }

  const faltan = previa?.faltan ?? []
  const estado = ev.error
    ? { ok: false, texto: <>JSON no válido: {ev.error}</> }
    : faltan.length
      ? { ok: false, texto: <>Falta {faltan.map((f, i) => <span key={f}>{i > 0 && ", "}<b className="font-mono font-semibold">{f}</b></span>)}. Si insertas, el validador de MongoDB lo rechazará.</> }
      : { ok: true, texto: <>Cumple el validador de events</> }

  return (
    <div className="flex h-[640px] flex-col overflow-hidden rounded-xl border bg-card shadow-xs lg:h-auto lg:min-h-[420px] lg:flex-1">
      <div className="flex items-center justify-between border-b px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="inline-flex size-[22px] items-center justify-center rounded-md bg-green-50 font-mono text-[11px] font-semibold text-green-700 dark:bg-green-950/50 dark:text-green-400" aria-hidden>{"{ }"}</span>
          Documento a insertar
        </span>
        <button type="button" onClick={ev.restablecer} className="h-7 rounded-md border px-2.5 text-xs transition-colors hover:bg-accent">Restablecer</button>
      </div>

      <div className="relative flex min-h-0 flex-1 font-mono text-[12.5px] leading-5">
        <div ref={numeros} aria-hidden className="w-10 shrink-0 overflow-hidden py-3 pr-3 text-right text-muted-foreground/50 select-none">
          {Array.from({ length: lineas }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre ref={pre} aria-hidden className="pointer-events-none absolute inset-0 m-0 overflow-hidden py-3 pr-4 font-[inherit] whitespace-pre"
            dangerouslySetInnerHTML={{ __html: resaltar(ev.valor) + "\n" }} />
          <textarea value={ev.valor} onChange={(e) => ev.setValor(e.target.value)} onScroll={desplazar} spellCheck={false} wrap="off"
            aria-label="Documento JSON a insertar" aria-invalid={Boolean(ev.error)}
            className="absolute inset-0 resize-none overflow-auto bg-transparent py-3 pr-4 font-[inherit] whitespace-pre text-transparent caret-foreground outline-none selection:bg-blue-200/60 dark:selection:bg-blue-800/60" />
        </div>
      </div>

      {previa?.derived && (
        <div className="max-h-[132px] shrink-0 overflow-auto border-t bg-muted/50 px-4 py-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground/80">derived</span>
            <span className="inline-flex h-[22px] items-center rounded-full bg-zinc-900 px-2.5 text-[11.5px] leading-none font-medium text-zinc-50 dark:bg-black dark:ring-1 dark:ring-white/15">
              calculado al insertar
            </span>
          </div>
          <pre className="m-0 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {Object.entries(previa.derived).filter(([k]) => k !== "event_dt").map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}
          </pre>
        </div>
      )}

      <div role="status" className={cn("flex items-center gap-1.5 border-t px-3.5 py-2.5 text-[12.5px]",
        estado.ok ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400")}>
        {estado.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <AlertCircle className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 truncate">{estado.texto}</span>
      </div>
    </div>
  )
}
