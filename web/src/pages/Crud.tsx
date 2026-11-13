import { useEffect, useState, type FormEvent } from "react"
import { Check, CheckCircle2, Copy, Search, Trash2, XCircle, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Seccion, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EditorEvento, FormularioEvento, useEventoNuevo, type WikiCrud } from "@/components/crear-evento"
import { Coincidencias, FichaDocumento, FiltrosConsulta, useConsultaEventos } from "@/components/consultar-evento"
import { CambiosActualizacion, FormularioActualizacion, useActualizacion } from "@/components/actualizar-evento"
import { ConfirmarEliminacion, FormularioEliminacion, PanelEliminacion, useEliminacion } from "@/components/eliminar-evento"
import { CassandraDerecha, CassandraIzquierda, useCassandraCrud } from "@/components/cassandra-crud"
import { Neo4jDerecha, Neo4jIzquierda, useNeo4jCrud } from "@/components/neo4j-crud"
import { BotonPrueba, type Registrar } from "@/components/crud-comun"
import { api } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { horaLocal } from "@/lib/format"
import { cn } from "@/lib/utils"

type Op = "CREATE" | "READ" | "UPDATE" | "DELETE" | "RECHAZADO" | "VALIDADOR"
interface Registro { op: Op; base: string; detalle: string; hora: string; ok: boolean }
/** validacion: el validador $jsonSchema de MongoDB rechazó el documento (no es un fallo de la API) */
interface Resultado { titulo: string; ok: boolean; validacion?: boolean; faltan?: string[]; json: unknown }

const horaActual = () => horaLocal(Date.now(), false, true)

