import type { ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { Activity, ChartLine, Database, LayoutDashboard, Search, Share2 } from "lucide-react"

import { cn } from "@/lib/utils"

const PANEL = [
  { to: "/", label: "Resumen y KPIs", icon: LayoutDashboard },
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
          isActive ? "bg-zinc-100 font-medium text-zinc-950" : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-950",
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </NavLink>
  )
}

export function Sidebar({ ultimaHora }: { ultimaHora?: string }) {
  return (
    <aside className="flex w-full flex-col gap-6 border-b bg-sidebar px-3.5 py-5 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
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
        <span className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">Administración</span>
        <Enlace to="/crud" label="Operaciones CRUD" icon={Database} />
      </nav>
      <div className="mt-auto hidden flex-col gap-1.5 rounded-xl border bg-white p-3.5 md:flex">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-green-600" />
          </span>
          Pipeline activo
        </div>
        <span className="text-xs text-muted-foreground">DAG horario · última hora {ultimaHora ?? "—"} UTC</span>
        <span className="text-xs text-muted-foreground">MongoDB · Cassandra · Neo4j</span>
      </div>
    </aside>
  )
}

export function Header({ ruta, children }: { ruta: [string, string]; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3.5 md:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{ruta[0]}</span>
        <span aria-hidden>/</span>
        <span className="font-medium text-foreground">{ruta[1]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  )
}

export function Pagina({ titulo, descripcion, children }: { titulo: string; descripcion: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 pt-7 pb-12 md:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-tight">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </div>
      {children}
    </div>
  )
}
