import { useEffect, useState, type ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { Activity, ChartLine, Database, LayoutDashboard, Moon, Network, Radio, Search, Share2, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useEstado, useWiki, type Wiki } from "@/lib/estado"
import { horaUTC } from "@/lib/format"
import { cn } from "@/lib/utils"

const PANEL = [
  { to: "/", label: "Resumen y KPIs", icon: LayoutDashboard },
  { to: "/vivo", label: "En vivo", icon: Radio },
  { to: "/actividad", label: "Actividad en el tiempo", icon: ChartLine },
  { to: "/explorador", label: "Explorador de eventos", icon: Search },
  { to: "/red", label: "Red de editores", icon: Share2 },
]

function Enlace({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Search }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
          isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </NavLink>
  )
}

export function Sidebar() {
  const estado = useEstado()
  const ultimaHora = estado?.ultima_hora ? horaUTC(estado.ultima_hora, false) : undefined
  return (
    <aside className="flex w-full flex-col gap-6 border-b bg-sidebar px-3.5 py-5 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Activity className="size-[18px]" aria-hidden />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Wikipedia en vivo</span>
          <span className="text-xs text-muted-foreground">Big Data · Proyecto II</span>
        </div>
      </div>
      <nav aria-label="Secciones" className="flex flex-col gap-0.5">
        <span className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">Panel</span>
        {PANEL.map((e) => <Enlace key={e.to} {...e} />)}
        <span className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">Proyecto</span>
        <Enlace to="/arquitectura" label="Arquitectura" icon={Network} />
        <span className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">Administración</span>
        <Enlace to="/crud" label="Operaciones CRUD" icon={Database} />
      </nav>
      <div className="mt-auto hidden flex-col gap-1.5 rounded-xl border bg-card p-3.5 md:flex">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-green-600" />
          </span>
          Pipeline activo
        </div>
        <span className="text-xs text-muted-foreground">Streaming en vivo + DAG horario</span>
        <span className="text-xs text-muted-foreground">Última hora consolidada: {ultimaHora ?? "—"} UTC</span>
        <span className="text-xs text-muted-foreground">MongoDB · Cassandra · Neo4j</span>
      </div>
    </aside>
  )
}

function hace(iso: string, ahora: number): string {
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (seg < 60) return `hace ${seg} s`
  const min = Math.floor(seg / 60)
  return min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h`
}

/** Pastilla de estado común a todas las vistas: capa rápida (streaming) y capa por lotes (DAG). */
function EstadoPipeline() {
  const estado = useEstado()
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ultimo = estado?.stream_ultimo_evento
  const enVivo = ultimo != null && ahora - new Date(ultimo).getTime() < 120_000
  return (
    <div className="flex h-8 items-center gap-2.5 rounded-full border bg-card px-3 text-xs text-muted-foreground" title="Capa rápida: último evento guardado por el streaming · Lote: última hora consolidada por el DAG">
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          {enVivo && <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60" />}
          <span className={cn("relative inline-flex size-2 rounded-full", enVivo ? "bg-green-600" : "bg-amber-500")} />
        </span>
        <span className={cn("font-medium", enVivo ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300")}>{enVivo ? "En vivo" : "Sin datos nuevos"}</span>
        {/* Ancho fijo: "hace 9 s", "hace 10 s" o "hace 12 min" no cambian el tamaño de la pastilla */}
        <span className="inline-block w-[4.75rem] tabular-nums">{ultimo ? hace(ultimo, ahora) : "…"}</span>
      </span>
      <span className="h-3.5 w-px bg-border" aria-hidden />
      <span className="tabular-nums">Lote {estado?.ultima_hora ? horaUTC(estado.ultima_hora) : "…"} UTC</span>
    </div>
  )
}

/** Alterna claro / oscuro; la primera vez sigue la preferencia del sistema. */
function BotonTema() {
  const { resolvedTheme, setTheme } = useTheme()
  const oscuro = resolvedTheme === "dark"
  return (
    <button type="button" onClick={() => setTheme(oscuro ? "light" : "dark")} aria-label={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={oscuro ? "Modo claro" : "Modo oscuro"}
      className="flex size-8 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      {oscuro ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  )
}

/** Filtro global de wiki: el mismo en todas las vistas y recordado al navegar. */
function FiltroWiki() {
  const { wiki, setWiki } = useWiki()
  return (
    <ToggleGroup type="single" value={wiki} onValueChange={(v) => v && setWiki(v as Wiki)} variant="outline" size="sm" aria-label="Wiki">
      <ToggleGroupItem value="ambas" className="px-3">Ambas</ToggleGroupItem>
      <ToggleGroupItem value="enwiki" className="px-3">enwiki</ToggleGroupItem>
      <ToggleGroupItem value="eswiki" className="px-3">eswiki</ToggleGroupItem>
    </ToggleGroup>
  )
}

/** Cabecera estándar de todas las vistas: ruta, filtro global de wiki y estado del pipeline. */
export function Header({ ruta }: { ruta: [string, string] }) {
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-6 py-3 md:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{ruta[0]}</span>
        <span aria-hidden>/</span>
        <span className="font-medium text-foreground">{ruta[1]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FiltroWiki />
        <EstadoPipeline />
        <BotonTema />
      </div>
    </header>
  )
}

export function Pagina(props: { titulo: string; descripcion: ReactNode; aviso?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  const { titulo, descripcion, aviso, acciones, children } = props
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 pt-7 pb-12 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{descripcion}</p>
          {aviso && <p className="mt-2 w-fit rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-[13px] text-amber-900 dark:text-amber-200">{aviso}</p>}
        </div>
        {acciones && <div className="flex items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </div>
  )
}
