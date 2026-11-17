#!/bin/bash
# Despliegue continuo en la VM. Un timer de systemd lo ejecuta cada minuto (lo instala startup.sh).
# Si main en GitHub tiene un commit nuevo:
#   1. compila las imágenes en una carpeta aparte (si falla, sigue la versión anterior),
#   2. sincroniza el código en /opt/wikipipe sin tocar .env ni data/,
#   3. recrea los contenedores cuya imagen cambió y reinicia api y stream (leen el código montado).
# Airflow lee src/ y dags/ montados, así que toma el código nuevo en su siguiente tarea.
# El repo es privado: se lee con una deploy key de solo lectura que vive solo en la VM.
set -euo pipefail

APP=/opt/wikipipe
SRC=/opt/wikipipe-src
REPO=git@github.com:Zoro4r/big-data-p2.git
KEY=/root/.ssh/wikipipe_deploy
LOG=/var/log/wikipipe-autodeploy.log
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

# Una sola ejecución a la vez (una compilación puede durar más de un minuto).
exec 9>/run/wikipipe-autodeploy.lock
flock -n 9 || exit 0

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

if [ ! -d "$SRC/.git" ]; then
  git clone -q --branch main "$REPO" "$SRC" 2>> "$LOG" || { log "no se pudo clonar: falta registrar la deploy key"; exit 1; }
fi
git -C "$SRC" fetch -q origin main 2>> "$LOG" || { log "no se pudo leer main en GitHub"; exit 1; }

NEW=$(git -C "$SRC" rev-parse origin/main)
OLD=$(cat "$APP/.deployed-sha" 2>/dev/null || true)
[ "$NEW" = "$OLD" ] && exit 0

log "commit nuevo en main: $NEW (desplegado: ${OLD:-ninguno})"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git -C "$SRC" archive "$NEW" | tar -x -C "$STAGE"
cp "$APP/.env" "$STAGE/.env"

# Compilar antes de tocar lo desplegado; el nombre de proyecto es el mismo, así que las imágenes quedan listas.
if ! (cd "$STAGE" && docker compose -p wikipipe build >> "$LOG" 2>&1); then
  log "la compilación falló; se mantiene ${OLD:-la versión actual}"
  exit 1
fi

rsync -a --delete --exclude .env --exclude /data/ --exclude .deployed-sha "$STAGE"/ "$APP"/
cd "$APP"
docker compose up -d --remove-orphans >> "$LOG" 2>&1
docker compose restart api stream >> "$LOG" 2>&1
echo "$NEW" > "$APP/.deployed-sha"
log "desplegado $NEW"
