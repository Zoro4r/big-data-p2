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

# Swap de 4 GB como respaldo: sin swap, un pico de memoria (corrida horaria, arranque de las bases)
# congela la VM entera. Con swappiness bajo solo se usa en esos picos.
if ! swapon --show | grep -q /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10

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

# 6. Despliegue continuo: cada minuto se compara main en GitHub con lo desplegado (infra/autodeploy.sh).
#    El repo es privado: la VM genera su propia deploy key de solo lectura (su parte pública se
#    registra una vez en GitHub › Settings › Deploy keys; la privada no sale de la VM).
command -v git >/dev/null && command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq git rsync; }
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/wikipipe_deploy ] || ssh-keygen -q -t ed25519 -N "" -C "wikipipe-vm deploy key" -f /root/.ssh/wikipipe_deploy
install -m 755 "$APP/infra/autodeploy.sh" /usr/local/bin/wikipipe-autodeploy
# El código recién extraído viene del bucket (deploy.sh): se olvida el commit registrado para que
# el timer vuelva a dejar la VM en la última versión de main.
rm -f "$APP/.deployed-sha"
cat > /etc/systemd/system/wikipipe-autodeploy.service <<'EOF'
[Unit]
Description=Despliegue continuo de wikipipe desde main
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/wikipipe-autodeploy
EOF
cat > /etc/systemd/system/wikipipe-autodeploy.timer <<'EOF'
[Unit]
Description=Revisa main en GitHub cada minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now wikipipe-autodeploy.timer

# 7. Respaldo de los datos crudos en Cloud Storage cada 30 minutos (data lake).
cat > /etc/cron.d/wikipipe-backup <<EOF
*/30 * * * * root gcloud storage rsync --recursive $APP/data/raw gs://$BUCKET/raw >> /var/log/wikipipe-backup.log 2>&1
EOF
