variable "project_id" {
  description = "ID del proyecto de GCP (único en todo GCP; cada integrante usa el suyo)."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "machine_type" {
  description = "e2-standard-2 = 2 vCPU y 8 GB de RAM (~1.6 USD por día)."
  type        = string
  default     = "e2-standard-2"
}

variable "disk_size_gb" {
  type    = number
  default = 50
}

variable "allowed_cidrs" {
  description = "IPs que pueden abrir Airflow, Neo4j y el dashboard (por defecto, la IP de quien despliega)."
  type        = list(string)
}

variable "dashboard_cidrs" {
  description = "IPs que pueden abrir el dashboard. Por defecto cualquiera, para compartirlo con el equipo."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "code_archive" {
  description = "Ruta local del .tar.gz con el código (lo genera deploy.sh)."
  type        = string
}

variable "neo4j_heap" {
  description = "Memoria heap de Neo4j en la VM (cargas por lotes y consultas)."
  type        = string
  default     = "1g"
}

variable "neo4j_pagecache" {
  description = "Caché de páginas de Neo4j en la VM: cuánto del grafo se mantiene en memoria."
  type        = string
  default     = "1g"
}

variable "wikis" {
  type    = string
  default = "enwiki,eswiki"
}

variable "wiki_user_agent" {
  description = "User-Agent que se envía a Wikimedia (su política pide un contacto)."
  type        = string
  default     = "UTEC-BigData-P2/0.1 (proyecto academico)"
}
