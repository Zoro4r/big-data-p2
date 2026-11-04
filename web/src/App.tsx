import { lazy, Suspense, useEffect, useState, type FormEvent } from "react"
import { Route, Routes } from "react-router-dom"
import { Activity } from "lucide-react"

import { Sidebar } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, useApi } from "@/lib/api"
import { horaUTC } from "@/lib/format"

// Cada página se descarga solo cuando se abre (el grafo y los gráficos pesan).
const Resumen = lazy(() => import("@/pages/Resumen"))
const Vivo = lazy(() => import("@/pages/Vivo"))
const Actividad = lazy(() => import("@/pages/Actividad"))
const Explorador = lazy(() => import("@/pages/Explorador"))
const Red = lazy(() => import("@/pages/Red"))
const Crud = lazy(() => import("@/pages/Crud"))

function Login({ onOk }: { onOk: () => void }) {
  const [clave, setClave] = useState("")
  const [error, setError] = useState<string | null>(null)
  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password: clave }) })
      onOk()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-zinc-900 text-white"><Activity className="size-5" aria-hidden /></div>
          <CardTitle className="text-xl">Wikipedia en vivo</CardTitle>
          <CardDescription>Dashboard del Proyecto Grupal II de Big Data. Ingresa la contraseña del equipo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar} className="flex flex-col gap-3">
            <Label htmlFor="clave">Contraseña</Label>
            <Input id="clave" type="password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} aria-invalid={Boolean(error)} />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <Button type="submit" className="mt-1">Entrar</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

interface Sesion { requiere_clave: boolean; autenticado: boolean }
interface UltimaHora { kpis: { eventos_procesados: { ventana: string }[] } }

function Dashboard() {
  const { data } = useApi<UltimaHora>("/api/resumen")
  const ultima = data?.kpis.eventos_procesados[0]?.ventana
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar ultimaHora={ultima ? horaUTC(ultima, false) : undefined} />
      <main className="min-w-0 flex-1">
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Resumen />} />
          <Route path="/vivo" element={<Vivo />} />
          <Route path="/actividad" element={<Actividad />} />
          <Route path="/explorador" element={<Explorador />} />
          <Route path="/red" element={<Red />} />
          <Route path="/crud" element={<Crud />} />
          <Route path="*" element={<Resumen />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const revisar = () => api<Sesion>("/api/session").then(setSesion).catch(() => setSesion({ requiere_clave: true, autenticado: false }))

  useEffect(() => {
    revisar()
    const salir = () => setSesion((s) => (s ? { ...s, autenticado: false } : s))
    window.addEventListener("wp:no-autenticado", salir)
    return () => window.removeEventListener("wp:no-autenticado", salir)
  }, [])

  if (!sesion) return null
  if (!sesion.autenticado) return <Login onOk={revisar} />
  return <Dashboard />
}
