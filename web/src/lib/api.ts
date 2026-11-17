import { useCallback, useEffect, useState } from "react"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Llama a la API (mismo origen). Lanza ApiError con el mensaje que devuelve FastAPI. */
export async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const res = await fetch(ruta, {
    credentials: "same-origin",
    headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
    ...opciones,
  })
  if (!res.ok) {
    let mensaje = res.statusText
    try {
      const cuerpo = await res.json()
      mensaje = typeof cuerpo.detail === "string" ? cuerpo.detail : JSON.stringify(cuerpo.detail)
    } catch {
      /* sin cuerpo JSON */
    }
    if (res.status === 401) window.dispatchEvent(new Event("wp:no-autenticado"))
    throw new ApiError(res.status, mensaje)
  }
  return res.json() as Promise<T>
}

/** Carga datos de la API y los vuelve a pedir cuando cambia la ruta. */
export function useApi<T>(ruta: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(Boolean(ruta))
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setData(null)
    if (!ruta) { setCargando(false); return }
    let vigente = true
    setCargando(true)
    setError(null)
    api<T>(ruta)
      .then((d) => vigente && setData(d))
      .catch((e: Error) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [ruta, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])
  return { data, error, cargando, recargar }
}
