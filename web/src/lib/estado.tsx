import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { api } from "@/lib/api"

export interface Estado {
  ultima_hora: string | null
  stream_ultimo_evento: string | null
}

export type Wiki = "ambas" | "enwiki" | "eswiki"

interface Contexto {
  estado: Estado | null
  wiki: Wiki
  setWiki: (w: Wiki) => void
}

const Ctx = createContext<Contexto>({ estado: null, wiki: "ambas", setWiki: () => {} })
const CLAVE = "wp-wiki"

function wikiGuardada(): Wiki {
  try {
    const v = localStorage.getItem(CLAVE)
    return v === "enwiki" || v === "eswiki" || v === "ambas" ? v : "ambas"
  } catch {
    return "ambas"
  }
}

/** Estado del pipeline y filtro global de wiki, compartidos por todas las vistas del dashboard. */
export function EstadoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [wiki, setWikiState] = useState<Wiki>(wikiGuardada)

  useEffect(() => {
    let vigente = true
    const cargar = () => api<Estado>("/api/estado").then((e) => vigente && setEstado(e)).catch(() => {})
    cargar()
    const t = setInterval(cargar, 10000)
    return () => { vigente = false; clearInterval(t) }
  }, [])

  const setWiki = (w: Wiki) => {
    setWikiState(w)
    try { localStorage.setItem(CLAVE, w) } catch { /* sin almacenamiento: solo vale para esta sesión */ }
  }

  return <Ctx.Provider value={{ estado, wiki, setWiki }}>{children}</Ctx.Provider>
}

export const useEstado = () => useContext(Ctx).estado
export const useWiki = () => {
  const { wiki, setWiki } = useContext(Ctx)
  return { wiki, setWiki, wikis: wiki === "ambas" ? ["enwiki", "eswiki"] : [wiki], etiqueta: wiki === "ambas" ? "enwiki y eswiki" : wiki }
}
