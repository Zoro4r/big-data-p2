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
