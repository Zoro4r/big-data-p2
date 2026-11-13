import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Segmentado } from "@/components/crear-evento"
import {
  Antes, BotonesGuardar, BotonPrueba, ModalElegir, Campo, Clave, Coincidencias, ConfirmarEscribiendo, DialogoBorrar, Ficha, InputEditable,
  Nota, Operaciones, Panel, Punto, QuePasa, Tabla, type Operacion,
} from "@/components/crud-comun"
import { Vacio } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { KPIS } from "@/lib/kpis"

/** CRUD de la tabla kpis de Cassandra (clave ((kpi), ventana)): cada fila es el valor ya calculado de un KPI en una hora.
 *  Consultar sirve para cualquier KPI; crear, actualizar y eliminar, solo para KPIs de demostración («demo_…»),
 *  que el dashboard no muestra porque no tienen tarjeta. */

export interface Fila { kpi: string; ventana: string; valor: number | null; detalle: string | null }

const PREFIJO = "demo_"
const esKpiDemo = (k: string) => k.startsWith(PREFIJO)
const hoy = () => new Date().toISOString().slice(0, 10)
const horaUtc = () => String(new Date().getUTCHours())
const HORAS: [string, string][] = Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, "0")}:00`])
/** Inicio de la hora en UTC, como lo guarda la columna ventana. */
const ventanaDe = (fecha: string, hora: string) => `${fecha}T${hora.padStart(2, "0")}:00:00Z`
const etiquetaVentana = (v: string) => `${v.slice(0, 10)} · ${v.slice(11, 16)} UTC`
const nombreKpi = (k: string) => (KPIS as Record<string, { nombre: string }>)[k]?.nombre ?? k
const numero = (v: number | null) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString("es-PE") : v.toLocaleString("es-PE", { maximumFractionDigits: 2 }))

/** Filas de la tabla «columna · valor», con la partición y la columna de agrupación marcadas. */
function columnas(f: Fila, marcar: Set<string> = new Set()): ReactNode[][] {
  const v = (c: string, x: ReactNode) => (marcar.has(c) ? <b className="font-medium">{x}</b> : x)
  return [
    [<span key="k" className="font-mono text-xs">kpi<Clave>partición</Clave></span>, f.kpi],
    [<span key="v" className="font-mono text-xs">ventana<Clave>agrupación</Clave></span>, etiquetaVentana(f.ventana)],
    [<span key="val" className="font-mono text-xs">valor</span>, v("valor", numero(f.valor))],
    [<span key="d" className="font-mono text-xs">detalle</span>, v("detalle", f.detalle ?? "—")],
  ]
}

const Selector = ({ id, valor, opciones, onChange }: { id: string; valor: string; opciones: [string, string][]; onChange: (v: string) => void }) => (
  <Select value={valor} onValueChange={onChange}>
    <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Elige un KPI" /></SelectTrigger>
    <SelectContent>{opciones.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
  </Select>
)

/** Aviso bajo el nombre: solo se escribe sobre KPIs «demo_…». */
function AvisoKpi({ kpi }: { kpi: string }) {
  if (!kpi) return <>Debe empezar con «{PREFIJO}».</>
  return esKpiDemo(kpi)
    ? <>KPI de demostración: no tiene tarjeta, así que no aparece en el dashboard.</>
    : <span className="text-red-700 dark:text-red-400">Solo se escribe sobre KPIs que empiezan con «{PREFIJO}».</span>
}

export function useCassandraCrud() {
  const [op, setOp] = useState<Operacion>("Crear")
  const [ocupado, setOcupado] = useState(false)

  /** Corre una llamada con toast; devuelve el resultado o null si falló. */
  async function correr<T>(llamada: () => Promise<T>, exito?: (r: T) => string): Promise<T | null> {
    setOcupado(true)
    try {
      const r = await llamada()
      if (exito) toast.success(exito(r))
      return r
    } catch (e) {
      const msg = (e as Error).message
      toast.error(msg)
      return null
    } finally {
      setOcupado(false)
    }
  }

  // Los KPIs que se pueden consultar: los 12 reales y los de demostración que existan.
  const [nombres, setNombres] = useState<{ reales: string[]; demo: string[] }>({ reales: [], demo: [] })
  const recargarNombres = () => api<{ reales: string[]; demo: string[] }>("/api/crud/cassandra/kpis").then(setNombres).catch(() => {})
  useEffect(() => { recargarNombres() }, [])

  // ---------------------------------------------------------------- Crear
  const [nueva, setNueva] = useState({ kpi: "", fecha: hoy(), hora: horaUtc(), valor: "", detalle: "" })
  const filaNueva: Fila = {
    kpi: nueva.kpi, ventana: ventanaDe(nueva.fecha, nueva.hora),
    valor: nueva.valor === "" ? null : Number(nueva.valor), detalle: nueva.detalle || null,
  }
  // Si ya hay una fila con esa clave, el INSERT la reemplazaría: se avisa antes.
  const [existente, setExistente] = useState<Fila | null>(null)
  useEffect(() => {
    if (op !== "Crear" || !nueva.kpi || !nueva.fecha) { setExistente(null); return }
    const t = setTimeout(() => {
      api<Fila>(`/api/crud/cassandra/fila?${new URLSearchParams({ kpi: nueva.kpi, ventana: ventanaDe(nueva.fecha, nueva.hora) })}`)
        .then(setExistente).catch(() => setExistente(null))
    }, 300)
    return () => clearTimeout(t)
  }, [op, nueva.kpi, nueva.fecha, nueva.hora])
  const [insertada, setInsertada] = useState<{ fila: Fila; reemplazo: boolean } | null>(null)
  async function insertar() {
    const r = await correr(() => api<{ reemplazo: boolean; fila: Fila }>("/api/crud/cassandra", { method: "POST", body: JSON.stringify(filaNueva) }),
      (x) => (x.reemplazo ? "Fila reemplazada (la clave ya existía)" : "Fila insertada"))
    if (r) { setInsertada(r); setExistente(r.fila); recargarNombres() }
  }

  // ---------------------------------------------------------------- Consultar
  const [consulta, setConsulta] = useState({ kpi: "", fecha: "", hora: "todas" })
  const [resultados, setResultados] = useState<Fila[] | null>(null)
  const [elegido, setElegido] = useState(0)
  async function buscar(q = consulta, ventana?: string) {
    if (!q.kpi) { toast.error("Elige el KPI: Cassandra siempre consulta por partición"); return }
    const params = new URLSearchParams({ kpi: q.kpi, ...(q.fecha ? { fecha: q.fecha } : {}), ...(q.hora !== "todas" ? { hora: q.hora } : {}) })
    const r = await correr(() => api<Fila[]>(`/api/crud/cassandra?${params}`))
    if (r) { setResultados(r); setElegido(Math.max(0, r.findIndex((f) => f.ventana === ventana))) }
  }

  // ---------------------------------------------------------------- Actualizar y eliminar: una fila por su clave
  const [clave, setClave] = useState({ kpi: "", fecha: hoy(), hora: horaUtc() })
  const [original, setOriginal] = useState<Fila | null>(null)
  const [cambios, setCambios] = useState<Record<string, string>>({})
  async function cargar(k = clave) {
    setOcupado(true)
    try {
      setOriginal(await api<Fila>(`/api/crud/cassandra/fila?${new URLSearchParams({ kpi: k.kpi, ventana: ventanaDe(k.fecha, k.hora) })}`))
      setCambios({})
      setBorrado(null)
    } catch (e) {
      setOriginal(null)
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  const textoOriginal = (c: "valor" | "detalle") => (original?.[c] == null ? "" : String(original[c]))
  const valor = (c: "valor" | "detalle") => (c in cambios ? cambios[c] : textoOriginal(c))
  const poner = (c: "valor" | "detalle", v: string) => setCambios((x) => {
    const sig = { ...x, [c]: v }
    if (v === textoOriginal(c)) delete sig[c]
    return sig
  })
  const deshacer = (c: string) => setCambios((x) => { const sig = { ...x }; delete sig[c]; return sig })
  const descartar = () => setCambios({})
  const convertir = (c: string, v: string) => (v === "" ? null : c === "valor" ? Number(v) : v)
  async function guardar() {
    if (!original) return
    const body = { kpi: original.kpi, ventana: original.ventana, cambios: Object.fromEntries(Object.entries(cambios).map(([c, v]) => [c, convertir(c, v)])) }
    const r = await correr(() => api<Fila>("/api/crud/cassandra", { method: "PATCH", body: JSON.stringify(body) }), () => "Fila actualizada")
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
      setParticion(await api<Fila[]>(`/api/crud/cassandra?${new URLSearchParams({ kpi: clave.kpi, limite: "500" })}`))
      setBorrado(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  const listoParaBorrar = confirmacion.trim() === clave.kpi && (modo === "fila" ? Boolean(original) : Boolean(particion?.length))
  async function eliminar() {
    const params = modo === "fila" && original
      ? new URLSearchParams({ kpi: original.kpi, ventana: original.ventana })
      : new URLSearchParams({ kpi: clave.kpi })
    const detalle = modo === "fila" && original ? `${original.kpi} · ${etiquetaVentana(original.ventana)}` : `partición ${clave.kpi}`
    const r = await correr(() => api<{ filas_eliminadas: number }>(`/api/crud/cassandra?${params}`, { method: "DELETE" }),
      (x) => `${x.filas_eliminadas} ${x.filas_eliminadas === 1 ? "fila eliminada" : "filas eliminadas"}`)
    setDialogo(false)
    if (r) {
      setBorrado(`DELETE · ${r.filas_eliminadas} ${r.filas_eliminadas === 1 ? "fila" : "filas"} · ${detalle}`)
      setOriginal(null); setParticion(null); setConfirmacion(""); recargarNombres()
    }
  }

  /** «Completar con datos de prueba»: los formularios empiezan vacíos y esto los llena con el KPI «demo_kpi». */
  async function completarPrueba() {
    if (op === "Crear") { setNueva({ kpi: "demo_kpi", fecha: hoy(), hora: horaUtc(), valor: "42", detalle: "valor de demostración" }); return }
    // Consultar, Actualizar y Eliminar: se elige entre las 5 filas más recientes. Consultar usa los KPIs reales;
    // Actualizar y Eliminar, los de demostración (son los únicos que se pueden escribir).
    setUltimos({ abierto: true, filas: null })
    const filas = await api<Fila[]>(`/api/crud/cassandra/ultimas?demo=${op !== "Consultar"}`).catch((e) => { toast.error((e as Error).message); return [] })
    setUltimos({ abierto: true, filas })
  }
  const [ultimos, setUltimos] = useState<{ abierto: boolean; filas: Fila[] | null }>({ abierto: false, filas: null })
  function elegirUltimo(id: string) {
    const f = ultimos.filas?.find((x) => `${x.kpi}|${x.ventana}` === id)
    setUltimos({ abierto: false, filas: null })
    if (!f) return
    if (op === "Consultar") {
      const q = { kpi: f.kpi, fecha: f.ventana.slice(0, 10), hora: String(Number(f.ventana.slice(11, 13))) }
      setConsulta(q); buscar(q, f.ventana); return
    }
    const k = { kpi: f.kpi, fecha: f.ventana.slice(0, 10), hora: String(Number(f.ventana.slice(11, 13))) }
    setClave(k); setModo("fila"); setConfirmacion("")
    cargar(k)
  }

  /** Desde la ficha de Consultar: lleva la fila a Actualizar o Eliminar. */
  function irA(destino: Operacion, f: Fila) {
    const k = { kpi: f.kpi, fecha: f.ventana.slice(0, 10), hora: String(Number(f.ventana.slice(11, 13))) }
    setClave(k); setModo("fila"); setConfirmacion(""); setOp(destino)
    cargar(k)
  }

  return {
    op, setOp, ocupado, nombres,
    nueva, setNueva, filaNueva, existente, insertada, insertar,
    consulta, setConsulta, resultados, elegido, setElegido, buscar,
    clave, setClave, original, cambios, valor, poner, deshacer, descartar, cargar, guardar,
    modo, setModo, particion, cargarParticion, confirmacion, setConfirmacion, dialogo, setDialogo, borrado, listoParaBorrar, eliminar, irA,
    completarPrueba, ultimos, setUltimos, elegirUltimo,
  }
}
export type CassandraCrud = ReturnType<typeof useCassandraCrud>

// ---------------------------------------------------------------- columna izquierda

function ClaveFila({ c }: { c: CassandraCrud }) {
  const k = c.clave
  return (
    <div className="flex flex-col gap-3">
      <Campo id="ck-kpi" label="KPI" clave="partición"><Input id="ck-kpi" placeholder="Ej. tasa_reversion_pct" className="font-mono" value={k.kpi} onChange={(e) => c.setClave({ ...k, kpi: e.target.value })} /></Campo>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
        <Campo id="ck-fecha" label="Fecha" clave="agrupación"><Input id="ck-fecha" type="date" value={k.fecha} onChange={(e) => c.setClave({ ...k, fecha: e.target.value })} /></Campo>
        <Campo id="ck-hora" label="Hora" clave="agrupación"><Selector id="ck-hora" valor={k.hora} opciones={HORAS} onChange={(v) => c.setClave({ ...k, hora: v })} /></Campo>
        <Button type="button" variant="outline" disabled={c.ocupado || !k.kpi} onClick={() => c.cargar()}>Cargar</Button>
      </div>
      <span className="text-xs text-muted-foreground">El KPI, la fecha y la hora (en UTC) identifican la fila. Llega sola desde Consultar.</span>
    </div>
  )
}

function FichaFila({ f }: { f: Fila }) {
  return <Ficha titulo={f.kpi}>{etiquetaVentana(f.ventana)}<Punto />valor {numero(f.valor)}</Ficha>
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
  const opcionesKpi: [string, string][] = [...c.nombres.reales.map((k): [string, string] => [k, nombreKpi(k)]), ...c.nombres.demo.map((k): [string, string] => [k, `${k} (demostración)`])]
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Operaciones valor={c.op} onChange={c.setOp} />
      <BotonPrueba onClick={c.completarPrueba} ultimos={c.op !== "Crear" && "las últimas filas"} />
      <ModalElegir abierto={c.ultimos.abierto} onCerrar={() => c.setUltimos({ abierto: false, filas: null })} onElegir={c.elegirUltimo}
        titulo="Últimas 5 filas" descripcion={`Elige una y confírmala para usarla en ${c.op}.`} columnas={["KPI", "Valor", "Hora"]}
        filas={c.ultimos.filas && c.ultimos.filas.map((f) => ({ id: `${f.kpi}|${f.ventana}`, titulo: nombreKpi(f.kpi), subtitulo: f.detalle ?? undefined,
          medio: f.valor == null ? "—" : String(f.valor), derecha: etiquetaVentana(f.ventana).slice(13) }))}
        vacio={c.op === "Consultar" ? "No hay filas en la tabla kpis." : "No hay KPIs de demostración: crea uno en «Crear» y vuelve aquí."}
        pie={(id) => id.replace("|", " · ")} accion="Usar esta fila" />

      {c.op === "Crear" && (
        <>
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Clave de la fila</span>
          <Campo id="cn-kpi" label="KPI" clave="partición" ayuda={<AvisoKpi kpi={n.kpi} />}>
            <Input id="cn-kpi" className="font-mono" placeholder="Ej. tasa_reversion_pct" value={n.kpi} onChange={(e) => c.setNueva({ ...n, kpi: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="cn-fecha" label="Fecha (UTC)" clave="agrupación"><Input id="cn-fecha" type="date" value={n.fecha} onChange={(e) => c.setNueva({ ...n, fecha: e.target.value })} /></Campo>
            <Campo id="cn-hora" label="Hora (UTC)" clave="agrupación"><Selector id="cn-hora" valor={n.hora} opciones={HORAS} onChange={(v) => c.setNueva({ ...n, hora: v })} /></Campo>
          </div>
          <span className="border-t pt-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Resultado de esa hora</span>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <Campo id="cn-valor" label="Valor"><Input id="cn-valor" placeholder="Ej. 4.2" type="number" step="any" className="font-mono" value={n.valor} onChange={(e) => c.setNueva({ ...n, valor: e.target.value })} /></Campo>
            <Campo id="cn-detalle" label="Detalle"><Input id="cn-detalle" placeholder="Ej. 38 reversiones" value={n.detalle} onChange={(e) => c.setNueva({ ...n, detalle: e.target.value })} /></Campo>
          </div>
          <Button type="submit" disabled={c.ocupado || !esKpiDemo(n.kpi)} className="h-10 w-full text-sm">Insertar fila</Button>
        </>
      )}

      {c.op === "Consultar" && (
        <>
          <Campo id="cq-kpi" label="KPI" clave="partición" ayuda="Cassandra necesita la partición: siempre se consulta un KPI. Funciona con cualquier KPI real.">
            <Selector id="cq-kpi" valor={c.consulta.kpi} opciones={opcionesKpi} onChange={(v) => c.setConsulta({ ...c.consulta, kpi: v })} />
          </Campo>
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3">
              <Campo id="cq-fecha" label="Fecha (UTC)"><Input id="cq-fecha" type="date" value={c.consulta.fecha} onChange={(e) => c.setConsulta({ ...c.consulta, fecha: e.target.value })} /></Campo>
              <Campo id="cq-hora" label="Hora (UTC)"><Selector id="cq-hora" valor={c.consulta.hora} opciones={[["todas", "Todas"], ...HORAS]} onChange={(v) => c.setConsulta({ ...c.consulta, hora: v })} /></Campo>
            </div>
            <span className="text-xs text-muted-foreground">Opcionales: sin fecha, se buscan las últimas 48 horas; con hora, solo las filas de esa hora.</span>
          </div>
          <Button type="submit" disabled={c.ocupado} className="h-10 w-full text-sm"><Search aria-hidden />Buscar</Button>
          {c.resultados && (
            <Coincidencias items={c.resultados} elegido={c.elegido} onElegir={c.setElegido}
              clave={(f) => f.ventana} titulo={(f) => etiquetaVentana(f.ventana)}
              sub={(f) => (f.detalle ? `${numero(f.valor)} · ${f.detalle}` : numero(f.valor))} derecha={() => ""} />
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
                <span className="text-xs text-muted-foreground">La clave no se puede cambiar (en Cassandra sería otra fila). Cambia el valor o el detalle.</span>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <Campo id="cu-valor" label="Valor" editado={"valor" in c.cambios}>
                    <InputEditable id="cu-valor" tipo="number" mono valor={c.valor("valor")} original={c.original.valor == null ? "" : String(c.original.valor)} onChange={(v) => c.poner("valor", v)} onDeshacer={() => c.deshacer("valor")} />
                  </Campo>
                  <Campo id="cu-detalle" label="Detalle" editado={"detalle" in c.cambios}>
                    <InputEditable id="cu-detalle" valor={c.valor("detalle")} original={c.original.detalle ?? ""} onChange={(v) => c.poner("detalle", v)} onDeshacer={() => c.deshacer("detalle")} />
                  </Campo>
                </div>
                <span className="text-xs text-muted-foreground"><AvisoKpi kpi={c.original.kpi} /></span>
              </div>
            </>
          )}
          <BotonesGuardar n={nCambios} deshabilitado={c.ocupado || !c.original || !esKpiDemo(c.original.kpi)} onCancelar={c.descartar} />
        </>
      )}

      {c.op === "Eliminar" && (
        <>
          <Segmentado etiqueta="Qué eliminar" valor={c.modo} onChange={(m) => { c.setModo(m); c.setConfirmacion("") }}
            opciones={[["fila", "Una fila"], ["particion", "Toda la partición del KPI"]]} />
          {c.modo === "fila" ? <ClaveFila c={c} /> : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <Campo id="cd-kpi" label="KPI" clave="partición"><Input id="cd-kpi" placeholder="Ej. tasa_reversion_pct" className="font-mono" value={c.clave.kpi} onChange={(e) => c.setClave({ ...c.clave, kpi: e.target.value })} /></Campo>
              <Button type="button" variant="outline" disabled={c.ocupado || !c.clave.kpi} onClick={c.cargarParticion}>Cargar</Button>
            </div>
          )}
          {c.modo === "fila" && c.original && <FichaFila f={c.original} />}
          {c.modo === "particion" && c.particion && <Ficha titulo={c.clave.kpi}>{c.particion.length} {c.particion.length === 1 ? "fila" : "filas"} en la partición</Ficha>}
          {((c.modo === "fila" && c.original) || (c.modo === "particion" && c.particion?.length)) && (
            <>
              <ConfirmarEscribiendo id="cd-confirmar" etiqueta="Para confirmar, escribe el KPI" valor={c.clave.kpi} texto={c.confirmacion} onChange={c.setConfirmacion} />
              <span className="text-xs text-muted-foreground"><AvisoKpi kpi={c.clave.kpi} /></span>
            </>
          )}
          <Button type="submit" variant="destructive" disabled={c.ocupado || !c.listoParaBorrar || !esKpiDemo(c.clave.kpi)} className="h-10 w-full text-sm">
            <Trash2 aria-hidden />{c.modo === "fila" ? "Eliminar fila" : "Eliminar partición"}
          </Button>
          <DialogoBorrar abierto={c.dialogo} onCerrar={() => c.setDialogo(false)} onConfirmar={c.eliminar} ocupado={c.ocupado}
            titulo={c.modo === "fila" ? `¿Eliminar la fila de ${c.clave.kpi}?` : `¿Eliminar toda la partición de ${c.clave.kpi}?`}
            descripcion={c.modo === "fila" && c.original
              ? <>Se borrará la fila {etiquetaVentana(c.original.ventana)} de la tabla kpis. No se puede deshacer. MongoDB y Neo4j no cambian.</>
              : <>Se {c.particion?.length === 1 ? "borrará la única fila" : `borrarán las ${c.particion?.length ?? 0} filas`} de este KPI (DELETE solo por partición). No se puede deshacer.</>}>
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
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2.5 p-4">
      <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
        <span className="text-xs text-muted-foreground">Valor</span>
        <span className="text-lg font-semibold tabular-nums">{numero(f.valor)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2">
        <span className="text-xs text-muted-foreground">Detalle</span>
        <span className="truncate text-lg font-semibold" title={f.detalle ?? ""}>{f.detalle ?? "—"}</span>
      </div>
    </div>
  )
}

export function CassandraDerecha({ c }: { c: CassandraCrud }) {
  if (c.op === "Crear") {
    return (
      <div className="flex flex-col gap-4 lg:[&>*:last-child]:grow">
        {c.insertada && (
          <div role="status" className="rounded-xl border bg-card px-4 py-3 text-[13px] shadow-xs">
            <b className="font-medium">{c.insertada.reemplazo ? "Fila reemplazada" : "Fila insertada"}</b>
            <span className="text-muted-foreground"> · {c.insertada.fila.kpi} · {etiquetaVentana(c.insertada.fila.ventana)}</span>
          </div>
        )}
        <Panel titulo="Fila a insertar" derecha="kpis">
          <Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(c.filaNueva)} />
        </Panel>
        {c.existente && !c.insertada ? (
          <Nota>
            <b className="font-medium text-foreground">Ya hay una fila con esta clave.</b> Si insertas, se reemplaza: hoy vale {numero(c.existente.valor)}.
            En Cassandra un INSERT con una clave existente no da error de duplicado: sobrescribe.
          </Nota>
        ) : (
          <Nota>Cada fila es el resultado de un KPI en una hora, ya calculado. En Cassandra un INSERT con una clave que ya existe <b className="font-medium text-foreground">reemplaza</b> la fila (no hay error de duplicado); si esa clave ya tiene datos, aquí aparece un aviso.</Nota>
        )}
      </div>
    )
  }

  if (c.op === "Consultar") {
    if (!c.resultados) return <Vacio titulo="Realiza una consulta" texto="Elige el KPI y presiona Buscar; las filas de su partición aparecerán aquí." />
    if (!c.resultados.length) return <Vacio titulo="Sin filas" texto="Ese KPI no tiene filas con estos filtros. Prueba otra fecha." />
    const f = c.resultados[c.elegido]
    return (
      <div className="flex flex-col gap-4 lg:[&>*:last-child]:grow">
        <Panel titulo={`${nombreKpi(f.kpi)} · ${etiquetaVentana(f.ventana)}`} derecha={c.resultados.length > 1 ? `Fila ${c.elegido + 1} de ${c.resultados.length}` : "Encontrada"}>
          <Cifras f={f} />
        </Panel>
        <Panel titulo="Fila completa" derecha={esKpiDemo(f.kpi) ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => c.irA("Actualizar", f)}>Actualizar esta</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-red-200 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400" onClick={() => c.irA("Eliminar", f)}>Eliminar</Button>
          </>
        ) : "KPI real: solo lectura"}>
          <Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(f)} />
        </Panel>
      </div>
    )
  }

  if (c.op === "Actualizar") {
    if (!c.original) return <Vacio titulo="Carga una fila" texto="Escribe su clave a la izquierda y presiona Cargar; aquí verás los cambios antes de guardarlos." />
    const o = c.original
    const filas = Object.entries(c.cambios).map(([col, v]) => [
      <span key="c" className="font-mono text-xs">{col}</span>, <Antes key="a">{String(o[col as "valor" | "detalle"] ?? "—")}</Antes>, <b key="d" className="font-medium">{v || "—"}</b>,
    ])
    const despues: Fila = {
      ...o,
      ...("valor" in c.cambios ? { valor: c.cambios.valor === "" ? null : Number(c.cambios.valor) } : {}),
      ...("detalle" in c.cambios ? { detalle: c.cambios.detalle || null } : {}),
    }
    return (
      <div className="flex flex-col gap-4 lg:[&>*:last-child]:grow">
        <Panel titulo="Cambios a guardar" derecha={filas.length ? `${filas.length} ${filas.length === 1 ? "columna" : "columnas"}` : "ninguno todavía"}>
          {filas.length ? <Tabla columnas={["Columna", "Antes", "Después"]} anchos="190px minmax(0,1fr) minmax(0,1fr)" filas={filas} alto={220} />
            : <p className="px-4 py-5 text-[13px] text-muted-foreground">Edita el valor o el detalle a la izquierda: aquí aparecerá el dato anterior y el nuevo.</p>}
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
  if (!hay) return <Vacio titulo="Carga lo que quieres eliminar" texto={c.modo === "fila" ? "Escribe la clave de la fila y presiona Cargar." : "Escribe el KPI y presiona Cargar para ver su partición."} />
  return (
    <div className="flex flex-col gap-4 lg:[&>*:last-child]:grow">
      <QuePasa filas={[
        ["Cassandra", c.modo === "fila" ? "DELETE de la fila con la clave completa. No se puede deshacer." : `DELETE solo por partición: se ${c.particion?.length === 1 ? "borra la única fila" : `borran las ${c.particion?.length} filas`} de ${c.clave.kpi} de una vez. No se puede deshacer.`],
        ["MongoDB y Neo4j", "No cambian: esta tabla guarda resultados ya calculados; los eventos siguen en MongoDB."],
      ]} />
      {c.modo === "fila" && c.original ? (
        <Panel titulo="Fila que se eliminará"><Tabla columnas={["Columna", "Valor"]} anchos="230px minmax(0,1fr)" filas={columnas(c.original)} /></Panel>
      ) : (
        <Panel titulo="Filas que se eliminarán" derecha={`${c.particion?.length}`}>
          <Tabla columnas={["Hora (UTC)", "Valor", "Detalle"]} anchos="minmax(0,1.2fr) minmax(0,1fr) minmax(0,1.4fr)" alto={360}
            filas={(c.particion ?? []).map((f) => [etiquetaVentana(f.ventana), numero(f.valor), f.detalle ?? "—"])} />
        </Panel>
      )}
    </div>
  )
}
