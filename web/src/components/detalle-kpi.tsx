import { baseDeCalculo } from "@/components/fuente"
import { Base, ModalMetrica } from "@/components/modal-metrica"
import { entero, horaLocal } from "@/lib/format"
import { cambio, formatoKpi, KPIS, type Kpi, type PuntoKpi } from "@/lib/kpis"

const ORDEN = Object.keys(KPIS) as Kpi[]
const UNIDAD_ENTIDAD: Partial<Record<Kpi, string>> = {
  pagina_mas_disputada: "reversiones recibidas",
  editor_mas_conectado: "coeditores",
  editor_mas_revertido: "reversiones",
}
const TONO = { bueno: "text-green-700 dark:text-green-400", malo: "text-red-700 dark:text-red-400", neutro: "" }

/** "enwiki:Frozen yogurt (revertido por 2 editores)" → "Frozen yogurt" */
const nombreEntidad = (detalle: string | null | undefined) => (detalle ?? "—").split(" (")[0].replace(/^(en|es)wiki:/, "")

/** Detalle de un KPI del Resumen. */
export function DetalleKpi(props: {
  kpi: Kpi | null
  series: Record<Kpi, PuntoKpi[]> | null
  etiqueta: string
  onCambiar: (k: Kpi | null) => void
}) {
  const { kpi, series, etiqueta, onCambiar } = props
  if (!kpi) return null
  const meta = KPIS[kpi]
  const serie = series?.[kpi] ?? []
  const [actual, previa] = serie
  const entidad = meta.unidad === "entidad"
  const c = cambio(kpi, serie)
  const valores = serie.slice(0, 24).map((p) => p.valor).filter((v): v is number => v != null).reverse()
  const promedio = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null
  const base = baseDeCalculo(meta.fuente)
  const i = ORDEN.indexOf(kpi)
  const anterior = ORDEN[(i - 1 + ORDEN.length) % ORDEN.length]
  const siguiente = ORDEN[(i + 1) % ORDEN.length]

  const datos: [string, React.ReactNode][] = []
  if (!entidad && actual?.detalle) datos.push(["En la hora", actual.detalle])
  datos.push(["Hora anterior", entidad ? `${nombreEntidad(previa?.detalle)} (${entero(previa?.valor)})` : formatoKpi(kpi, previa?.valor)])
  if (!entidad && promedio != null) datos.push([`Promedio ${valores.length} h`, formatoKpi(kpi, promedio)])

  return (
    <ModalMetrica
      m={{
        titulo: meta.nombre,
        etiqueta,
        momento: actual ? `${horaLocal(actual.ventana)}–${horaLocal(actual.ventana, false).slice(0, 2)}:59 UTC−5` : "Sin datos",
        valor: entidad ? nombreEntidad(actual?.detalle) : formatoKpi(kpi, actual?.valor),
        valorEsTexto: entidad,
        nota: entidad ? `${entero(actual?.valor)} ${UNIDAD_ENTIDAD[kpi]}`
          : c ? `${c.sube ? "↗" : "↘"} ${c.texto.replace(/^[+−]/, "")} ${c.sube ? "más" : "menos"} que la hora anterior` : "Igual que la hora anterior",
        notaClase: c && !entidad ? TONO[c.tono] : undefined,
        serie: entidad ? undefined : { valores, desde: `hace ${valores.length} h` },
        datos,
        definicion: meta.definicion,
        calculo: meta.fraccion ? { fraccion: meta.fraccion } : { texto: meta.formula },
        lectura: meta.lectura,
        origen: base === "cassandra"
          ? <>Se calcula y se guarda en <Base base="cassandra" />.</>
          : <>Se calcula en <Base base={base} /> y se guarda en <Base base="cassandra" />.</>,
      }}
      anterior={{ nombre: KPIS[anterior].nombre, ir: () => onCambiar(anterior) }}
      siguiente={{ nombre: KPIS[siguiente].nombre, ir: () => onCambiar(siguiente) }}
      onCerrar={() => onCambiar(null)}
    />
  )
}
