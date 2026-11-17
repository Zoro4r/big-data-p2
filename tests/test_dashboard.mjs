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
      import Actividad from "./src/pages/Actividad"
      import Explorador from "./src/pages/Explorador"
      export { totalesActividad } from "./src/lib/actividad"
      import { TarjetasVivo } from "./src/pages/Vivo"
      import { TarjetaKpi } from "./src/components/common"
      import Arquitectura, { Diagrama } from "./src/pages/Arquitectura"
      export { KPIS, cambio } from "./src/lib/kpis"
      export { intervaloLocal, compararValores, variacion, COLOR } from "./src/lib/format"
      export { fixture, actividadFixture, exploradorFixture } from "@/lib/api"
      export function renderVivo(actual, anterior) { return renderToStaticMarkup(React.createElement(TarjetasVivo, {actual, anterior, onAbrir() {}})) }
      export function renderKpi(props) { return renderToStaticMarkup(React.createElement(TarjetaKpi, props)) }
      export function render(page) {
        return renderToStaticMarkup(React.createElement(MemoryRouter, null,
          React.createElement(page === "flujo" ? Diagrama : page === "arquitectura" ? Arquitectura : page === "actividad" ? Actividad : page === "explorador" ? Explorador : Resumen, { onAbrir() {}, vistaInicial: page === "resumen-acumulado" ? "acumulado" : "hora" })))
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
          export const fixture = { kpis: {}, horas: [{ hora_utc: "2026-11-17T01:00:00Z", wiki: "enwiki", eventos: 15000, eventos_bot: 2000, reversiones: 717 }], ejecuciones: [], total: 55000,
            desde: "2026-11-16T23:00:00Z", corte: "2026-11-17T02:00:00Z",
            acumulado: { eventos: 55000, ediciones: 50000, creaciones: 5000, eventos_bot: 7858,
              reversiones: 2895, delta_bytes: 8200000, horas: 3, inicio: "2026-11-16T23:00:00Z", fin: "2026-11-17T02:00:00Z" } }
          const protagonistas = {
            pagina_mas_disputada: { valor: 99, detalle: "enwiki:HistorialSolo" },
            editor_mas_conectado: { valor: 88, detalle: "EditorHistorico" },
            editor_mas_revertido: { valor: 77, detalle: "RevertidoHistorico (revertido por 3 editores)" },
          }
          export const actividadFixture = { fecha: "2026-11-16", fechas: ["2026-11-16"], corte: "2026-11-17T02:00:00Z",
            pendientes: {eventos: 29653, horas: 3}, top: [],
            minutos: [{t: "2026-11-16T23:00:00Z", eventos: 333, eventos_bot: 20, reversiones: 1}],
            horas: [{hora: 18, eventos: 20000, eventos_bot: 2858, eventos_humanos: 17142, reversiones: 1000},
              {hora: 19, eventos: 20000, eventos_bot: 2858, eventos_humanos: 17142, reversiones: 1000},
              {hora: 20, eventos: 15000, eventos_bot: 2142, eventos_humanos: 12858, reversiones: 895}] }
          export const exploradorFixture = {total: 100, corte: "2026-11-17T02:00:00Z", eventos: [], tipos: [
            {wiki: "enwiki", tipo: "edit", eventos: 80}, {wiki: "enwiki", tipo: "new", eventos: 12},
            {wiki: "eswiki", tipo: "categorize", eventos: 5}, {wiki: "eswiki", tipo: "log", eventos: 3}]}
          export function useApi(ruta) {
            return { data: ruta?.startsWith("/api/actividad") ? actividadFixture : ruta?.startsWith("/api/eventos?") ? exploradorFixture : ruta?.startsWith("/api/resumen/acumulado/protagonistas") ? { protagonistas, actualizando: false } : ruta?.startsWith("/api/resumen") ? fixture : null,
              cargando: false, error: null, recargar() {} }
          }
          export async function api() { return {} }
        `,
        loader: "js",
      }))
    },
  }],
})

const { render, renderKpi, renderVivo, totalesActividad, actividadFixture, exploradorFixture, fixture, KPIS, cambio, intervaloLocal, compararValores, variacion, COLOR } = requireWeb(output)
for (const name of Object.keys(KPIS)) {
  fixture.kpis[name] = [
    { ventana: "2026-11-17T01:00:00Z", valor: 9.09, detalle: null },
    { ventana: "2026-11-17T00:00:00Z", valor: 9.1, detalle: null },
  ]
}
fixture.kpis.total_eventos_acumulados[0].valor = 55000
fixture.kpis.pagina_mas_disputada[0].detalle = "enwiki:HoraSolo"
assert.equal(intervaloLocal("2026-11-17T04:00:00Z", "2026-11-17T05:00:00Z"), "16 nov · 23:00–17 nov · 00:00 UTC−5")
const summary = render("resumen")
for (const label of ["Última hora consolidada", "Acumulado", "20:00–21:00 UTC−5",
  "Entre las ediciones y creaciones", "Eventos hechos por bots", "Protagonistas de la hora"]) {
  assert.ok(summary.includes(label), `Falta el contexto visible ${label}`)
}
assert.ok(!summary.includes("porcentaje de eventos hechos por bots"))
assert.equal(KPIS.total_eventos_acumulados.periodo, "acumulado")
assert.ok(Object.entries(KPIS).every(([name, meta]) => name === "total_eventos_acumulados" || meta.periodo === "hora"))
assert.equal(cambio("eventos_procesados", [
  { ventana: "2026-11-17T02:00:00Z", valor: 20 },
  { ventana: "2026-11-17T00:00:00Z", valor: 10 },
]), null)
assert.ok(cambio("tasa_automatizacion_pct", fixture.kpis.tasa_automatizacion_pct).texto.includes(" pp"))
assert.ok(!summary.includes("Ediciones consolidadas"))
const cumulative = render("resumen-acumulado")
assert.ok(!summary.includes("Se procesaron"))
assert.ok(!summary.includes("Cambios frente a la hora anterior"))
assert.ok(summary.includes("HoraSolo") && !summary.includes("HistorialSolo"))
assert.ok(cumulative.includes("HistorialSolo") && !cumulative.includes("HoraSolo"))
assert.ok(cumulative.includes("Páginas creadas"))
assert.ok(cumulative.includes("55,000"))
assert.ok(cumulative.includes("Más detalles del acumulado"))
assert.ok(cumulative.includes("Protagonistas del acumulado"))
assert.ok(cumulative.includes("Evolución por hora"))
assert.equal(summary.match(/<table[\s\S]*?<\/table>/)?.[0], cumulative.match(/<table[\s\S]*?<\/table>/)?.[0])
assert.equal((cumulative.slice(0, cumulative.indexOf("Más detalles del acumulado")).match(/Ver definición/g) ?? []).length, 4)
assert.ok(!cumulative.includes("Eventos de la hora: "))
const neutralCard = renderKpi({ etiqueta: "Eventos", valor: "100", pie: "Esta hora" })
assert.ok(neutralCard.includes("text-foreground"))
assert.ok(neutralCard.includes("self-center"))
assert.ok(!neutralCard.includes("text-center"))
const changedCard = renderKpi({ etiqueta: "Eventos", valor: "100", pie: "Esta hora", cambio: { texto: "−3 pp", tono: "malo", sube: false } })
assert.ok(changedCard.includes("text-red-700"))
const mainValue = changedCard.match(/data-slot="card-title"[^>]*>/)?.[0]
assert.ok(mainValue?.includes("text-foreground"))
assert.ok(!mainValue?.includes("text-red"))
assert.equal(variacion(20, 23, "pp").texto, "−3 pp")
assert.equal(variacion(20, 20).tono, "neutro")
assert.equal(variacion(null, 0), null)
assert.equal((summary.match(/role="tab"/g) ?? []).length, 2)
assert.equal((summary.slice(0, summary.indexOf("Más detalles de la hora")).match(/Ver definición/g) ?? []).length, 4)
assert.ok(summary.includes("Más detalles de la hora"))
assert.ok(!summary.includes("actividad exclusivamente de esta hora"))
assert.ok(!cumulative.includes("· 3 horas consolidadas"))
assert.ok(!summary.includes("Cassandra resumen_por_hora y ejecuciones"))
assert.ok(summary.indexOf("Más detalles de la hora") < summary.indexOf("Evolución por hora"))
assert.ok(cumulative.indexOf("Más detalles del acumulado") < cumulative.indexOf("Evolución por hora"))
assert.ok(summary.includes("Variación de contenido") && !summary.includes("Cambio neto de contenido"))
const positiveContent = renderKpi({ etiqueta: "Variación de contenido", valor: "+2.44 MB", pie: "Añadidos − eliminados", tonoValor: "bueno", cambio: { texto: "−747.5 kB", tono: "malo", sube: false } })
assert.ok(positiveContent.match(/data-slot="card-title"[^>]*>/)?.[0].includes("text-green-700"))
assert.ok(positiveContent.includes("text-red-700"))
assert.ok(positiveContent.indexOf('data-slot="badge"') < positiveContent.indexOf('data-slot="card-title"'))
assert.ok(renderKpi({ etiqueta: "Variación de contenido", valor: "−2.44 MB", pie: "Añadidos − eliminados", tonoValor: "malo" }).match(/data-slot="card-title"[^>]*>/)?.[0].includes("text-red-700"))
assert.equal(cambio("volumen_neto_bytes", [{ ventana: "2026-11-17T01:00:00Z", valor: 2000000 }, { ventana: "2026-11-17T00:00:00Z", valor: 3000000 }]).texto, "−1.00 MB")
assert.equal(cambio("volumen_neto_bytes", [{ ventana: "2026-11-17T01:00:00Z", valor: 2000000 }, { ventana: "2026-11-17T00:00:00Z", valor: 1000000 }]).texto, "+1.00 MB")
assert.equal(compararValores(5, 3), "bueno")
assert.equal(compararValores(3, 5), "malo")
assert.equal(compararValores(5, 5), "neutro")
assert.equal(compararValores(null, 0), "neutro")
assert.equal(compararValores(NaN, 0), "neutro")
assert.equal(COLOR.humano, COLOR.registrado)
assert.notEqual(COLOR.humano, COLOR.bot)
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

const live = renderVivo({ eventos: 895, eventos_bot: 444, reversiones: 3, editores: {registrado: 182, bot: 18} },
  { eventos: 1100, eventos_bot: 532, reversiones: 9, editores: {registrado: 222, bot: 22} })
for (const label of ["Eventos registrados", "895", "Promedio: 3.0 eventos/s", "−205", "Editores participantes", "182 personas y 18 bots", "444 de 895 eventos", "Deshacen cambios de otro editor"]) {
  assert.ok(live.includes(label), `Falta el contexto de En vivo: ${label}`)
}
assert.ok(!live.includes("Eventos por segundo"))
assert.ok(!live.includes("Editores activos"))
const emptyLive = renderVivo({eventos: 0, eventos_bot: 0, reversiones: 0, editores: {}}, {eventos: 0, eventos_bot: 0, reversiones: 0, editores: {}})
assert.ok(!emptyLive.includes("NaN"))


const dailyTotals = totalesActividad(actividadFixture)
assert.equal(dailyTotals.ev, 55000)
assert.equal(dailyTotals.min, 180)
assert.equal(Math.round(dailyTotals.ev / dailyTotals.min), 306)
const activity = render("actividad")
assert.ok(activity.includes("55,000") && activity.includes("29,653"))
assert.ok(activity.includes("306"))
assert.ok(activity.includes("Cierre: 16 nov · 21:00"))
const explorer = render("explorador")
for (const text of ["Dataset almacenado", "100 eventos de", "80.0 % del total almacenado", "Cambios en páginas existentes", "Entradas y salidas de categorías"]) assert.ok(explorer.includes(text), text)
assert.ok(!explorer.includes("últimas 24 h"))
exploradorFixture.total = 0; exploradorFixture.tipos = []
assert.equal((render("explorador").match(/Ver definición/g) ?? []).length, 4)
actividadFixture.horas = []; actividadFixture.minutos = []; actividadFixture.corte = null
assert.ok(render("actividad").includes("Sin horas consolidadas"))
console.log("React: períodos, sumas consolidadas, dataset del Explorador, En vivo y estados sin datos verificados")
