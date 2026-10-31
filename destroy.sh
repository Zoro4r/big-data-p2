#!/usr/bin/env bash
# Borra toda la infraestructura del proyecto en GCP (VM, disco, IP, bucket con sus datos, firewall).
# Úsalo al terminar el curso para no gastar créditos. No borra el proyecto de GCP.
#
#   export PROJECT_ID=big-data-p2-<tu-nombre>
#   ./destroy.sh
set -euo pipefail

cd "$(dirname "$0")"
: "${PROJECT_ID:?Define PROJECT_ID}"

read -r -p "Se borrará la VM y TODOS los datos del proyecto $PROJECT_ID. Escribe el ID del proyecto para confirmar: " CONFIRM
[[ "$CONFIRM" == "$PROJECT_ID" ]] || { echo "Cancelado."; exit 1; }

terraform -chdir=infra destroy -auto-approve \
  -var "project_id=$PROJECT_ID" -var 'allowed_cidrs=["127.0.0.1/32"]' -var "code_archive=/dev/null"
