import { Fragment } from "react"
import { siApacheairflow, siApachecassandra, siMongodb, siNeo4j, type SimpleIcon } from "simple-icons"

import { cn } from "@/lib/utils"

export type Base = "mongo" | "cassandra" | "neo4j" | "airflow"

const BASES: Record<Base, { icono: SimpleIcon; nombre: string }> = {
  mongo: { icono: siMongodb, nombre: "MongoDB" },
  cassandra: { icono: siApachecassandra, nombre: "Cassandra" },
  neo4j: { icono: siNeo4j, nombre: "Neo4j" },
  airflow: { icono: siApacheairflow, nombre: "Airflow" },
}

/** Logo de la base (Simple Icons, CC0) con su color de marca. */
export function LogoBase({ base, className }: { base: Base; className?: string }) {
  const { icono } = BASES[base]
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} fill={`#${icono.hex}`} aria-hidden>
      <path d={icono.path} />
    </svg>
  )
}

/** Base donde se calcula un KPI según su campo `fuente` ("MongoDB · events", "Limpieza · DAG"…). */
export function baseDeCalculo(fuente: string): Base {
  if (fuente.startsWith("MongoDB")) return "mongo"
  if (fuente.startsWith("Neo4j")) return "neo4j"
  if (fuente.startsWith("Limpieza")) return "airflow"
  return "cassandra"
}

/** Recorrido de un KPI: dónde se calcula → Cassandra, donde se guarda (una sola base si coinciden). */
export function rutaKpi(fuente: string): Base[] {
  const calculo = baseDeCalculo(fuente)
  return calculo === "cassandra" ? ["cassandra"] : [calculo, "cassandra"]
}

/** Recorrido del dato con logos: "MongoDB → Cassandra" (calcula → guarda) o una sola base. */
export function Ruta({ bases, className }: { bases: Base[]; className?: string }) {
  const nombres = bases.map((b) => BASES[b].nombre)
  const titulo = bases.length > 1 ? `Se calcula en ${nombres[0]} y se guarda en ${nombres.at(-1)}` : `Se lee de ${nombres[0]}`
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)} title={titulo}>
      <span className="sr-only">{titulo}</span>
      {bases.map((b, i) => (
        <Fragment key={b}>
          {i > 0 && <span className="text-muted-foreground/60" aria-hidden>→</span>}
          <span className="inline-flex items-center gap-1.5" aria-hidden><LogoBase base={b} />{BASES[b].nombre}</span>
        </Fragment>
      ))}
    </span>
  )
}
