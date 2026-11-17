// Prueba de renderizado React y contratos de períodos, sin automatizar un navegador.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir } from "node:fs/promises"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const web = join(root, "web")
const requireWeb = createRequire(join(web, "package.json"))
const { build } = requireWeb("esbuild")
const output = join(web, "node_modules", ".cache", "wikipipe-dashboard-test.cjs")
await mkdir(dirname(output), { recursive: true })

await build({
  stdin: {
    resolveDir: web,
    contents: `
      import React from "react"
      import { renderToStaticMarkup } from "react-dom/server"
      import { MemoryRouter } from "react-router-dom"
      import Resumen from "./src/pages/Resumen"
      import Arquitectura, { Diagrama } from "./src/pages/Arquitectura"
      export { KPIS, cambio } from "./src/lib/kpis"
      export { intervaloLocal, compararValores, COLOR } from "./src/lib/format"
      export { fixture } from "@/lib/api"
      export function render(page) {
        return renderToStaticMarkup(React.createElement(MemoryRouter, null,
          React.createElement(page === "flujo" ? Diagrama : page === "arquitectura" ? Arquitectura : Resumen, { onAbrir() {} })))
      }
    `,
  },
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  alias: { "@": join(web, "src") },
  plugins: [{
    name: "api-fixture",
    setup(context) {
      context.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: "api", namespace: "fixture" }))
      context.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `
          export const fixture = { kpis: {}, horas: [], ejecuciones: [], total: 55000,
            desde: "2026-11-16T23:00:00Z", corte: "2026-11-17T02:00:00Z",
            acumulado: { eventos: 55000, ediciones: 50000, creaciones: 5000, eventos_bot: 7858,
              reversiones: 2895, delta_bytes: 8200000, horas: 3, inicio: "2026-11-16T23:00:00Z", fin: "2026-11-17T02:00:00Z" } }
          export function useApi(ruta) {
            return { data: ruta.startsWith("/api/resumen") ? fixture : null,
              cargando: false, error: null, recargar() {} }
          }
          export async function api() { return {} }
        `,
        loader: "js",
      }))
    },
  }],
})

const { render, fixture, KPIS, cambio, intervaloLocal, compararValores, COLOR } = requireWeb(output)
for (const name of Object.keys(KPIS)) {
  fixture.kpis[name] = [
    { ventana: "2026-11-17T01:00:00Z", valor: 9.09, detalle: null },
    { ventana: "2026-11-17T00:00:00Z", valor: 9.1, detalle: null },
  ]
}
fixture.kpis.total_eventos_acumulados[0].valor = 55000
assert.equal(intervaloLocal("2026-11-17T04:00:00Z", "2026-11-17T05:00:00Z"), "16 nov · 23:00–17 nov · 00:00 UTC−5")
const summary = render("resumen")
for (const label of ["Última hora consolidada", "Acumulado", "20:00–21:00 UTC−5",
  "Entre las ediciones y creaciones de la hora", "Eventos hechos por bots", "Protagonistas de la hora"]) {
  assert.ok(summary.includes(label), `Falta el contexto visible ${label}`)
}
assert.ok(!summary.includes("porcentaje de eventos hechos por bots"))
assert.equal(KPIS.total_eventos_acumulados.periodo, "acumulado")
assert.ok(Object.entries(KPIS).every(([name, meta]) => name === "total_eventos_acumulados" || meta.periodo === "hora"))
assert.equal(cambio("eventos_procesados", [
  { ventana: "2026-11-17T02:00:00Z", valor: 20 },
  { ventana: "2026-11-17T00:00:00Z", valor: 10 },
]), null)
assert.ok(cambio("tasa_automatizacion_pct", fixture.kpis.tasa_automatizacion_pct).texto.includes("puntos porcentuales"))
assert.ok(summary.includes("Ediciones consolidadas"))
assert.ok(summary.includes("Páginas creadas"))
assert.ok(summary.includes("text-center"))
assert.equal(compararValores(5, 3), "bueno")
assert.equal(compararValores(3, 5), "malo")
assert.equal(compararValores(5, 3, true), "malo")
assert.equal(compararValores(null, 0), "neutro")
assert.equal(compararValores(NaN, 0), "neutro")
assert.equal(COLOR.humano, "#f97316")
const architecture = render("arquitectura")
assert.ok(architecture.includes("Google Cloud"))
assert.ok(architecture.includes("Cómo funciona"))
assert.ok(architecture.includes('role="tablist"'))
const explanation = render("flujo")
for (const label of ["Documento completo", "Conteos por minuto", "provisionales", "Resúmenes y KPIs",
  "Recuperación de una hora incompleta", "Consulta y visualización"]) {
  assert.ok(explanation.includes(label), `Falta el flujo ${label}`)
}
fixture.corte = null
for (const name of Object.keys(KPIS)) fixture.kpis[name] = []
assert.ok(render("resumen").includes("Pendiente de consolidación"))
console.log("React y métricas: períodos, contexto, mayúsculas, arquitectura y ausencia de datos verificados")
