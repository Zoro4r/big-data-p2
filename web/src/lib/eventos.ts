/** Resumen de un evento tal como lo devuelve /api/vivo. */
export interface EventoResumen {
  _id: string
  fecha: string
  wiki: string
  tipo: string
  titulo: string
  editor: string
  tipo_editor: string
  delta_bytes: number | null
  revierte_a: string | null
}

/** Tipo que se muestra en la lista: una reversión es una edición que deshace la de otro editor. */
export type TipoEvento = "edicion" | "nueva" | "categorizacion" | "reversion" | "registro" | "otro"

export const NOMBRE_TIPO: Record<TipoEvento, string> = {
  edicion: "Edición",
  nueva: "Página nueva",
  categorizacion: "Categorización",
  reversion: "Reversión",
  registro: "Registro",
  otro: "Otro",
}

/** Nombre en plural para el menú de filtros. */
export const PLURAL_TIPO: Record<TipoEvento, string> = {
  edicion: "Ediciones", nueva: "Páginas nuevas", categorizacion: "Categorizaciones",
  reversion: "Reversiones", registro: "Registros", otro: "Otros",
}

export function tipoEvento(e: { tipo: string; revierte_a?: string | null }): TipoEvento {
  if (e.revierte_a) return "reversion"
  if (e.tipo === "edit") return "edicion"
  if (e.tipo === "new") return "nueva"
  if (e.tipo === "categorize") return "categorizacion"
  if (e.tipo === "log") return "registro"
  return "otro"
}

export type TipoEditor = "registrado" | "temporal" | "bot"
export const NOMBRE_EDITOR: Record<TipoEditor, string> = { registrado: "Registrados", temporal: "Cuentas temporales", bot: "Bots" }

/** Filtros del menú: un conjunto vacío significa "Todos". */
export interface Filtros {
  tipos: Set<TipoEvento>
  editores: Set<TipoEditor>
}

export const FILTROS_TIPO: TipoEvento[] = ["edicion", "nueva", "categorizacion", "reversion"]
export const FILTROS_EDITOR: TipoEditor[] = ["registrado", "temporal", "bot"]

export function cumpleFiltros(e: EventoResumen, f: Filtros): boolean {
  const okTipo = f.tipos.size === 0 || f.tipos.has(tipoEvento(e))
  const okEditor = f.editores.size === 0 || f.editores.has(e.tipo_editor as TipoEditor)
  return okTipo && okEditor
}

/** Espacios de nombres de MediaWiki (los más comunes), con su nombre en español. */
const ESPACIOS: Record<number, string> = {
  0: "Artículo", 1: "Discusión", 2: "Usuario", 3: "Usuario discusión", 4: "Wikipedia", 5: "Wikipedia discusión",
  6: "Archivo", 7: "Archivo discusión", 8: "MediaWiki", 10: "Plantilla", 11: "Plantilla discusión",
  12: "Ayuda", 14: "Categoría", 15: "Categoría discusión", 100: "Portal", 101: "Portal discusión",
  104: "Anexo", 118: "Borrador", 119: "Borrador discusión", 828: "Módulo",
}
export const nombreEspacio = (n: number | null | undefined) => (n == null ? "—" : ESPACIOS[n] ?? `Espacio ${n}`)
