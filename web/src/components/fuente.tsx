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

/** Separa "Cassandra · resumen_por_hora" en base y detalle. Los patrones Cypher se asignan a Neo4j. */
function separar(texto: string): { base: Base | null; resto: string } {
  const prefijos: [string, Base][] = [["MongoDB", "mongo"], ["Cassandra", "cassandra"], ["Neo4j", "neo4j"], ["Limpieza", "airflow"]]
  for (const [p, base] of prefijos) {
    if (texto.startsWith(p)) {
      const resto = texto.slice(p.length).replace(/^\s*·\s*/, "")
      return { base, resto: base === "airflow" ? `limpieza${resto ? ` · ${resto}` : ""}` : resto }
    }
  }
  if (texto.startsWith("-[") || texto.startsWith("(:")) return { base: "neo4j", resto: texto }
  return { base: null, resto: texto }
}

/** Fuente de un dato: logo de la base + tabla, colección o patrón. El nombre completo queda en el tooltip. */
export function Fuente({ texto, base, className }: { texto: string; base?: Base; className?: string }) {
  const s = separar(texto)
  const b = base ?? s.base
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={b ? `${BASES[b].nombre} · ${s.resto}` : texto}>
      {b && <LogoBase base={b} />}
      {b && <span className="sr-only">{BASES[b].nombre}:</span>}
      <span>{s.resto}</span>
    </span>
  )
}
