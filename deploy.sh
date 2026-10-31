#!/usr/bin/env bash
# Despliega todo el proyecto en GCP con un solo comando.
#
#   export PROJECT_ID=big-data-p2-<tu-nombre>   # proyecto de GCP con facturación activa
#   ./deploy.sh
#
# Qué hace:
#   1. Empaqueta el código commiteado del repo (git archive).
#   2. Terraform crea o actualiza: APIs, bucket, cuenta de servicio, IP fija, firewall y la VM.
#   3. La VM instala Docker, descarga el código y levanta el docker-compose (startup script).
#   4. Si la VM ya existía, vuelve a ejecutar el startup script para aplicar el código nuevo.
#
# Variables opcionales: REGION, ZONE, MACHINE_TYPE, ALLOWED_CIDR (por defecto, tu IP pública /32).
set -euo pipefail

cd "$(dirname "$0")"
: "${PROJECT_ID:?Define PROJECT_ID, por ejemplo: export PROJECT_ID=big-data-p2-juan}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"

for cmd in gcloud terraform git curl; do
  command -v "$cmd" >/dev/null || { echo "Falta instalar: $cmd"; exit 1; }
done
gcloud auth application-default print-access-token >/dev/null 2>&1 || {
  echo "Terraform necesita credenciales: ejecuta 'gcloud auth application-default login'"; exit 1; }

ALLOWED_CIDR="${ALLOWED_CIDR:-$(curl -fsS https://api.ipify.org)/32}"
echo "==> Proyecto: $PROJECT_ID | zona: $ZONE | máquina: $MACHINE_TYPE | acceso web desde: $ALLOWED_CIDR"

# 1. Código: solo lo commiteado, para que el despliegue sea reproducible.
if [[ -n "$(git status --porcelain -- src airflow db docker-compose.yml requirements.txt)" ]]; then
  echo "AVISO: hay cambios sin commitear en el código; se despliega el último commit."
fi
ARCHIVE="$(mktemp -d)/app.tar.gz"
git archive --format=tar.gz -o "$ARCHIVE" HEAD
echo "==> Código empaquetado: commit $(git rev-parse --short HEAD)"

# 2. Infraestructura.
TF="terraform -chdir=infra"
$TF init -input=false -upgrade >/dev/null
VM_EXISTED=$($TF state list 2>/dev/null | grep -c '^google_compute_instance.vm$' || true)
$TF apply -input=false -auto-approve \
  -var "project_id=$PROJECT_ID" -var "region=$REGION" -var "zone=$ZONE" \
  -var "machine_type=$MACHINE_TYPE" -var "allowed_cidrs=[\"$ALLOWED_CIDR\"]" \
  -var "code_archive=$ARCHIVE"

# 3. Si la VM ya existía, aplicar el código nuevo sin recrearla (los datos se conservan).
if [[ "$VM_EXISTED" == "1" ]]; then
  echo "==> Actualizando el código en la VM..."
  gcloud compute ssh wikipipe-vm --project "$PROJECT_ID" --zone "$ZONE" --tunnel-through-iap --quiet \
    --command "sudo google_metadata_script_runner startup"
fi

IP=$($TF output -raw vm_ip)
cat <<EOF

==> Despliegue listo. La primera vez la VM tarda ~5 minutos en instalar Docker y levantar todo.
    Airflow : http://$IP:8080   usuario admin / $($TF output -raw airflow_admin_password)
    Neo4j   : http://$IP:7474   usuario neo4j / $($TF output -raw neo4j_password)
    Dashboard: http://$IP:8501  contraseña $($TF output -raw dashboard_password)
    Bucket  : gs://$($TF output -raw bucket)
    Ver el arranque: gcloud compute instances get-serial-port-output wikipipe-vm --zone $ZONE --project $PROJECT_ID | grep startup-script
EOF
