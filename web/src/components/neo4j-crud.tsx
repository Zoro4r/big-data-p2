import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Check, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Segmentado, type WikiCrud } from "@/components/crear-evento"
import {
  Antes, AvisoDemo, BotonPrueba, Campo, Coincidencias, ConfirmarEscribiendo, DialogoBorrar, esDemo, Ficha, InputEditable, Nota, Operaciones,
  Panel, Punto, QuePasa, Tabla, type Operacion,
} from "@/components/crud-comun"
import { Vacio } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { entero, horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** CRUD del grafo de editores en Neo4j: nodos :Editor y relaciones entre editores.
 *  Consultar sirve para cualquier editor; crear, actualizar y eliminar, solo para editores «Demo_…». */

interface Rel { tipo: string; con: string; etiqueta: string; props: Record<string, unknown> }
interface Detalle { editor: Record<string, unknown>; n_salientes: number; n_entrantes: number; salientes: Rel[]; entrantes: Rel[] }
interface Encontrado { user: string; tipo: string | null; relaciones: number }

const RELACIONES: [string, string][] = [["REVIRTIO", "REVIRTIO · revirtió a"], ["MENSAJE_A", "MENSAJE_A · le escribió a"], ["AGRADECIO", "AGRADECIO · agradeció a"], ["BLOQUEO", "BLOQUEO · bloqueó a"]]
const TIPOS_REL = new Set(RELACIONES.map(([t]) => t))
const TIPOS_EDITOR: [string, string][] = [["registrado", "Registrado"], ["temporal", "Temporal"], ["bot", "Bot"]]
/** Valor legible: las fechas de Neo4j (ISO con nanosegundos) se muestran en UTC−5: «31 oct · 12:16 UTC−5». */
const mostrar = (v: unknown) => (v == null ? "—"
  : typeof v === "string" ? (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? `${horaLocal(v.replace(/\.(\d{3})\d*/, ".$1"))} UTC−5` : v)
  : Array.isArray(v) ? `${v.length} elementos` : JSON.stringify(v))
const props = (p: Record<string, unknown>) => Object.entries(p).filter(([k]) => k !== "ventanas").map(([k, v]) => `${k}: ${mostrar(v)}`).join(" · ") || "—"
const nRel = (n: number) => `${entero(n)} ${n === 1 ? "relación" : "relaciones"}`

const Selector = ({ id, valor, opciones, onChange }: { id: string; valor: string; opciones: [string, string][]; onChange: (v: string) => void }) => (
  <Select value={valor} onValueChange={onChange}>
    <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{opciones.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
  </Select>
)

/** Detalle de un editor, o null si no existe (sirve para avisar "nuevo" / "ya existe"). */
const pedirDetalle = (user: string) => api<Detalle>(`/api/crud/neo4j/editor/${encodeURIComponent(user)}`).catch(() => null)

export function useNeo4jCrud(wikiCabecera: WikiCrud) {
  const [op, setOp] = useState<Operacion>("Crear")
  const [ocupado, setOcupado] = useState(false)

  async function correr<T>(_op: string, detalle: string, llamada: () => Promise<T>, exito: (r: T) => string): Promise<T | null> {
    setOcupado(true)
    try {
      const r = await llamada()
      toast.success(exito(r))
      return r
    } catch (e) {
      const msg = (e as Error).message
      toast.error(msg)
      return null
    } finally {
      setOcupado(false)
    }
  }

  // ---------------------------------------------------------------- Crear
  const [modoCrear, setModoCrear] = useState<"nodo" | "relacion">("relacion")
  const [nodo, setNodo] = useState({ user: "", tipo: "registrado" })
  const [rel, setRel] = useState({ origen: "", destino: "", tipo: "REVIRTIO", veces: "1", wiki: wikiCabecera as string })
  useEffect(() => setRel((r) => ({ ...r, wiki: wikiCabecera })), [wikiCabecera])
  // Si los editores ya existen o no, para el dibujo de la derecha.
  const [existe, setExiste] = useState<Record<string, Detalle | null>>({})
  useEffect(() => {
    if (op !== "Crear") return
    const nombres = modoCrear === "nodo" ? [nodo.user] : [rel.origen, rel.destino]
    const t = setTimeout(async () => {
      const pares = await Promise.all(nombres.filter(Boolean).map(async (u) => [u, await pedirDetalle(u)] as const))
      setExiste(Object.fromEntries(pares))
    }, 300)
    return () => clearTimeout(t)
  }, [op, modoCrear, nodo.user, rel.origen, rel.destino])
  async function crear() {
    if (modoCrear === "nodo") {
      const r = await correr("CREATE", `(:Editor {user: "${nodo.user}"})`,
        () => api<{ creado: boolean }>("/api/crud/neo4j/editor", { method: "POST", body: JSON.stringify(nodo) }),
        (x) => (x.creado ? "Nodo creado" : "El nodo ya existía: se actualizó su tipo"))
      if (r) setExiste({ [nodo.user]: await pedirDetalle(nodo.user) })
    } else {
      const r = await correr("CREATE", `(${rel.origen})-[:${rel.tipo}]->(${rel.destino})`,
        () => api<{ nodos_nuevos: string[] }>("/api/crud/neo4j/relacion", { method: "POST", body: JSON.stringify({ ...rel, veces: Number(rel.veces) || 1 }) }),
        (x) => `Relación creada${x.nodos_nuevos.length ? ` · ${x.nodos_nuevos.length} ${x.nodos_nuevos.length === 1 ? "nodo nuevo" : "nodos nuevos"}` : ""}`)
      if (r) setExiste({ [rel.origen]: await pedirDetalle(rel.origen), [rel.destino]: await pedirDetalle(rel.destino) })
    }
  }

  // ---------------------------------------------------------------- Consultar
  const [filtro, setFiltro] = useState({ prefijo: "", tipo: "todos" })
  const [encontrados, setEncontrados] = useState<Encontrado[] | null>(null)
  const [elegido, setElegido] = useState(0)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  async function buscar() {
    if (!filtro.prefijo.trim()) { toast.error("Escribe el comienzo del nombre del editor"); return }
    const params = new URLSearchParams({ prefijo: filtro.prefijo.trim(), ...(filtro.tipo !== "todos" ? { tipo: filtro.tipo } : {}) })
    const r = await correr("READ", `editores «${filtro.prefijo}…»`, () => api<Encontrado[]>(`/api/crud/neo4j/editores?${params}`),
      (x) => `${x.length} ${x.length === 1 ? "editor" : "editores"}`)
    if (r) { setEncontrados(r); elegir(r, 0) }
  }
  async function elegir(lista: Encontrado[], i: number) {
    setElegido(i)
    setDetalle(lista[i] ? await pedirDetalle(lista[i].user) : null)
  }

  // ---------------------------------------------------------------- Actualizar y eliminar: un editor cargado
  const [user, setUser] = useState("")
  const [cargado, setCargado] = useState<Detalle | null>(null)
  const [cambios, setCambios] = useState<Record<string, string>>({})
  const [nuevaProp, setNuevaProp] = useState({ clave: "", valor: "" })
  async function cargar(u = user) {
    setOcupado(true)
    const d = await pedirDetalle(u.trim())
    setOcupado(false)
    if (!d) { toast.error("Ese editor no existe"); setCargado(null); return }
    setCargado(d); setCambios({}); setBorrado(null); setConfirmacion(""); setRelElegida(null)
  }
  const original = (k: string) => (cargado?.editor[k] == null ? "" : String(cargado.editor[k]))
  const valor = (k: string) => (k in cambios ? cambios[k] : original(k))
  const poner = (k: string, v: string) => setCambios((x) => { const s = { ...x, [k]: v }; if (v === original(k)) delete s[k]; return s })
  const deshacer = (k: string) => setCambios((x) => { const s = { ...x }; delete s[k]; return s })
  function agregarProp() {
    const k = nuevaProp.clave.trim()
    if (!k || k === "user") { toast.error(k === "user" ? "user es la clave única y no se cambia" : "Escribe el nombre de la propiedad"); return }
    poner(k, nuevaProp.valor)
    setNuevaProp({ clave: "", valor: "" })
  }
  async function guardar() {
    if (!cargado) return
    const u = String(cargado.editor.user)
    const r = await correr("UPDATE", `${u} · ${Object.keys(cambios).join(", ")}`,
      () => api<Record<string, unknown>>(`/api/crud/neo4j/editor/${encodeURIComponent(u)}`, { method: "PATCH", body: JSON.stringify({ cambios }) }),
      () => "Propiedades actualizadas")
    if (r) { setCargado({ ...cargado, editor: r }); setCambios({}) }
  }

  // ---------------------------------------------------------------- Eliminar
  const [modoBorrar, setModoBorrar] = useState<"nodo" | "relacion">("nodo")
  const [relElegida, setRelElegida] = useState<number | null>(null)
  const [confirmacion, setConfirmacion] = useState("")
  const [dialogo, setDialogo] = useState(false)
  const [borrado, setBorrado] = useState<string | null>(null)
  const relacionesBorrables = (cargado?.salientes ?? []).filter((r) => TIPOS_REL.has(r.tipo))
  const listoParaBorrar = Boolean(cargado) && (modoBorrar === "nodo" ? confirmacion.trim() === String(cargado?.editor.user) : relElegida != null)
  async function eliminar() {
    if (!cargado) return
    const u = String(cargado.editor.user)
    if (modoBorrar === "nodo") {
      const r = await correr("DELETE", `DETACH DELETE ${u}`,
        () => api<{ nodos_eliminados: number; relaciones_eliminadas: number }>(`/api/crud/neo4j/editor/${encodeURIComponent(u)}`, { method: "DELETE" }),
        (x) => `Nodo eliminado con sus ${x.relaciones_eliminadas} relaciones`)
      if (r) { setBorrado(`DETACH DELETE · ${u} · ${nRel(r.relaciones_eliminadas)} borradas`); setCargado(null) }
    } else if (relElegida != null) {
      const x = relacionesBorrables[relElegida]
      const r = await correr("DELETE", `(${u})-[:${x.tipo}]->(${x.con})`,
        () => api<{ relaciones_eliminadas: number }>(`/api/crud/neo4j/relacion?${new URLSearchParams({ origen: u, destino: x.con, tipo: x.tipo })}`, { method: "DELETE" }),
        () => "Relación eliminada")
      if (r) { setBorrado(`DELETE · (${u})-[:${x.tipo}]->(${x.con})`); await cargar(u); setBorrado(`DELETE · (${u})-[:${x.tipo}]->(${x.con})`) }
    }
    setDialogo(false); setConfirmacion(""); setRelElegida(null)
  }

  /** «Completar con datos de prueba»: los formularios empiezan vacíos y esto los llena con editores «Demo_». */
  async function completarPrueba() {
    if (op === "Crear") {
      if (modoCrear === "nodo") setNodo({ user: "Demo_Patrullero", tipo: "registrado" })
      else setRel({ origen: "Demo_Patrullero", destino: "Demo_Vandalo", tipo: "REVIRTIO", veces: "1", wiki: wikiCabecera })
      return
    }
    if (op === "Consultar") { setFiltro({ prefijo: "Demo_", tipo: "todos" }); return }
    // Actualizar y eliminar necesitan un editor que exista.
    const d = await pedirDetalle("Demo_Patrullero")
    if (!d) { toast.info("No existe Demo_Patrullero: créalo en «Crear» y vuelve aquí"); return }
    setUser("Demo_Patrullero"); setModoBorrar("nodo")
    cargar("Demo_Patrullero")
  }

  /** Desde la ficha de Consultar: lleva el editor a Actualizar o Eliminar. */
  function irA(destino: Operacion, u: string) {
    setUser(u); setModoBorrar("nodo"); setOp(destino)
    cargar(u)
  }

  return {
    op, setOp, ocupado,
    modoCrear, setModoCrear, nodo, setNodo, rel, setRel, existe, crear,
    filtro, setFiltro, encontrados, elegido, elegir, detalle, buscar,
    user, setUser, cargado, cargar, cambios, valor, original, poner, deshacer, nuevaProp, setNuevaProp, agregarProp, guardar,
    modoBorrar, setModoBorrar, relElegida, setRelElegida, relacionesBorrables, confirmacion, setConfirmacion, dialogo, setDialogo, borrado, listoParaBorrar, eliminar, irA,
    completarPrueba,
  }
}
export type Neo4jCrud = ReturnType<typeof useNeo4jCrud>

// ---------------------------------------------------------------- columna izquierda

function CargarEditor({ n, etiqueta = "Editor" }: { n: Neo4jCrud; etiqueta?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <Campo id="nk-user" label={etiqueta} ayuda="Escribe el nombre exacto o llega desde Consultar.">
        <Input id="nk-user" placeholder="Ej. John Doe" value={n.user} onChange={(e) => n.setUser(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); n.cargar() } }} />
      </Campo>
      <Button type="button" variant="outline" className="mb-5" disabled={n.ocupado || !n.user.trim()} onClick={() => n.cargar()}>Cargar</Button>
    </div>
  )
}

