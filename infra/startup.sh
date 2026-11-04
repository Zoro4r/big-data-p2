#!/bin/bash
# Startup script de la VM. GCP lo ejecuta como root en cada arranque, y deploy.sh lo vuelve a
# ejecutar después de subir una versión nueva del código. Es idempotente.
# Plantilla de Terraform: $${...} es una variable de bash; ${bucket} la reemplaza Terraform.
set -euxo pipefail

APP=/opt/wikipipe
BUCKET="${bucket}"
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes

# 1. Docker (solo la primera vez).
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Cassandra recomienda más áreas de memoria mapeada que el valor por defecto.
sysctl -w vm.max_map_count=1048575

# 2. Código: se descarga la versión subida por deploy.sh.
mkdir -p "$APP"
gcloud storage cp "gs://$BUCKET/code/app.tar.gz" /tmp/app.tar.gz
tar -xzf /tmp/app.tar.gz -C "$APP"

# 3. Variables y contraseñas: vienen de los metadatos de la VM (las genera Terraform).
curl -fsS -H "Metadata-Flavor: Google" "$META/wikipipe-env" > "$APP/.env"
chmod 600 "$APP/.env"

# 4. Carpeta de datos con permisos para el usuario de Airflow (UID 50000).
mkdir -p "$APP/data"
chown -R 50000:0 "$APP/data"

# 5. Levantar todo.
cd "$APP"
docker compose up -d --build --remove-orphans
# La API y el streaming leen el código montado (src/, api/): se reinician para que tomen la versión
# nueva aunque su configuración no haya cambiado. Airflow lee el código en cada tarea, no hace falta.
docker compose restart api stream

# 6. Respaldo de los datos crudos en Cloud Storage cada 30 minutos (data lake).
cat > /etc/cron.d/wikipipe-backup <<EOF
*/30 * * * * root gcloud storage rsync --recursive $APP/data/raw gs://$BUCKET/raw >> /var/log/wikipipe-backup.log 2>&1
EOF
