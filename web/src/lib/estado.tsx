import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { api } from "@/lib/api"

export interface Estado {
  ultima_hora: string | null
  stream_ultimo_evento: string | null
}

const Contexto = createContext<Estado | null>(null)

/** Estado de las dos capas del pipeline, compartido por la cabecera de todas las vistas. */
export function EstadoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  useEffect(() => {
    let vigente = true
    const cargar = () => api<Estado>("/api/estado").then((e) => vigente && setEstado(e)).catch(() => {})
    cargar()
    const t = setInterval(cargar, 10000)
    return () => { vigente = false; clearInterval(t) }
  }, [])
  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>
}

export const useEstado = () => useContext(Contexto)
