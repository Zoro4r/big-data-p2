import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Check, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { WikiCrud } from "@/components/crear-evento"
import { Segmentado } from "@/components/crear-evento"
import {
  Antes, AvisoDemo, BotonPrueba, CajaWiki, Campo, Chip, Clave, Coincidencias, ConfirmarEscribiendo, DialogoBorrar, esDemo, Ficha, InputEditable,
  Nota, Operaciones, Panel, Punto, QuePasa, Tabla, type Operacion, type Registrar,
} from "@/components/crud-comun"
import { Vacio } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { bytes, entero } from "@/lib/format"

/** CRUD de la tabla actividad_editor de Cassandra (clave ((editor), fecha, hora, wiki)).
 *  Consultar sirve para cualquier editor; crear, actualizar y eliminar, solo para editores «Demo_…». */

export interface Fila {
  editor: string; fecha: string; hora: number; wiki: string; tipo_editor: string
  eventos: number; ediciones: number; paginas: number; delta_bytes: number; reversiones_hechas: number; reversiones_recibidas: number
}
type Metrica = "eventos" | "ediciones" | "paginas" | "delta_bytes" | "reversiones_hechas" | "reversiones_recibidas"
const METRICAS: [Metrica, string][] = [
  ["eventos", "Eventos"], ["ediciones", "Ediciones"], ["paginas", "Páginas"],
  ["delta_bytes", "Bytes (neto)"], ["reversiones_hechas", "Rev. hechas"], ["reversiones_recibidas", "Rev. recibidas"],
]
const BASE = "Cassandra · actividad_editor"
const hoy = () => new Date().toISOString().slice(0, 10)
const horaUtc = () => String(new Date().getUTCHours())
const HORAS: [string, string][] = Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, "0")}:00`])
const TIPOS_EDITOR: [string, string][] = [["registrado", "Registrado"], ["temporal", "Temporal"], ["bot", "Bot"]]
const etiquetaFila = (f: Pick<Fila, "fecha" | "hora" | "wiki">) => `${f.fecha} · ${String(f.hora).padStart(2, "0")}:00 UTC · ${f.wiki}`

/** Filas de la tabla «columna · valor», con la partición y las columnas de agrupación marcadas. */
function columnas(f: Fila, marcar: Set<string> = new Set()): ReactNode[][] {
  const v = (c: string, x: ReactNode) => (marcar.has(c) ? <b className="font-medium">{x}</b> : x)
  return [
    [<span key="e" className="font-mono text-xs">editor<Clave>partición</Clave></span>, f.editor],
    [<span key="f" className="font-mono text-xs">fecha<Clave>agrupación</Clave></span>, f.fecha],
    [<span key="h" className="font-mono text-xs">hora<Clave>agrupación</Clave></span>, String(f.hora)],
    [<span key="w" className="font-mono text-xs">wiki<Clave>agrupación</Clave></span>, f.wiki],
    [<span key="t" className="font-mono text-xs">tipo_editor</span>, v("tipo_editor", f.tipo_editor)],
    ...METRICAS.map(([c]) => [<span key={c} className="font-mono text-xs">{c}</span>, v(c, entero(f[c]))]),
  ]
}

const Selector = ({ id, valor, opciones, onChange }: { id: string; valor: string; opciones: [string, string][]; onChange: (v: string) => void }) => (
  <Select value={valor} onValueChange={onChange}>
    <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{opciones.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
  </Select>
)

export function useCassandraCrud(wikiCabecera: WikiCrud, registrar: Registrar) {
  const [op, setOp] = useState<Operacion>("Crear")
  const [ocupado, setOcupado] = useState(false)
  const [wiki, setWiki] = useState<WikiCrud>(wikiCabecera)
  useEffect(() => setWiki(wikiCabecera), [wikiCabecera])

  /** Corre una llamada con toast e historial; devuelve el resultado o null si falló. */
  async function correr<T>(opLog: Parameters<Registrar>[0], detalle: string, llamada: () => Promise<T>, exito?: (r: T) => string): Promise<T | null> {
    setOcupado(true)
    try {
      const r = await llamada()
      registrar(opLog, BASE, detalle, true)
      if (exito) toast.success(exito(r))
      return r
    } catch (e) {
      const msg = (e as Error).message
      registrar("RECHAZADO", BASE, msg, false)
      toast.error(msg)
      return null
    } finally {
      setOcupado(false)
    }
  }

  // ---------------------------------------------------------------- Crear
  const [nueva, setNueva] = useState({
    editor: "", tipo_editor: "registrado", fecha: hoy(), hora: horaUtc(),
    eventos: "", ediciones: "", paginas: "", delta_bytes: "", reversiones_hechas: "", reversiones_recibidas: "",
  })
  const filaNueva: Fila = {
    editor: nueva.editor, fecha: nueva.fecha, hora: Number(nueva.hora), wiki, tipo_editor: nueva.tipo_editor,
    ...Object.fromEntries(METRICAS.map(([c]) => [c, Number(nueva[c]) || 0])) as Record<Metrica, number>,
  }
  // Si ya hay una fila con esa clave, el INSERT la reemplazaría: se avisa antes.
  const [existente, setExistente] = useState<Fila | null>(null)
  useEffect(() => {
    if (op !== "Crear" || !nueva.editor || !nueva.fecha) { setExistente(null); return }
    const t = setTimeout(() => {
      api<Fila>(`/api/crud/cassandra/fila?${new URLSearchParams({ editor: nueva.editor, fecha: nueva.fecha, hora: nueva.hora, wiki })}`)
        .then(setExistente).catch(() => setExistente(null))
    }, 300)
    return () => clearTimeout(t)
  }, [op, nueva.editor, nueva.fecha, nueva.hora, wiki])
  const [insertada, setInsertada] = useState<{ fila: Fila; reemplazo: boolean } | null>(null)
  async function insertar() {
    const r = await correr("CREATE", `${filaNueva.editor} · ${etiquetaFila(filaNueva)}`,
      () => api<{ reemplazo: boolean; fila: Fila }>("/api/crud/cassandra", { method: "POST", body: JSON.stringify(filaNueva) }),
      (x) => (x.reemplazo ? "Fila reemplazada (la clave ya existía)" : "Fila insertada"))
    if (r) { setInsertada(r); setExistente(r.fila) }
  }

  // ---------------------------------------------------------------- Consultar
  const [consulta, setConsulta] = useState({ editor: "", fecha: "", hora: "todas" })
  const [resultados, setResultados] = useState<Fila[] | null>(null)
  const [elegido, setElegido] = useState(0)
  async function buscar() {
    if (!consulta.editor.trim()) { toast.error("Escribe el editor: Cassandra siempre consulta por partición"); return }
    const params = new URLSearchParams({ editor: consulta.editor.trim(), wiki, ...(consulta.fecha ? { fecha: consulta.fecha } : {}), ...(consulta.hora !== "todas" ? { hora: consulta.hora } : {}) })
    const r = await correr("READ", `SELECT · ${consulta.editor}`, () => api<Fila[]>(`/api/crud/cassandra?${params}`))
    if (r) { setResultados(r); setElegido(0) }
  }

  // ---------------------------------------------------------------- Actualizar y eliminar: una fila por su clave
  const [clave, setClave] = useState({ editor: "", fecha: hoy(), hora: horaUtc(), wiki: wikiCabecera as string })
  const [original, setOriginal] = useState<Fila | null>(null)
  const [cambios, setCambios] = useState<Record<string, string>>({})
  async function cargar(k = clave) {
    setOcupado(true)
    try {
      setOriginal(await api<Fila>(`/api/crud/cassandra/fila?${new URLSearchParams(k)}`))
      setCambios({})
      setBorrado(null)
    } catch (e) {
      setOriginal(null)
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  const valor = (c: string) => (c in cambios ? cambios[c] : String(original?.[c as keyof Fila] ?? ""))
  const poner = (c: string, v: string) => setCambios((x) => {
    const sig = { ...x, [c]: v }
    if (v === String(original?.[c as keyof Fila] ?? "")) delete sig[c]
    return sig
  })
  const deshacer = (c: string) => setCambios((x) => { const sig = { ...x }; delete sig[c]; return sig })
  async function guardar() {
    if (!original) return
    const body = { editor: original.editor, fecha: original.fecha, hora: original.hora, wiki: original.wiki,
      cambios: Object.fromEntries(Object.entries(cambios).map(([c, v]) => [c, c === "tipo_editor" ? v : Number(v) || 0])) }
    const r = await correr("UPDATE", `${original.editor} · ${Object.keys(cambios).join(", ")}`,
      () => api<Fila>("/api/crud/cassandra", { method: "PATCH", body: JSON.stringify(body) }), () => "Fila actualizada")
    if (r) { setOriginal(r); setCambios({}) }
  }

  // ---------------------------------------------------------------- Eliminar
  const [modo, setModo] = useState<"fila" | "particion">("fila")
  const [particion, setParticion] = useState<Fila[] | null>(null)
  const [confirmacion, setConfirmacion] = useState("")
  const [dialogo, setDialogo] = useState(false)
  const [borrado, setBorrado] = useState<string | null>(null)
  async function cargarParticion() {
    setOcupado(true)
    try {
      setParticion(await api<Fila[]>(`/api/crud/cassandra?${new URLSearchParams({ editor: clave.editor, limite: "200" })}`))
      setBorrado(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  const listoParaBorrar = confirmacion.trim() === clave.editor && (modo === "fila" ? Boolean(original) : Boolean(particion?.length))
  async function eliminar() {
    const params = modo === "fila" && original
      ? new URLSearchParams({ editor: original.editor, fecha: original.fecha, hora: String(original.hora), wiki: original.wiki })
      : new URLSearchParams({ editor: clave.editor })
    const detalle = modo === "fila" && original ? `${original.editor} · ${etiquetaFila(original)}` : `partición ${clave.editor}`
    const r = await correr("DELETE", detalle, () => api<{ filas_eliminadas: number }>(`/api/crud/cassandra?${params}`, { method: "DELETE" }),
      (x) => `${x.filas_eliminadas} ${x.filas_eliminadas === 1 ? "fila eliminada" : "filas eliminadas"}`)
    setDialogo(false)
    if (r) {
      setBorrado(`DELETE · ${r.filas_eliminadas} ${r.filas_eliminadas === 1 ? "fila" : "filas"} · ${detalle}`)
      setOriginal(null); setParticion(null); setConfirmacion("")
    }
  }

  /** «Completar con datos de prueba»: los formularios empiezan vacíos y esto los llena con «Demo_Editor». */
  async function completarPrueba() {
    if (op === "Crear") {
      setNueva({ editor: "Demo_Editor", tipo_editor: "registrado", fecha: hoy(), hora: horaUtc(), eventos: "12", ediciones: "9",
        paginas: "4", delta_bytes: "1250", reversiones_hechas: "1", reversiones_recibidas: "0" })
      return
    }
    if (op === "Consultar") { setConsulta({ editor: "Demo_Editor", fecha: "", hora: "todas" }); return }
    // Actualizar y eliminar necesitan una fila que exista: se toma la más reciente de Demo_Editor.
    const filas = await api<Fila[]>(`/api/crud/cassandra?${new URLSearchParams({ editor: "Demo_Editor", wiki, limite: "1" })}`).catch(() => [])
    if (!filas.length) { toast.info("No hay filas de Demo_Editor: crea una en «Crear» y vuelve aquí"); return }
    const f = filas[0]
    const k = { editor: f.editor, fecha: f.fecha, hora: String(f.hora), wiki: f.wiki }
    setClave(k); setModo("fila"); setConfirmacion("")
    cargar(k)
  }

  /** Desde la ficha de Consultar: lleva la fila a Actualizar o Eliminar. */
  function irA(destino: Operacion, f: Fila) {
    const k = { editor: f.editor, fecha: f.fecha, hora: String(f.hora), wiki: f.wiki }
    setClave(k); setModo("fila"); setConfirmacion(""); setOp(destino)
    cargar(k)
  }

  return {
    op, setOp, ocupado, wiki, setWiki,
    nueva, setNueva, filaNueva, existente, insertada, insertar,
    consulta, setConsulta, resultados, elegido, setElegido, buscar,
    clave, setClave, original, cambios, valor, poner, deshacer, cargar, guardar,
    modo, setModo, particion, cargarParticion, confirmacion, setConfirmacion, dialogo, setDialogo, borrado, listoParaBorrar, eliminar, irA,
    completarPrueba,
  }
}
export type CassandraCrud = ReturnType<typeof useCassandraCrud>

// ---------------------------------------------------------------- columna izquierda

function ClaveFila({ c }: { c: CassandraCrud }) {
  const k = c.clave
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo id="ck-editor" label="Editor" clave="partición"><Input id="ck-editor" value={k.editor} onChange={(e) => c.setClave({ ...k, editor: e.target.value })} /></Campo>
        <Campo id="ck-wiki" label="Wiki" clave="agrupación"><Segmentado etiqueta="Wiki de la fila" valor={k.wiki as WikiCrud} onChange={(w) => c.setClave({ ...k, wiki: w })} opciones={[["enwiki", "enwiki"], ["eswiki", "eswiki"]]} /></Campo>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
        <Campo id="ck-fecha" label="Fecha" clave="agrupación"><Input id="ck-fecha" type="date" value={k.fecha} onChange={(e) => c.setClave({ ...k, fecha: e.target.value })} /></Campo>
        <Campo id="ck-hora" label="Hora" clave="agrupación"><Selector id="ck-hora" valor={k.hora} opciones={HORAS} onChange={(v) => c.setClave({ ...k, hora: v })} /></Campo>
        <Button type="button" variant="outline" disabled={c.ocupado || !k.editor} onClick={() => c.cargar()}>Cargar</Button>
      </div>
      <span className="text-xs text-muted-foreground">La clave completa identifica la fila. Llega sola desde Consultar.</span>
    </div>
  )
}

function FichaFila({ f }: { f: Fila }) {
  return <Ficha titulo={f.editor}><Chip>{f.wiki.slice(0, 2).toUpperCase()}</Chip>{f.fecha}<Punto />{String(f.hora).padStart(2, "0")}:00 UTC<Punto />{f.tipo_editor}</Ficha>
}

export function CassandraIzquierda({ c }: { c: CassandraCrud }) {
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (c.op === "Crear") c.insertar()
    if (c.op === "Consultar") c.buscar()
    if (c.op === "Actualizar") c.guardar()
    if (c.op === "Eliminar" && c.listoParaBorrar) c.setDialogo(true)
  }
  const n = c.nueva
  const nCambios = Object.keys(c.cambios).length
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Operaciones valor={c.op} onChange={c.setOp} />
      <BotonPrueba onClick={c.completarPrueba} />

      {c.op === "Crear" && (
        <>
          <CajaWiki wiki={c.wiki} onChange={c.setWiki} verbo="Se insertará en" />
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Clave de la fila</span>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="cn-editor" label="Editor" clave="partición" ayuda={<AvisoDemo nombre={n.editor} />}>
              <Input id="cn-editor" value={n.editor} onChange={(e) => c.setNueva({ ...n, editor: e.target.value })} />
            </Campo>
            <Campo id="cn-tipo" label="Tipo de editor"><Selector id="cn-tipo" valor={n.tipo_editor} opciones={TIPOS_EDITOR} onChange={(v) => c.setNueva({ ...n, tipo_editor: v })} /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="cn-fecha" label="Fecha" clave="agrupación"><Input id="cn-fecha" type="date" value={n.fecha} onChange={(e) => c.setNueva({ ...n, fecha: e.target.value })} /></Campo>
            <Campo id="cn-hora" label="Hora (UTC)" clave="agrupación"><Selector id="cn-hora" valor={n.hora} opciones={HORAS} onChange={(v) => c.setNueva({ ...n, hora: v })} /></Campo>
          </div>
          <span className="border-t pt-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Actividad en esa hora</span>
          <div className="grid grid-cols-3 gap-3">
            {METRICAS.map(([m, et]) => (
              <Campo key={m} id={`cn-${m}`} label={et}>
                <Input id={`cn-${m}`} type="number" className="font-mono" value={n[m]} onChange={(e) => c.setNueva({ ...n, [m]: e.target.value })} />
              </Campo>
            ))}
          </div>
          <Button type="submit" disabled={c.ocupado || !esDemo(n.editor)} className="h-10 w-full text-sm">Insertar fila</Button>
        </>
      )}

      {c.op === "Consultar" && (
        <>
          <CajaWiki wiki={c.wiki} onChange={c.setWiki} verbo="Buscar en" />
          <Campo id="cq-editor" label="Editor" clave="partición" ayuda="Cassandra necesita la partición: siempre se consulta por editor. Funciona con cualquier editor real.">
            <Input id="cq-editor" value={c.consulta.editor} onChange={(e) => c.setConsulta({ ...c.consulta, editor: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="cq-fecha" label="Fecha" ayuda="Opcional"><Input id="cq-fecha" type="date" value={c.consulta.fecha} onChange={(e) => c.setConsulta({ ...c.consulta, fecha: e.target.value })} /></Campo>
            <Campo id="cq-hora" label="Hora"><Selector id="cq-hora" valor={c.consulta.hora} opciones={[["todas", "Todas"], ...HORAS]} onChange={(v) => c.setConsulta({ ...c.consulta, hora: v })} /></Campo>
          </div>
          <Button type="submit" disabled={c.ocupado} className="h-10 w-full text-sm"><Search aria-hidden />Buscar</Button>
          {c.resultados && (
            <Coincidencias items={c.resultados} elegido={c.elegido} onElegir={c.setElegido}
              clave={(f) => `${f.fecha}-${f.hora}-${f.wiki}`} titulo={(f) => `${f.fecha} · ${String(f.hora).padStart(2, "0")}:00 UTC`}
              sub={(f) => `${entero(f.eventos)} eventos · ${entero(f.ediciones)} ediciones`} derecha={(f) => f.wiki} />
          )}
        </>
      )}

      {c.op === "Actualizar" && (
        <>
          <ClaveFila c={c} />
          {c.original && (
            <>
              <FichaFila f={c.original} />
              <div className="flex flex-col gap-3 border-t pt-3">
                <span className="text-xs text-muted-foreground">La clave no se puede cambiar (en Cassandra sería otra fila). Cambia las métricas.</span>
                <div className="grid grid-cols-3 gap-3">
                  {METRICAS.map(([m, et]) => (
                    <Campo key={m} id={`cu-${m}`} label={et} editado={m in c.cambios}>
                      <InputEditable id={`cu-${m}`} tipo="number" mono valor={c.valor(m)} original={String(c.original![m])} onChange={(v) => c.poner(m, v)} onDeshacer={() => c.deshacer(m)} />
                    </Campo>
                  ))}
                </div>
                <Campo id="cu-tipo" label="Tipo de editor" editado={"tipo_editor" in c.cambios}>
                  <Selector id="cu-tipo" valor={c.valor("tipo_editor")} opciones={TIPOS_EDITOR} onChange={(v) => c.poner("tipo_editor", v)} />
                </Campo>
                <AvisoDemo nombre={c.original.editor} />
              </div>
            </>
          )}
          <Button type="submit" disabled={c.ocupado || !nCambios || !c.original || !esDemo(c.original.editor)} className="h-10 w-full text-sm">
            <Check aria-hidden />{nCambios ? `Guardar ${nCambios} ${nCambios === 1 ? "cambio" : "cambios"}` : "Guardar cambios"}
          </Button>
        </>
      )}

      {c.op === "Eliminar" && (
        <>
          <Segmentado etiqueta="Qué eliminar" valor={c.modo} onChange={(m) => { c.setModo(m); c.setConfirmacion("") }}
            opciones={[["fila", "Una fila"], ["particion", "Toda la partición del editor"]]} />
          {c.modo === "fila" ? <ClaveFila c={c} /> : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <Campo id="cd-editor" label="Editor" clave="partición"><Input id="cd-editor" value={c.clave.editor} onChange={(e) => c.setClave({ ...c.clave, editor: e.target.value })} /></Campo>
              <Button type="button" variant="outline" disabled={c.ocupado || !c.clave.editor} onClick={c.cargarParticion}>Cargar</Button>
            </div>
          )}
          {c.modo === "fila" && c.original && <FichaFila f={c.original} />}
          {c.modo === "particion" && c.particion && <Ficha titulo={c.clave.editor}>{c.particion.length} {c.particion.length === 1 ? "fila" : "filas"} en la partición</Ficha>}
          {((c.modo === "fila" && c.original) || (c.modo === "particion" && c.particion?.length)) && (
            <>
              <ConfirmarEscribiendo id="cd-confirmar" etiqueta="Para confirmar, escribe el editor" valor={c.clave.editor} texto={c.confirmacion} onChange={c.setConfirmacion} />
              <AvisoDemo nombre={c.clave.editor} />
            </>
          )}
          <Button type="submit" variant="destructive" disabled={c.ocupado || !c.listoParaBorrar || !esDemo(c.clave.editor)} className="h-10 w-full text-sm">
            <Trash2 aria-hidden />{c.modo === "fila" ? "Eliminar fila…" : "Eliminar partición…"}
          </Button>
          <DialogoBorrar abierto={c.dialogo} onCerrar={() => c.setDialogo(false)} onConfirmar={c.eliminar} ocupado={c.ocupado}
            titulo={c.modo === "fila" ? `¿Eliminar la fila de ${c.clave.editor}?` : `¿Eliminar toda la partición de ${c.clave.editor}?`}
            descripcion={c.modo === "fila" && c.original
              ? <>Se borrará la fila {etiquetaFila(c.original)} de actividad_editor. No se puede deshacer. MongoDB y Neo4j no cambian.</>
              : <>Se {c.particion?.length === 1 ? "borrará la única fila" : `borrarán las ${c.particion?.length ?? 0} filas`} de este editor (DELETE solo por partición). No se puede deshacer.</>}>
            {c.modo === "fila" && c.original && <FichaFila f={c.original} />}
          </DialogoBorrar>
        </>
      )}
    </form>
  )
}

// ---------------------------------------------------------------- columna derecha

function Cifras({ f }: { f: Fila }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 p-4">
      {METRICAS.map(([m, et]) => (
        <div key={m} className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
          <span className="text-xs text-muted-foreground">{et}</span>
          <span className="text-lg font-semibold tabular-nums">{m === "delta_bytes" ? bytes(f[m]) : entero(f[m])}</span>
        </div>
      ))}
    </div>
  )
}

export function CassandraDerecha({ c }: { c: CassandraCrud }) {
  if (c.op === "Crear") {
    return (
      <div className="flex flex-col gap-4">
        {c.insertada && (
          <div role="status" className="rounded-xl border bg-card px-4 py-3 text-[13px] shadow-xs">
            <b className="font-medium">{c.insertada.reemplazo ? "Fila reemplazada" : "Fila insertada"}</b>
            <span className="text-muted-foreground"> · {c.insertada.fila.editor} · {etiquetaFila(c.insertada.fila)}</span>
          </div>
        )}
        <Panel titulo="Fila a insertar" derecha="actividad_editor">
          <Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(c.filaNueva)} />
        </Panel>
        {c.existente && !c.insertada ? (
          <Nota>
            <b className="font-medium text-foreground">Ya hay una fila con esta clave.</b> Si insertas, se reemplaza: hoy tiene {entero(c.existente.eventos)} eventos y{" "}
            {entero(c.existente.ediciones)} ediciones. En Cassandra un INSERT con una clave existente no da error de duplicado: sobrescribe.
          </Nota>
        ) : (
          <Nota>En Cassandra un INSERT con una clave que ya existe <b className="font-medium text-foreground">reemplaza</b> la fila (no hay error de duplicado). Si esa clave ya tiene datos, aquí aparece un aviso.</Nota>
        )}
      </div>
    )
  }

  if (c.op === "Consultar") {
    if (!c.resultados) return <Vacio titulo="Realiza una consulta" texto="Escribe el editor y presiona Buscar; las filas de su partición aparecerán aquí." />
    if (!c.resultados.length) return <Vacio titulo="Sin filas" texto="Ese editor no tiene filas con estos filtros. Prueba otra fecha, otra hora u otra wiki." />
    const f = c.resultados[c.elegido]
    return (
      <div className="flex flex-col gap-4">
        <Panel titulo={`${f.editor} · ${etiquetaFila(f)}`} derecha={c.resultados.length > 1 ? `Fila ${c.elegido + 1} de ${c.resultados.length}` : "Encontrada"}>
          <Cifras f={f} />
        </Panel>
        <Panel titulo="Fila completa" derecha={esDemo(f.editor) ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => c.irA("Actualizar", f)}>Actualizar esta</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-red-200 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400" onClick={() => c.irA("Eliminar", f)}>Eliminar</Button>
          </>
        ) : "editor real: solo lectura"}>
          <Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(f)} />
        </Panel>
      </div>
    )
  }

  if (c.op === "Actualizar") {
    if (!c.original) return <Vacio titulo="Carga una fila" texto="Escribe su clave a la izquierda y presiona Cargar; aquí verás los cambios antes de guardarlos." />
    const o = c.original
    const filas = Object.entries(c.cambios).map(([col, v]) => [
      <span key="c" className="font-mono text-xs">{col}</span>, <Antes key="a">{String(o[col as keyof Fila])}</Antes>, <b key="d" className="font-medium">{v}</b>,
    ])
    const despues: Fila = { ...o, ...Object.fromEntries(Object.entries(c.cambios).map(([col, v]) => [col, col === "tipo_editor" ? v : Number(v) || 0])) }
    return (
      <div className="flex flex-col gap-4">
        <Panel titulo="Cambios a guardar" derecha={filas.length ? `${filas.length} ${filas.length === 1 ? "columna" : "columnas"}` : "ninguno todavía"}>
          {filas.length ? <Tabla columnas={["Columna", "Antes", "Después"]} anchos="190px minmax(0,1fr) minmax(0,1fr)" filas={filas} alto={220} />
            : <p className="px-4 py-5 text-[13px] text-muted-foreground">Edita una métrica a la izquierda: aquí aparecerá su valor anterior y el nuevo.</p>}
        </Panel>
        <Panel titulo="Fila después de guardar">
          <Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(despues, new Set(Object.keys(c.cambios)))} />
        </Panel>
      </div>
    )
  }

  // Eliminar
  if (c.borrado) {
    return (
      <div role="status" className="flex flex-col gap-0.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
        <span className="text-sm font-semibold">Eliminado</span>
        <span className="text-[12.5px] text-muted-foreground">{c.borrado}</span>
      </div>
    )
  }
  const hay = c.modo === "fila" ? c.original : c.particion?.length ? c.particion : null
  if (!hay) return <Vacio titulo="Carga lo que quieres eliminar" texto={c.modo === "fila" ? "Escribe la clave de la fila y presiona Cargar." : "Escribe el editor y presiona Cargar para ver su partición."} />
  return (
    <div className="flex flex-col gap-4">
      <QuePasa filas={[
        ["Cassandra", c.modo === "fila" ? "DELETE de la fila con la clave completa. No se puede deshacer." : `DELETE solo por partición: se ${c.particion?.length === 1 ? "borra la única fila" : `borran las ${c.particion?.length} filas`} de ${c.clave.editor} de una vez. No se puede deshacer.`],
        ["MongoDB y Neo4j", "No cambian: esta tabla es un resumen; los eventos siguen en MongoDB."],
      ]} />
      {c.modo === "fila" && c.original ? (
        <Panel titulo="Fila que se eliminará"><Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(c.original)} /></Panel>
      ) : (
        <Panel titulo="Filas que se eliminarán" derecha={`${c.particion?.length}`}>
          <Tabla columnas={["Fecha y hora", "Wiki", "Eventos", "Ediciones"]} anchos="minmax(0,1.4fr) repeat(3,minmax(0,1fr))" alto={360}
            filas={(c.particion ?? []).map((f) => [`${f.fecha} · ${String(f.hora).padStart(2, "0")}:00`, f.wiki, entero(f.eventos), entero(f.ediciones)])} />
        </Panel>
      )}
    </div>
  )
}