function Operaciones({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: string[] }) {
  return (
    <ToggleGroup type="single" value={valor} onValueChange={(v) => v && onChange(v)} variant="outline" className="w-full" aria-label="Operación">
      {opciones.map((o) => <ToggleGroupItem key={o} value={o} className="flex-1">{o}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}

export default function CrudPage() {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [log, setLog] = useState<Registro[]>([])
  const [ocupado, setOcupado] = useState(false)

  const { wiki } = useWiki()
  const wikiForm: WikiCrud = wiki === "ambas" ? "enwiki" : wiki  // con "Ambas" en la cabecera, los formularios usan enwiki

  // ---------------------------------------------------------------- MongoDB
  const [base, setBase] = useState("mongo")
  const [mOp, setMOp] = useState("Crear")
  const [m, setM] = useState({ id: "" })
  const evento = useEventoNuevo(wikiForm)

  /** Busca el documento de demostración más reciente («demo-…»), primero en la wiki del formulario. */
  async function documentoDemo(): Promise<string | null> {
    for (const w of [wikiForm, wikiForm === "enwiki" ? "eswiki" : "enwiki"]) {
      const r = await api<{ documentos: { _id: string }[] }>(`/api/crud/mongo/buscar?${new URLSearchParams({ wiki: w, periodo: "todo", demo: "true", limite: "1" })}`)
      if (r.documentos[0]) return r.documentos[0]._id
    }
    return null
  }

  /** «Completar con datos de prueba» en la operación elegida de MongoDB. */
  async function pruebaMongo() {
    if (mOp === "Crear") { evento.completar(); return }
    if (mOp === "Consultar") { consulta.setF({ ...consulta.f, demo: true, periodo: "todo", editor: "Demo_Editor", titulo: "", id: "" }); return }
    const id = await documentoDemo().catch(() => null)
    if (!id) { toast.info("No hay documentos de demostración: crea uno en «Crear» y vuelve aquí"); return }
    setM((x) => ({ ...x, id }))
    if (mOp === "Actualizar") actualizacion.cargar(id)
    else eliminacion.cargar(id)
  }

  /** Inserta el documento del editor. Si el validador lo rechaza, se muestra como resultado de la validación. */
  async function insertarEvento() {
    if (!evento.doc) { toast.error("Corrige el JSON antes de insertar"); return }
    const doc = evento.doc
    const destino = "MongoDB · events"
    const id = String(doc._id ?? "")
    setOcupado(true)
    try {
      const r = await api<{ rechazado: boolean; faltan?: string[]; motivo?: string; documento?: unknown }>("/api/crud/mongo", { method: "POST", body: JSON.stringify(doc) })
      if (r.rechazado) {
        setResultado({ titulo: destino, ok: true, validacion: true, faltan: r.faltan, json: r })
        setLog((l) => [{ op: "VALIDADOR" as Op, base: destino, detalle: `rechazado: falta ${r.faltan?.join(", ") || "un campo"}`, hora: horaActual(), ok: true }, ...l].slice(0, 8))
        toast.info("El validador de MongoDB rechazó el documento")
      } else {
        setResultado({ titulo: `CREATE · ${destino}`, ok: true, json: r.documento })
        setLog((l) => [{ op: "CREATE" as Op, base: destino, detalle: id, hora: horaActual(), ok: true }, ...l].slice(0, 8))
        setM((x) => ({ ...x, id }))  // así Consultar, Actualizar y Eliminar apuntan al documento recién creado
        evento.renovarId()
        toast.success(`Documento ${id} insertado`)
      }
    } catch (e) {
      const msg = (e as Error).message
      setResultado({ titulo: `CREATE · ${destino}`, ok: false, json: { error: msg } })
      setLog((l) => [{ op: "RECHAZADO" as Op, base: destino, detalle: msg, hora: horaActual(), ok: false }, ...l].slice(0, 8))
      toast.error(msg)
    } finally {
      setOcupado(false)
    }
  }

  const consulta = useConsultaEventos(wikiForm)
  async function buscarEventos() {
    setOcupado(true)
    const r = await consulta.buscar()
    setOcupado(false)
    if (r) setLog((l) => [{ op: "READ" as Op, base: "MongoDB · events", detalle: `find · ${r.documentos.length}${r.hay_mas ? "+" : ""} ${r.documentos.length === 1 && !r.hay_mas ? "documento" : "documentos"}`, hora: horaActual(), ok: true }, ...l].slice(0, 8))
  }
  // Al entrar a Consultar se parte de cero: no se busca hasta que la persona presiona Buscar.
  useEffect(() => {
    if (base === "mongo" && mOp === "Consultar") consulta.limpiar()
  }, [base, mOp]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Desde la ficha: lleva el documento a Actualizar o Eliminar. */
  const irA = (op: string) => (id: string) => {
    setM((x) => ({ ...x, id })); setResultado(null); setMOp(op)
    if (op === "Actualizar") actualizacion.cargar(id)
    if (op === "Eliminar") eliminacion.cargar(id)
  }

  const eliminacion = useEliminacion()
  const [confirmar, setConfirmar] = useState(false)
  async function correr(op: Op, accion: () => Promise<Record<string, unknown>>, texto: (d: Record<string, unknown>) => string) {
    setOcupado(true)
    try {
      const d = await accion()
      setLog((l) => [{ op, base: "MongoDB · events", detalle: String(d._id), hora: horaActual(), ok: true }, ...l].slice(0, 8))
      toast.success(texto(d))
    } catch (e) {
      const msg = (e as Error).message
      setLog((l) => [{ op: "RECHAZADO" as Op, base: "MongoDB · events", detalle: msg, hora: horaActual(), ok: false }, ...l].slice(0, 8))
      toast.error(msg)
    } finally {
      setOcupado(false)
      setConfirmar(false)
    }
  }
  const confirmarEliminacion = () => correr("DELETE", eliminacion.eliminar, (d) => `«${String(d.title ?? d._id)}» eliminado`)

  const actualizacion = useActualizacion()
  async function guardarActualizacion() {
    if (!actualizacion.nCambios) return
    setOcupado(true)
    try {
      const r = await actualizacion.guardar()
      const detalle = `${r.id} · ${r.campos.join(", ")}${r.recalculados.length ? ` (+${r.recalculados.length} recalculados)` : ""}`
      setLog((l) => [{ op: "UPDATE" as Op, base: "MongoDB · events", detalle, hora: horaActual(), ok: true }, ...l].slice(0, 8))
      toast.success(`Documento actualizado: ${r.campos.length} ${r.campos.length === 1 ? "campo" : "campos"}`)
    } catch (e) {
      const msg = (e as Error).message
      setLog((l) => [{ op: "RECHAZADO" as Op, base: "MongoDB · events", detalle: msg, hora: horaActual(), ok: false }, ...l].slice(0, 8))
      toast.error(msg)
    } finally {
      setOcupado(false)
    }
  }

  const enviarMongo = (e: FormEvent) => {
    e.preventDefault()
    if (mOp === "Crear") insertarEvento()
    if (mOp === "Consultar") buscarEventos()
    if (mOp === "Actualizar") guardarActualizacion()
    if (mOp === "Eliminar" && eliminacion.confirmado) setConfirmar(true)
  }
  const creando = base === "mongo" && mOp === "Crear"
  const consultando = base === "mongo" && mOp === "Consultar"
  const actualizando = base === "mongo" && mOp === "Actualizar"
  const eliminando = base === "mongo" && mOp === "Eliminar"

  // ---------------------------------------------------------------- Cassandra y Neo4j
  const registrar: Registrar = (op, base, detalle, ok) =>
    setLog((l) => [{ op, base, detalle, hora: horaActual(), ok }, ...l].slice(0, 8))
  const cassandra = useCassandraCrud(wikiForm, registrar)
  const neo = useNeo4jCrud(wikiForm, registrar)

  const boton = (texto: string, peligro = false) => (
    <Button type="submit" disabled={ocupado} variant={peligro ? "destructive" : "default"} className="h-10 w-full text-sm">{texto}</Button>
  )

  const historial = log.length > 0 && (
    <div className="flex flex-col gap-2.5 rounded-xl border px-5 py-4 shadow-xs">
      <span className="text-[13px] font-medium">Operaciones de esta sesión</span>
      {log.map((r, i) => (
        <div key={i} className="grid grid-cols-[96px_64px_minmax(0,1fr)] items-center gap-2 text-[13px]">
          <Badge variant="outline" className={cn("justify-center", r.op === "VALIDADOR" ? "border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400" : r.ok ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400")}>{r.op}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{r.hora}</span>
          <span className="truncate" title={`${r.base} · ${r.detalle}`}>{r.base} · {r.detalle}</span>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <Header ruta={["Administración", "Operaciones CRUD"]} />
      <Pagina titulo="Operaciones CRUD" descripcion="Crear, consultar, actualizar y eliminar en las tres bases. Para la demostración, usa nombres que empiecen con «Demo_» y bórralos al terminar.">
        <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-5", actualizando || creando ? "items-start lg:items-stretch" : "items-start")}>
          <Tabs value={base} onValueChange={setBase} className="gap-4 lg:col-span-2">
            <TabsList className="w-full">
              <TabsTrigger value="mongo">MongoDB</TabsTrigger>
              <TabsTrigger value="cassandra">Cassandra</TabsTrigger>
              <TabsTrigger value="neo4j">Neo4j</TabsTrigger>
            </TabsList>

            <TabsContent value="mongo">
              <Seccion titulo="Colección events" className="h-full" contenidoClassName="flex flex-1 flex-col">
                <form onSubmit={enviarMongo} className="flex flex-1 flex-col gap-4">
                  <Operaciones valor={mOp} onChange={setMOp} opciones={["Crear", "Consultar", "Actualizar", "Eliminar"]} />
                  <BotonPrueba onClick={pruebaMongo} />
                  {mOp === "Crear" ? <FormularioEvento ev={evento} />
                    : mOp === "Consultar" ? <FiltrosConsulta c={consulta} />
                    : mOp === "Actualizar" ? <FormularioActualizacion a={actualizacion} id={m.id} setId={(id) => setM({ ...m, id })} />
                    : <FormularioEliminacion e={eliminacion} id={m.id} setId={(id) => setM({ ...m, id })} />}
                  {mOp === "Consultar"
                    ? <Button type="submit" disabled={ocupado} className="h-10 w-full text-sm"><Search aria-hidden />Buscar</Button>
                    : mOp === "Actualizar"
                      ? <Button type="submit" disabled={ocupado || !actualizacion.nCambios} className="h-10 w-full text-sm"><Check aria-hidden />
                          {actualizacion.nCambios ? `Guardar ${actualizacion.nCambios} ${actualizacion.nCambios === 1 ? "cambio" : "cambios"}` : "Guardar cambios"}</Button>
                      : mOp === "Eliminar"
                        ? <Button type="submit" variant="destructive" disabled={ocupado || !eliminacion.confirmado} className="h-10 w-full text-sm"><Trash2 aria-hidden />Eliminar documento…</Button>
                        : boton("Insertar documento")}
                  <ConfirmarEliminacion e={eliminacion} abierto={confirmar} onCerrar={() => setConfirmar(false)} onConfirmar={confirmarEliminacion} ocupado={ocupado} />
                  {mOp === "Consultar" && <Coincidencias c={consulta} />}
                </form>
              </Seccion>
            </TabsContent>

            <TabsContent value="cassandra">
              <Seccion titulo="Tabla actividad_editor" descripcion={<>Clave primaria ((editor), fecha, hora, wiki) · la partición es el editor. Es un resumen que calcula el pipeline: se puede consultar cualquier editor, pero solo se escribe sobre «Demo_…».</>}>
                <CassandraIzquierda c={cassandra} />
              </Seccion>
            </TabsContent>

            <TabsContent value="neo4j">
              <Seccion titulo="Grafo de editores" descripcion="Se puede consultar cualquier editor, pero solo se escribe sobre «Demo_…».">
                <Neo4jIzquierda n={neo} />
              </Seccion>
            </TabsContent>
          </Tabs>

          <div className={cn("flex flex-col gap-4 lg:col-span-3 lg:pt-[52px]", actualizando || creando ? "self-stretch" : "self-start")}>
            {creando && <EditorEvento ev={evento} />}
            {actualizando && <CambiosActualizacion a={actualizacion} />}
            {eliminando && <PanelEliminacion e={eliminacion} />}
            {consultando && <FichaDocumento c={consulta} onActualizar={irA("Actualizar")} onEliminar={irA("Eliminar")} />}
            {base === "cassandra" && <CassandraDerecha c={cassandra} />}
            {base === "neo4j" && <Neo4jDerecha n={neo} />}
            {base !== "mongo" || consultando || actualizando || eliminando ? null : resultado ? (
              <>
                {resultado.validacion ? (
                  <div role="status" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-900 dark:bg-blue-950/40">
                    <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-blue-700 dark:text-blue-400" aria-hidden />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-200">El validador de MongoDB rechazó el documento</span>
                      <span className="text-[13px] text-blue-800 dark:text-blue-300">
                        {resultado.faltan?.length ? `Le falta ${resultado.faltan.map((f) => `«${f}»`).join(", ")}. ` : ""}
                        El $jsonSchema de la colección events no lo aceptó, así que MongoDB no guardó nada.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div role="status" className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5", resultado.ok ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40" : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40")}>
                    {resultado.ok ? <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-green-700 dark:text-green-400" aria-hidden /> : <XCircle className="mt-0.5 size-[18px] shrink-0 text-red-700 dark:text-red-400" aria-hidden />}
                    <div className="flex flex-col">
                      <span className={cn("text-sm font-medium", resultado.ok ? "text-green-900 dark:text-green-200" : "text-red-900 dark:text-red-200")}>{resultado.ok ? "Operación realizada" : "Operación rechazada"}</span>
                      <span className={cn("text-[13px]", resultado.ok ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300")}>{resultado.titulo}</span>
                    </div>
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border shadow-xs">
                  <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
                    <span className="text-[13px] font-medium">Resultado</span>
                    <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Copiar JSON" onClick={() => { navigator.clipboard.writeText(JSON.stringify(resultado.json, null, 2)); toast("JSON copiado") }}>
                      <Copy className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                  <pre className="max-h-[420px] overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">{JSON.stringify(resultado.json, null, 2)}</pre>
                </div>
              </>
            ) : !creando && !actualizando && !eliminando && log.length === 0 && (
              <Vacio titulo="Sin operaciones todavía" texto="Elige una base y una operación; el resultado aparece aquí." />
            )}
            {!actualizando && historial}
          </div>
          {actualizando && <div className="lg:col-span-3 lg:col-start-3">{historial}</div>}
        </div>
      </Pagina>
    </>
  )
}