const FichaEditor = ({ d }: { d: Detalle }) => (
  <Ficha titulo={String(d.editor.user)}>:Editor<Punto />{String(d.editor.tipo ?? "—")}<Punto />{nRel(d.n_salientes + d.n_entrantes)}</Ficha>
)

export function Neo4jIzquierda({ n }: { n: Neo4jCrud }) {
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (n.op === "Crear") n.crear()
    if (n.op === "Consultar") n.buscar()
    if (n.op === "Actualizar") n.guardar()
    if (n.op === "Eliminar" && n.listoParaBorrar) n.setDialogo(true)
  }
  const nCambios = Object.keys(n.cambios).length
  const r = n.rel
  const puedeCrear = n.modoCrear === "nodo" ? esDemo(n.nodo.user) : esDemo(r.origen) && esDemo(r.destino) && r.origen !== r.destino
  const editoresEditables = n.cargado ? Object.keys({ ...n.cargado.editor, ...n.cambios }).filter((k) => !["user", "tipo"].includes(k) && typeof (n.cargado!.editor[k] ?? "") !== "object") : []
  const u = n.cargado ? String(n.cargado.editor.user) : ""
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Operaciones valor={n.op} onChange={n.setOp} />
      <BotonPrueba onClick={n.completarPrueba} />

      {n.op === "Crear" && (
        <>
          <Campo id="nc-que" label="Qué crear"><Segmentado etiqueta="Qué crear" valor={n.modoCrear} onChange={n.setModoCrear} opciones={[["nodo", "Nodo :Editor"], ["relacion", "Relación"]]} /></Campo>
          {n.modoCrear === "nodo" ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo id="nc-user" label="Editor (user)" ayuda={<AvisoDemo nombre={n.nodo.user} />}><Input id="nc-user" placeholder="Ej. John Doe" value={n.nodo.user} onChange={(e) => n.setNodo({ ...n.nodo, user: e.target.value })} /></Campo>
              <Campo id="nc-tipo" label="Tipo de editor"><Selector id="nc-tipo" valor={n.nodo.tipo} opciones={TIPOS_EDITOR} onChange={(v) => n.setNodo({ ...n.nodo, tipo: v })} /></Campo>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo id="nc-origen" label="Desde (editor)" ayuda={<AvisoDemo nombre={r.origen} />}><Input id="nc-origen" placeholder="Ej. John Doe" value={r.origen} onChange={(e) => n.setRel({ ...r, origen: e.target.value })} /></Campo>
                <Campo id="nc-destino" label="Hacia (editor)" ayuda={<AvisoDemo nombre={r.destino} />}><Input id="nc-destino" placeholder="Ej. Jane Doe" value={r.destino} onChange={(e) => n.setRel({ ...r, destino: e.target.value })} /></Campo>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                <Campo id="nc-tipo-rel" label="Tipo de relación"><Selector id="nc-tipo-rel" valor={r.tipo} opciones={RELACIONES} onChange={(v) => n.setRel({ ...r, tipo: v })} /></Campo>
                <Campo id="nc-veces" label="Veces"><Input id="nc-veces" placeholder="Ej. 3" type="number" min={1} className="font-mono" value={r.veces} onChange={(e) => n.setRel({ ...r, veces: e.target.value })} /></Campo>
              </div>
              <Campo id="nc-wiki" label="Wiki" ayuda="En qué wiki ocurrió; por defecto, la del encabezado.">
                <Segmentado etiqueta="Wiki de la relación" valor={r.wiki as WikiCrud} onChange={(w) => n.setRel({ ...r, wiki: w })} opciones={[["enwiki", "enwiki"], ["eswiki", "eswiki"]]} />
              </Campo>
              <Nota>Si un editor no existe, se crea con MERGE junto con la relación. Si la relación ya existe, se actualizan sus propiedades.</Nota>
            </>
          )}
          <Button type="submit" disabled={n.ocupado || !puedeCrear} className="h-10 w-full text-sm">{n.modoCrear === "nodo" ? "Crear nodo" : "Crear relación"}</Button>
        </>
      )}

      {n.op === "Consultar" && (
        <>
          <Campo id="nq-prefijo" label="Editor" ayuda="Empieza con… Funciona con cualquier editor real.">
            <Input id="nq-prefijo" placeholder="Ej. John" value={n.filtro.prefijo} onChange={(e) => n.setFiltro({ ...n.filtro, prefijo: e.target.value })} />
          </Campo>
          <Campo id="nq-tipo" label="Tipo de editor"><Selector id="nq-tipo" valor={n.filtro.tipo} opciones={[["todos", "Todos"], ...TIPOS_EDITOR]} onChange={(v) => n.setFiltro({ ...n.filtro, tipo: v })} /></Campo>
          <Button type="submit" disabled={n.ocupado} className="h-10 w-full text-sm"><Search aria-hidden />Buscar</Button>
          {n.encontrados && (
            <Coincidencias items={n.encontrados} elegido={n.elegido} onElegir={(i) => n.elegir(n.encontrados!, i)}
              clave={(x) => x.user} titulo={(x) => x.user} sub={(x) => x.tipo ?? "—"} derecha={(x) => nRel(x.relaciones)} />
          )}
        </>
      )}

      {n.op === "Actualizar" && (
        <>
          <CargarEditor n={n} />
          {n.cargado && (
            <>
              <FichaEditor d={n.cargado} />
              <div className="flex flex-col gap-3 border-t pt-3">
                <span className="text-xs text-muted-foreground">Propiedades del nodo. «user» es la clave única y no se cambia.</span>
                <Campo id="nu-tipo" label="tipo" editado={"tipo" in n.cambios}>
                  <Selector id="nu-tipo" valor={n.valor("tipo") || "registrado"} opciones={TIPOS_EDITOR} onChange={(v) => n.poner("tipo", v)} />
                </Campo>
                {editoresEditables.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {editoresEditables.map((k) => (
                      <Campo key={k} id={`nu-${k}`} label={k} editado={k in n.cambios}>
                        <InputEditable id={`nu-${k}`} valor={n.valor(k)} original={n.original(k)} onChange={(v) => n.poner(k, v)} onDeshacer={() => n.deshacer(k)} />
                      </Campo>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                  <Campo id="nu-nueva-clave" label="Nueva propiedad"><Input id="nu-nueva-clave" placeholder="Ej. rol" value={n.nuevaProp.clave} onChange={(e) => n.setNuevaProp({ ...n.nuevaProp, clave: e.target.value })} /></Campo>
                  <Campo id="nu-nueva-valor" label="Valor"><Input id="nu-nueva-valor" placeholder="Ej. patrullero" value={n.nuevaProp.valor} onChange={(e) => n.setNuevaProp({ ...n.nuevaProp, valor: e.target.value })} /></Campo>
                  <Button type="button" variant="outline" onClick={n.agregarProp}><Plus aria-hidden />Agregar</Button>
                </div>
                <AvisoDemo nombre={u} />
              </div>
            </>
          )}
          <Button type="submit" disabled={n.ocupado || !nCambios || !n.cargado || !esDemo(u)} className="h-10 w-full text-sm">
            <Check aria-hidden />{nCambios ? `Guardar ${nCambios} ${nCambios === 1 ? "cambio" : "cambios"}` : "Guardar cambios"}
          </Button>
        </>
      )}

      {n.op === "Eliminar" && (
        <>
          <Campo id="nd-que" label="Qué eliminar">
            <Segmentado etiqueta="Qué eliminar" valor={n.modoBorrar} onChange={(m) => { n.setModoBorrar(m); n.setConfirmacion(""); n.setRelElegida(null) }}
              opciones={[["nodo", "Nodo :Editor"], ["relacion", "Una relación"]]} />
          </Campo>
          <CargarEditor n={n} etiqueta={n.modoBorrar === "nodo" ? "Editor" : "Desde (editor)"} />
          {n.cargado && <FichaEditor d={n.cargado} />}
          {n.cargado && n.modoBorrar === "nodo" && (
            <ConfirmarEscribiendo id="nd-confirmar" etiqueta="Para confirmar, escribe el editor" valor={u} texto={n.confirmacion} onChange={n.setConfirmacion} />
          )}
          {n.cargado && n.modoBorrar === "relacion" && (
            n.relacionesBorrables.length ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <span className="text-sm font-medium">Elige la relación</span>
                {n.relacionesBorrables.map((x, i) => (
                  <button key={`${x.tipo}-${x.con}`} type="button" onClick={() => n.setRelElegida(i)} aria-pressed={n.relElegida === i}
                    className={cn("flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent/50",
                      n.relElegida === i && "border-foreground ring-[3px] ring-muted")}>
                    <span className="font-mono text-xs">[:{x.tipo}] → {x.con}</span><span className="text-xs text-muted-foreground">{props(x.props)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="border-t pt-3 text-[13px] text-muted-foreground">Este editor no tiene relaciones salientes con otros editores.</p>
          )}
          {n.cargado && <AvisoDemo nombre={u} />}
          <Button type="submit" variant="destructive" disabled={n.ocupado || !n.listoParaBorrar || !esDemo(u)} className="h-10 w-full text-sm">
            <Trash2 aria-hidden />{n.modoBorrar === "nodo" ? "Eliminar nodo" : "Eliminar relación"}
          </Button>
          <DialogoBorrar abierto={n.dialogo} onCerrar={() => n.setDialogo(false)} onConfirmar={n.eliminar} ocupado={n.ocupado}
            titulo={n.modoBorrar === "nodo" ? `¿Eliminar a ${u}?` : "¿Eliminar la relación?"}
            descripcion={n.modoBorrar === "nodo"
              ? <>DETACH DELETE borra el nodo y sus {nRel((n.cargado?.n_salientes ?? 0) + (n.cargado?.n_entrantes ?? 0))}. No se puede deshacer.</>
              : n.relElegida != null ? <>Se borrará ({u})-[:{n.relacionesBorrables[n.relElegida].tipo}]→({n.relacionesBorrables[n.relElegida].con}). Los dos nodos siguen existiendo.</> : null}>
            {n.cargado && <FichaEditor d={n.cargado} />}
          </DialogoBorrar>
        </>
      )}
    </form>
  )
}

// ---------------------------------------------------------------- columna derecha

function NodoCaja({ nombre, estado, oscuro }: { nombre: string; estado?: ReactNode; oscuro?: boolean }) {
  return (
    <div className={cn("flex w-44 flex-col items-center gap-0.5 rounded-xl border px-3 py-2.5 text-center", oscuro ? "border-foreground bg-foreground text-background" : "bg-card")}>
      <span className={cn("text-[11px]", oscuro ? "opacity-70" : "text-muted-foreground")}>:Editor</span>
      <span className="w-full truncate text-[13.5px] font-semibold">{nombre || "—"}</span>
      {estado && <span className={cn("text-[11px]", oscuro ? "opacity-70" : "text-muted-foreground")}>{estado}</span>}
    </div>
  )
}

/** Grafo alrededor de un editor: entrantes a la izquierda, salientes a la derecha (hasta 5 de cada lado). */
function MiniGrafo({ d }: { d: Detalle }) {
  const izq = d.entrantes.slice(0, 5), der = d.salientes.slice(0, 5)
  const y = (i: number, n: number) => ((i + 1) / (n + 1)) * 100
  const caja = (x: Rel, lado: "izq" | "der", i: number, n: number) => (
    <div key={`${lado}-${i}`} className="absolute flex w-[30%] -translate-y-1/2 flex-col rounded-lg border bg-card px-2.5 py-1.5" style={{ top: `${y(i, n)}%`, [lado === "izq" ? "left" : "right"]: "2%" }}>
      <span className="truncate text-xs font-medium" title={x.con}>{x.con}</span>
      <span className="truncate font-mono text-[10.5px] text-muted-foreground">{lado === "izq" ? "→ " : ""}{x.tipo}{lado === "der" ? " →" : ""}</span>
    </div>
  )
  return (
    <div className={cn("relative mx-4 my-4 rounded-lg border border-dashed bg-muted/20", Math.max(izq.length, der.length) > 3 ? "h-[320px]" : "h-[240px]")}>
      <svg aria-hidden className="absolute inset-0 size-full text-muted-foreground/40" viewBox="0 0 100 100" preserveAspectRatio="none">
        {izq.map((_, i) => <line key={`l${i}`} x1="32" y1={y(i, izq.length)} x2="50" y2="50" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        {der.map((_, i) => <line key={`r${i}`} x1="50" y1="50" x2="68" y2={y(i, der.length)} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {izq.map((x, i) => caja(x, "izq", i, izq.length))}
      {der.map((x, i) => caja(x, "der", i, der.length))}
      <div className="absolute top-1/2 left-1/2 w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-foreground bg-foreground px-3 py-2.5 text-center text-background">
        <span className="block text-[11px] opacity-70">:Editor</span>
        <span className="block truncate text-[13.5px] font-semibold">{String(d.editor.user)}</span>
      </div>
      {!izq.length && !der.length && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">Sin relaciones</span>}
    </div>
  )
}

function TablaRelaciones({ d, alto }: { d: Detalle; alto?: number }) {
  const filas = [
    ...d.salientes.map((x) => [<span key="t" className="font-mono text-xs">{x.tipo}</span>, `→ ${x.con}`, props(x.props)]),
    ...d.entrantes.map((x) => [<span key="t" className="font-mono text-xs">{x.tipo}</span>, `← ${x.con}`, props(x.props)]),
  ]
  const total = d.n_salientes + d.n_entrantes
  return (
    <>
      {filas.length ? <Tabla columnas={["Tipo", "Con", "Propiedades"]} anchos="120px minmax(0,1fr) minmax(0,1.2fr)" filas={filas} alto={alto} />
        : <p className="px-4 py-5 text-[13px] text-muted-foreground">Este editor no tiene relaciones.</p>}
      {total > filas.length && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Se muestran {filas.length} de {entero(total)} relaciones.</p>}
    </>
  )
}

export function Neo4jDerecha({ n }: { n: Neo4jCrud }) {
  if (n.op === "Crear") {
    const estado = (u: string) => (!u ? "—" : n.existe[u] === undefined ? "…" : n.existe[u] ? "ya existe" : "nuevo")
    if (n.modoCrear === "nodo") {
      return (
        <div className="flex flex-col gap-4">
          <Panel titulo="Así quedará en el grafo" derecha={estado(n.nodo.user) === "nuevo" ? "1 nodo nuevo" : estado(n.nodo.user) === "ya existe" ? "se actualiza su tipo" : undefined}>
            <div className="flex h-[200px] items-center justify-center"><NodoCaja nombre={n.nodo.user} estado={`${n.nodo.tipo} · ${estado(n.nodo.user)}`} oscuro /></div>
          </Panel>
          <Panel titulo="Propiedades"><Tabla columnas={["Propiedad", "Valor"]} anchos="190px minmax(0,1fr)" filas={[["user (clave única)", n.nodo.user], ["tipo", n.nodo.tipo]]} /></Panel>
        </div>
      )
    }
    const r = n.rel
    const nuevos = [r.origen, r.destino].filter((u) => n.existe[u] === null).length
    return (
      <div className="flex flex-col gap-4">
        <Panel titulo="Así quedará en el grafo" derecha={`1 relación${nuevos ? ` · ${nuevos} ${nuevos === 1 ? "nodo nuevo" : "nodos nuevos"}` : ""}`}>
          <div className="flex h-[200px] items-center justify-center gap-3 px-4">
            <NodoCaja nombre={r.origen} estado={estado(r.origen)} />
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11.5px]">{r.tipo}</span>
              <div className="relative h-px w-full bg-muted-foreground/50"><span className="absolute -top-[5px] right-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-muted-foreground/50" /></div>
              <span className="text-[11.5px] text-muted-foreground">veces: {r.veces} · wiki: {r.wiki}</span>
            </div>
            <NodoCaja nombre={r.destino} estado={estado(r.destino)} oscuro />
          </div>
        </Panel>
        <Panel titulo="Elementos">
          <Tabla columnas={["Elemento", "Estado"]} anchos="230px minmax(0,1fr)" filas={[
            [<span key="o" className="font-mono text-xs">({r.origen})</span>, n.existe[r.origen] ? `ya existe · ${n.existe[r.origen]!.editor.tipo ?? "—"}` : "nuevo · registrado"],
            [<span key="d" className="font-mono text-xs">({r.destino})</span>, n.existe[r.destino] ? `ya existe · ${n.existe[r.destino]!.editor.tipo ?? "—"}` : "nuevo · registrado"],
            [<span key="r" className="font-mono text-xs">[:{r.tipo}]</span>, `veces: ${r.veces}, wiki: "${r.wiki}"`],
          ]} />
        </Panel>
      </div>
    )
  }

  if (n.op === "Consultar") {
    if (!n.encontrados) return <Vacio titulo="Realiza una consulta" texto="Escribe el comienzo del nombre del editor y presiona Buscar." />
    if (!n.encontrados.length) return <Vacio titulo="Sin coincidencias" texto="Ningún editor empieza así. Prueba con otro nombre o con otro tipo de editor." />
    if (!n.detalle) return <Vacio titulo="Cargando…" texto=" " />
    const d = n.detalle, u = String(d.editor.user)
    return (
      <div className="flex flex-col gap-4">
        <Panel titulo={u} derecha={n.encontrados.length > 1 ? `Coincidencia ${n.elegido + 1} de ${n.encontrados.length}` : "Encontrado"}>
          <MiniGrafo d={d} />
        </Panel>
        <Panel titulo="Relaciones" derecha={esDemo(u) ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => n.irA("Actualizar", u)}>Actualizar este</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-red-200 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400" onClick={() => n.irA("Eliminar", u)}>Eliminar</Button>
          </>
        ) : "editor real: solo lectura"}>
          <TablaRelaciones d={d} alto={320} />
        </Panel>
        <Panel titulo="Propiedades">
          <Tabla columnas={["Propiedad", "Valor"]} anchos="190px minmax(0,1fr)" filas={Object.entries(d.editor).map(([k, v]) => [<span key={k} className="font-mono text-xs">{k}</span>, mostrar(v)])} />
        </Panel>
      </div>
    )
  }

  if (n.op === "Actualizar") {
    if (!n.cargado) return <Vacio titulo="Carga un editor" texto="Escribe su nombre a la izquierda y presiona Cargar; aquí verás los cambios antes de guardarlos." />
    const filas = Object.entries(n.cambios).map(([k, v]) => [
      <span key="k" className="font-mono text-xs">{k}</span>, <Antes key="a">{n.original(k) || "—"}</Antes>, <b key="d" className="font-medium">{v || "—"}</b>,
    ])
    const despues = { ...n.cargado.editor, ...n.cambios }
    return (
      <div className="flex flex-col gap-4">
        <Panel titulo="Cambios a guardar" derecha={filas.length ? `${filas.length} ${filas.length === 1 ? "propiedad" : "propiedades"}` : "ninguno todavía"}>
          {filas.length ? <Tabla columnas={["Propiedad", "Antes", "Después"]} anchos="190px minmax(0,1fr) minmax(0,1fr)" filas={filas} alto={220} />
            : <p className="px-4 py-5 text-[13px] text-muted-foreground">Cambia una propiedad o agrega una nueva: aquí aparecerá su valor anterior y el nuevo.</p>}
        </Panel>
        <Panel titulo="Nodo después de guardar">
          <Tabla columnas={["Propiedad", "Valor"]} anchos="190px minmax(0,1fr)"
            filas={Object.entries(despues).map(([k, v]) => [<span key={k} className="font-mono text-xs">{k}{k === "user" && " (clave)"}</span>, k in n.cambios ? <b className="font-medium">{mostrar(v)}</b> : mostrar(v)])} />
        </Panel>
      </div>
    )
  }

  // Eliminar
  if (n.borrado && !n.cargado) {
    return <div role="status" className="flex flex-col gap-0.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs"><span className="text-sm font-semibold">Eliminado</span><span className="text-[12.5px] text-muted-foreground">{n.borrado}</span></div>
  }
  if (!n.cargado) return <Vacio titulo="Carga un editor" texto="Escribe su nombre a la izquierda y presiona Cargar; aquí verás qué se va a borrar." />
  const d = n.cargado
  return (
    <div className="flex flex-col gap-4">
      {n.borrado && <div role="status" className="rounded-xl border bg-card px-4 py-3 text-[13px] shadow-xs"><b className="font-medium">Eliminado</b> <span className="text-muted-foreground">· {n.borrado}</span></div>}
      {n.modoBorrar === "nodo" ? (
        <>
          <QuePasa filas={[
            ["Neo4j", `DETACH DELETE: se borra el nodo y sus ${nRel(d.n_salientes + d.n_entrantes)}. No se puede deshacer.`],
            ["Otros nodos", "Los editores y páginas conectados siguen existiendo; solo pierden la relación."],
            ["MongoDB y Cassandra", "No cambian. Si el editor vuelve a aparecer en el stream, el próximo lote del DAG lo vuelve a crear."],
          ]} />
          <Panel titulo="Relaciones que se borrarán" derecha={entero(d.n_salientes + d.n_entrantes)}><TablaRelaciones d={d} alto={320} /></Panel>
        </>
      ) : (
        <>
          <QuePasa filas={[
            ["Neo4j", "DELETE de una sola relación. Los dos nodos siguen existiendo con el resto de sus relaciones."],
            ["MongoDB y Cassandra", "No cambian."],
          ]} />
          <Panel titulo="Relación elegida">
            {n.relElegida != null ? (
              <Tabla columnas={["Desde", "Relación", "Hacia", "Propiedades"]} anchos="minmax(0,1fr) 120px minmax(0,1fr) minmax(0,1fr)"
                filas={[[String(d.editor.user), <span key="t" className="font-mono text-xs">{n.relacionesBorrables[n.relElegida].tipo}</span>, n.relacionesBorrables[n.relElegida].con, props(n.relacionesBorrables[n.relElegida].props)]]} />
            ) : <p className="px-4 py-5 text-[13px] text-muted-foreground">Elige a la izquierda la relación que quieres borrar.</p>}
          </Panel>
        </>
      )}
    </div>
  )
}
