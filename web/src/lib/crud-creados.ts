import { useEffect, useState } from "react"
import { ApiError } from "@/lib/api"

/** Solo identificadores de esta pestaña; los documentos se consultan de nuevo al abrir el selector. */
export function agregarCreados(actuales: string[], nuevos: string[]) {
  const distintos = [...new Set(nuevos)].filter((id) => !actuales.includes(id))
  return [...distintos.reverse(), ...actuales]
}

export async function resolverCreados<T>(ids: string[], consultar: (id: string) => Promise<T>) {
  const registros = await Promise.all(ids.map(async (id) => {
    try { return { id, dato: await consultar(id) } }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) return { id, dato: null }
      throw e
    }
  }))
  return {
    datos: registros.flatMap((r) => r.dato === null ? [] : [r.dato]),
    eliminados: registros.filter((r) => r.dato === null).map((r) => r.id),
  }
}

export function useCreados(base: "mongo" | "cassandra" | "neo4j") {
  const clave = `wikipipe:crud-creados:${base}`
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const valor: unknown = JSON.parse(sessionStorage.getItem(clave) ?? "[]")
      return Array.isArray(valor) ? [...new Set(valor.filter((id): id is string => typeof id === "string"))] : []
    } catch { return [] }
  })
  useEffect(() => {
    try { sessionStorage.setItem(clave, JSON.stringify(ids)) } catch { /* el historial sigue disponible en memoria */ }
  }, [clave, ids])
  const agregar = (...nuevos: string[]) => setIds((anteriores) => agregarCreados(anteriores, nuevos))
  const quitar = (...borrados: string[]) => setIds((anteriores) => anteriores.filter((id) => !borrados.includes(id)))
  async function cargar<T>(consultar: (id: string) => Promise<T>) {
    const { datos, eliminados } = await resolverCreados(ids, consultar)
    if (eliminados.length) quitar(...eliminados)
    return datos
  }
  return { agregar, quitar, cargar }
}
