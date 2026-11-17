// Historial del selector CRUD: orden de creación, lectura actual y registros eliminados.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir } from "node:fs/promises"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const web = join(root, "web")
const requireWeb = createRequire(join(web, "package.json"))
const output = join(web, "node_modules", ".cache", "wikipipe-crud-test.cjs")
await mkdir(dirname(output), { recursive: true })
await requireWeb("esbuild").build({
  stdin: { resolveDir: web, contents: `
    export { agregarCreados, resolverCreados } from "./src/lib/crud-creados"
    export { ApiError } from "./src/lib/api"
  ` },
  outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external",
  alias: { "@": join(web, "src") },
})
const { agregarCreados, resolverCreados, ApiError } = requireWeb(output)

// Más de cinco creaciones, incluidas filas de horas antiguas: no deben desaparecer con el stream.
let ids = []
for (let i = 0; i < 8; i++) ids = agregarCreados(ids, [`documento-${i}`])
assert.deepEqual(ids, Array.from({ length: 8 }, (_, i) => `documento-${7 - i}`))
// Guardar otra vez la misma clave no duplica ni cambia su lugar en el orden de creación.
assert.deepEqual(agregarCreados(ids, ["documento-1"]), ids)
assert.deepEqual(agregarCreados([], ["origen", "destino", "origen"]), ["destino", "origen"])

// La respuesta puede llegar en otro orden; se mantiene el orden de creación y el contenido actual.
const actual = await resolverCreados(ids, async (id) => {
  if (id === "documento-6") throw new ApiError(404, "No existe")
  await new Promise((r) => setTimeout(r, id.endsWith("7") ? 15 : 0))
  return { id, titulo: id === "documento-1" ? "Título actualizado" : id }
})
assert.deepEqual(actual.eliminados, ["documento-6"])
assert.deepEqual(actual.datos.map((d) => d.id), ids.filter((id) => id !== "documento-6"))
assert.equal(actual.datos.find((d) => d.id === "documento-1").titulo, "Título actualizado")
assert.equal(ids.length, 8)
assert.deepEqual(await resolverCreados([], () => { throw new Error("No debe consultar") }), { datos: [], eliminados: [] })

// Una caída o falta de autenticación no debe tratarse como una eliminación del registro.
for (const status of [401, 500]) {
  await assert.rejects(resolverCreados(["conservar"], async () => { throw new ApiError(status, "Temporal") }),
    (e) => e.status === status)
}
await assert.rejects(resolverCreados(["conservar"], async () => { throw new Error("Sin conexión") }), /Sin conexión/)

// Cada base usa su propio historial; la clave completa de Cassandra incluye KPI y ventana.
const mongo = agregarCreados([], ["demo-mongo"])
const cassandra = agregarCreados([], [JSON.stringify(["demo_kpi|especial", "2026-11-14T10:00:00Z"]),
  JSON.stringify(["demo_kpi|especial", "2026-11-14T11:00:00Z"])])
const neo4j = agregarCreados([], ["demo_editor"])
assert.equal(cassandra.length, 2)
assert.deepEqual(mongo, ["demo-mongo"])
assert.deepEqual(neo4j, ["demo_editor"])
assert.notEqual(cassandra[0], cassandra[1])
console.log("CRUD: historial sin límite de cinco, orden, datos actualizados y eliminaciones verificados")
