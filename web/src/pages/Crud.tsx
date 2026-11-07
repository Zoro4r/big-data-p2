import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { CheckCircle2, Copy, XCircle, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Seccion, Vacio } from "@/components/common"
import { Header, Pagina } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { useWiki } from "@/lib/estado"
import { cn } from "@/lib/utils"

type Op = "CREATE" | "READ" | "UPDATE" | "DELETE" | "RECHAZADO" | "VALIDADOR"
interface Registro { op: Op; base: string; detalle: string; hora: string; ok: boolean }
/** validacion: el validador de MongoDB rechazó el documento de prueba, que es lo esperado */
interface Resultado { titulo: string; ok: boolean; validacion?: boolean; json: unknown }

const hoy = () => new Date().toISOString().slice(0, 10)
const horaActual = () => new Date().toISOString().slice(11, 19)

function Campo({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>
}

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

  async function ejecutar(op: Op, base: string, detalle: string, llamada: () => Promise<unknown>) {
    setOcupado(true)
    try {
      const json = await llamada()
      setResultado({ titulo: `${op} · ${base}`, ok: true, json })
      setLog((l) => [{ op, base, detalle, hora: horaActual(), ok: true }, ...l].slice(0, 8))
      toast.success(`${op} ejecutado en ${base}`)
    } catch (e) {
      const msg = (e as Error).message
      setResultado({ titulo: `${op} · ${base}`, ok: false, json: { error: msg } })
      setLog((l) => [{ op: "RECHAZADO" as Op, base, detalle: msg, hora: horaActual(), ok: false }, ...l].slice(0, 8))
      toast.error(msg)
    } finally {
      setOcupado(false)
    }
  }

  /** Envía un documento sin "derived": el $jsonSchema de events debe rechazarlo y no guardarlo. */
  async function probarValidador() {
    setOcupado(true)
    const base = "MongoDB · validador $jsonSchema"
    try {
      const r = await api<{ rechazado: boolean; motivo?: string }>("/api/crud/mongo/invalido", { method: "POST" })
      if (r.rechazado) {
        setResultado({ titulo: base, ok: true, validacion: true, json: r })
        setLog((l) => [{ op: "VALIDADOR" as Op, base, detalle: "documento sin derived rechazado", hora: horaActual(), ok: true }, ...l].slice(0, 8))
        toast.success("El validador rechazó el documento inválido, como se esperaba")
      } else {
        setResultado({ titulo: base, ok: false, json: r })
        setLog((l) => [{ op: "RECHAZADO" as Op, base, detalle: "el validador aceptó un documento inválido", hora: horaActual(), ok: false }, ...l].slice(0, 8))
        toast.error("El validador aceptó un documento inválido")
      }
    } catch (e) {
      setResultado({ titulo: base, ok: false, json: { error: (e as Error).message } })
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  // ---------------------------------------------------------------- MongoDB
  const [mOp, setMOp] = useState("Crear")
  const [m, setM] = useState({ id: `demo-crud-${Date.now()}`, titulo: "Demo CRUD", editor: "Demo_Editor", comentario: "Edición creada para la demostración del CRUD", campo: "comment", valor: "Comentario actualizado desde el dashboard" })
  const enviarMongo = (e: FormEvent) => {
    e.preventDefault()
    const id = encodeURIComponent(m.id)
    if (mOp === "Crear") ejecutar("CREATE", "MongoDB · events", m.id, () => api("/api/crud/mongo", { method: "POST", body: JSON.stringify({ _id: m.id, titulo: m.titulo, editor: m.editor, comentario: m.comentario, wiki: wikiForm }) }))
    if (mOp === "Consultar") ejecutar("READ", "MongoDB · events", m.id, () => api(`/api/crud/mongo/${id}`))
    if (mOp === "Actualizar") ejecutar("UPDATE", "MongoDB · events", `${m.id} · ${m.campo}`, () => api(`/api/crud/mongo/${id}`, { method: "PATCH", body: JSON.stringify({ campo: m.campo, valor: m.valor }) }))
    if (mOp === "Eliminar") ejecutar("DELETE", "MongoDB · events", m.id, () => api(`/api/crud/mongo/${id}`, { method: "DELETE" }))
  }

  // ---------------------------------------------------------------- Cassandra
  const [cOp, setCOp] = useState("Insertar")
  const { wiki } = useWiki()
  const wikiForm = wiki === "ambas" ? "enwiki" : wiki  // con "Ambas" en la cabecera, los formularios usan enwiki
  const [c, setC] = useState({ editor: "Demo_Editor", fecha: hoy(), hora: String(new Date().getUTCHours()), wiki: wikiForm as string, eventos: "10", ediciones: "8" })
  useEffect(() => setC((x) => ({ ...x, wiki: wikiForm })), [wikiForm])
  const filaC = () => ({ editor: c.editor, fecha: c.fecha, hora: Number(c.hora), wiki: c.wiki, eventos: Number(c.eventos), ediciones: Number(c.ediciones) })
  const enviarCassandra = (e: FormEvent) => {
    e.preventDefault()
    const base = "Cassandra · actividad_editor"
    if (cOp === "Insertar") ejecutar("CREATE", base, c.editor, () => api("/api/crud/cassandra", { method: "POST", body: JSON.stringify(filaC()) }))
    if (cOp === "Consultar") ejecutar("READ", base, c.editor, () => api(`/api/crud/cassandra?editor=${encodeURIComponent(c.editor)}`))
    if (cOp === "Actualizar") ejecutar("UPDATE", base, `${c.editor} · eventos ${c.eventos}`, () => api("/api/crud/cassandra", { method: "PATCH", body: JSON.stringify(filaC()) }))
    if (cOp === "Eliminar") ejecutar("DELETE", base, `${c.editor} · ${c.fecha} ${c.hora}:00`, () => api(`/api/crud/cassandra?${new URLSearchParams({ editor: c.editor, fecha: c.fecha, hora: c.hora, wiki: c.wiki })}`, { method: "DELETE" }))
  }

  // ---------------------------------------------------------------- Neo4j
  const [nOp, setNOp] = useState("Crear nodo")
  const [n, setN] = useState({ user: "Demo_Patrullero", tipo: "registrado", destino: "Demo_Vandalo", rel: "REVIRTIO", veces: "1", clave: "rol", valor: "patrullero" })
  const enviarNeo = (e: FormEvent) => {
    e.preventDefault()
    const base = "Neo4j"
    const u = encodeURIComponent(n.user)
    if (nOp === "Crear nodo") ejecutar("CREATE", base, `(:Editor {user: "${n.user}"})`, () => api("/api/crud/neo4j/editor", { method: "POST", body: JSON.stringify({ user: n.user, tipo: n.tipo }) }))
    if (nOp === "Crear relación") ejecutar("CREATE", base, `(${n.user})-[:${n.rel}]->(${n.destino})`, () => api("/api/crud/neo4j/relacion", { method: "POST", body: JSON.stringify({ origen: n.user, destino: n.destino, tipo: n.rel, veces: Number(n.veces) }) }))
    if (nOp === "Consultar") ejecutar("READ", base, n.user, () => api(`/api/crud/neo4j/editor/${u}`))
    if (nOp === "Actualizar") ejecutar("UPDATE", base, `${n.user}.${n.clave}`, () => api(`/api/crud/neo4j/editor/${u}`, { method: "PATCH", body: JSON.stringify({ clave: n.clave, valor: n.valor }) }))
    if (nOp === "Eliminar relación") ejecutar("DELETE", base, `(${n.user})-[:${n.rel}]->(${n.destino})`, () => api(`/api/crud/neo4j/relacion?${new URLSearchParams({ origen: n.user, destino: n.destino, tipo: n.rel })}`, { method: "DELETE" }))
    if (nOp === "Eliminar nodo") ejecutar("DELETE", base, `DETACH DELETE ${n.user}`, () => api(`/api/crud/neo4j/editor/${u}`, { method: "DELETE" }))
  }

  const boton = (texto: string, peligro = false) => (
    <Button type="submit" disabled={ocupado} variant={peligro ? "destructive" : "default"} className="h-10 w-full text-sm">{texto}</Button>
  )

  return (
    <>
      <Header ruta={["Administración", "Operaciones CRUD"]} />
      <Pagina titulo="Operaciones CRUD" descripcion="Crear, consultar, actualizar y eliminar en las tres bases. Para la demostración, usa nombres que empiecen con «Demo_» y bórralos al terminar.">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
          <Tabs defaultValue="mongo" className="gap-4 lg:col-span-2">
            <TabsList className="w-full">
              <TabsTrigger value="mongo">MongoDB</TabsTrigger>
              <TabsTrigger value="cassandra">Cassandra</TabsTrigger>
              <TabsTrigger value="neo4j">Neo4j</TabsTrigger>
            </TabsList>

            <TabsContent value="mongo">
              <Seccion titulo="Colección events" descripcion={`insert_one · find_one · update_one ($set) · delete_one · wiki del documento: ${wikiForm}`}>
                <form onSubmit={enviarMongo} className="flex flex-col gap-4">
                  <Operaciones valor={mOp} onChange={setMOp} opciones={["Crear", "Consultar", "Actualizar", "Eliminar"]} />
                  <Campo id="m-id" label="_id"><Input id="m-id" className="font-mono text-xs" value={m.id} onChange={(e) => setM({ ...m, id: e.target.value })} /></Campo>
                  {mOp === "Crear" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Campo id="m-titulo" label="Título de la página"><Input id="m-titulo" value={m.titulo} onChange={(e) => setM({ ...m, titulo: e.target.value })} /></Campo>
                        <Campo id="m-editor" label="Editor"><Input id="m-editor" value={m.editor} onChange={(e) => setM({ ...m, editor: e.target.value })} /></Campo>
                      </div>
                      <Campo id="m-com" label="Comentario"><Textarea id="m-com" rows={3} value={m.comentario} onChange={(e) => setM({ ...m, comentario: e.target.value })} /></Campo>
                    </>
                  )}
                  {mOp === "Actualizar" && (
                    <div className="grid grid-cols-2 gap-3">
                      <Campo id="m-campo" label="Campo"><Input id="m-campo" value={m.campo} onChange={(e) => setM({ ...m, campo: e.target.value })} /></Campo>
                      <Campo id="m-valor" label="Nuevo valor"><Input id="m-valor" value={m.valor} onChange={(e) => setM({ ...m, valor: e.target.value })} /></Campo>
                    </div>
                  )}
                  {boton({ Crear: "Insertar documento", Consultar: "Consultar", Actualizar: "Actualizar ($set)", Eliminar: "Eliminar documento" }[mOp] ?? "Ejecutar", mOp === "Eliminar")}
                  {mOp === "Crear" && (
                    <div className="mt-1 flex flex-col gap-2 border-t pt-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">Prueba de validación: intenta insertar un evento sin el campo «derived». El validador de la colección debe rechazarlo.</p>
                      <Button type="button" variant="outline" disabled={ocupado} onClick={probarValidador} className="h-10 w-full">
                        <ShieldCheck aria-hidden />Probar el validador
                      </Button>
                    </div>
                  )}
                </form>
              </Seccion>
            </TabsContent>

            <TabsContent value="cassandra">
              <Seccion titulo="Tabla actividad_editor" descripcion="Clave primaria ((editor), fecha, hora, wiki) · la partición es el editor">
                <form onSubmit={enviarCassandra} className="flex flex-col gap-4">
                  <Operaciones valor={cOp} onChange={setCOp} opciones={["Insertar", "Consultar", "Actualizar", "Eliminar"]} />
                  <Campo id="c-editor" label="editor"><Input id="c-editor" value={c.editor} onChange={(e) => setC({ ...c, editor: e.target.value })} /></Campo>
                  {cOp !== "Consultar" && (
                    <div className="grid grid-cols-3 gap-3">
                      <Campo id="c-fecha" label="fecha"><Input id="c-fecha" type="date" value={c.fecha} onChange={(e) => setC({ ...c, fecha: e.target.value })} /></Campo>
                      <Campo id="c-hora" label="hora"><Input id="c-hora" type="number" min={0} max={23} value={c.hora} onChange={(e) => setC({ ...c, hora: e.target.value })} /></Campo>
                      <Campo id="c-wiki" label="wiki">
                        <Select value={c.wiki} onValueChange={(v) => setC({ ...c, wiki: v })}><SelectTrigger id="c-wiki" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="enwiki">enwiki</SelectItem><SelectItem value="eswiki">eswiki</SelectItem></SelectContent></Select>
                      </Campo>
                    </div>
                  )}
                  {(cOp === "Insertar" || cOp === "Actualizar") && (
                    <div className="grid grid-cols-2 gap-3">
                      <Campo id="c-ev" label="eventos"><Input id="c-ev" type="number" min={0} value={c.eventos} onChange={(e) => setC({ ...c, eventos: e.target.value })} /></Campo>
                      <Campo id="c-ed" label="ediciones"><Input id="c-ed" type="number" min={0} value={c.ediciones} onChange={(e) => setC({ ...c, ediciones: e.target.value })} /></Campo>
                    </div>
                  )}
                  {boton({ Insertar: "INSERT", Consultar: "SELECT", Actualizar: "UPDATE", Eliminar: "DELETE" }[cOp] ?? "Ejecutar", cOp === "Eliminar")}
                </form>
              </Seccion>
            </TabsContent>

            <TabsContent value="neo4j">
              <Seccion titulo="Grafo de editores" descripcion="MERGE de nodos y relaciones · SET de propiedades · DELETE / DETACH DELETE">
                <form onSubmit={enviarNeo} className="flex flex-col gap-4">
                  <Select value={nOp} onValueChange={setNOp}>
                    <SelectTrigger className="w-full" aria-label="Operación"><SelectValue /></SelectTrigger>
                    <SelectContent>{["Crear nodo", "Crear relación", "Consultar", "Actualizar", "Eliminar relación", "Eliminar nodo"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                  <Campo id="n-user" label={nOp.includes("relación") ? "origen" : "user"}><Input id="n-user" value={n.user} onChange={(e) => setN({ ...n, user: e.target.value })} /></Campo>
                  {nOp === "Crear nodo" && (
                    <Campo id="n-tipo" label="tipo">
                      <Select value={n.tipo} onValueChange={(v) => setN({ ...n, tipo: v })}><SelectTrigger id="n-tipo" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="registrado">registrado</SelectItem><SelectItem value="temporal">temporal</SelectItem><SelectItem value="bot">bot</SelectItem></SelectContent></Select>
                    </Campo>
                  )}
                  {nOp.includes("relación") && (
                    <div className="grid grid-cols-2 gap-3">
                      <Campo id="n-rel" label="tipo de relación">
                        <Select value={n.rel} onValueChange={(v) => setN({ ...n, rel: v })}><SelectTrigger id="n-rel" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>{["REVIRTIO", "MENSAJE_A", "AGRADECIO", "BLOQUEO"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
                      </Campo>
                      <Campo id="n-dest" label="destino"><Input id="n-dest" value={n.destino} onChange={(e) => setN({ ...n, destino: e.target.value })} /></Campo>
                    </div>
                  )}
                  {nOp === "Crear relación" && <Campo id="n-veces" label="veces"><Input id="n-veces" type="number" min={1} value={n.veces} onChange={(e) => setN({ ...n, veces: e.target.value })} /></Campo>}
                  {nOp === "Actualizar" && (
                    <div className="grid grid-cols-2 gap-3">
                      <Campo id="n-clave" label="propiedad"><Input id="n-clave" value={n.clave} onChange={(e) => setN({ ...n, clave: e.target.value })} /></Campo>
                      <Campo id="n-valor" label="valor"><Input id="n-valor" value={n.valor} onChange={(e) => setN({ ...n, valor: e.target.value })} /></Campo>
                    </div>
                  )}
                  {boton(nOp, nOp.startsWith("Eliminar"))}
                </form>
              </Seccion>
            </TabsContent>
          </Tabs>

          <div className="flex flex-col gap-4 lg:col-span-3 lg:pt-[52px]">
            {resultado ? (
              <>
                {resultado.validacion ? (
                  <div role="status" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-900 dark:bg-blue-950/40">
                    <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-blue-700 dark:text-blue-400" aria-hidden />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-200">El validador rechazó el documento (resultado esperado)</span>
                      <span className="text-[13px] text-blue-800 dark:text-blue-300">El documento de prueba no tiene el campo «derived», que el $jsonSchema de la colección events exige. MongoDB no lo guardó.</span>
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
            ) : (
              <Vacio titulo="Sin operaciones todavía" texto="Elige una base y una operación; el resultado aparece aquí." />
            )}
            {log.length > 0 && (
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
            )}
          </div>
        </div>
      </Pagina>
    </>
  )
}
