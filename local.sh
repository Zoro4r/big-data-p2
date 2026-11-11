#!/usr/bin/env bash
# Levanta todo el proyecto en tu computadora con Docker Compose (sin Google Cloud).
#
#   ./local.sh            levanta o actualiza todo y procesa la última hora
#   ./local.sh estado     muestra los contenedores y las direcciones
#   ./local.sh detener    apaga los contenedores (los datos se conservan)
#   ./local.sh borrar     apaga y borra contenedores, volúmenes y datos (empezar de cero)
#
# La guía completa está en docs/local.md.
set -euo pipefail
cd "$(dirname "$0")"

accion="${1:-iniciar}"

# ---------------------------------------------------------------- comprobaciones
command -v docker >/dev/null || { echo "Falta Docker. Instala Docker Desktop: https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker no está corriendo: abre Docker Desktop, espera a que diga 'running' y vuelve a intentar."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta 'docker compose' (viene con Docker Desktop; en Linux instala el plugin docker-compose)."; exit 1; }

# Valor de una variable del .env (vacío si no está).
valor_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

direcciones() {
  cat <<EOF

==> Direcciones (en tu navegador)
    Dashboard        : http://localhost:8501   $( [[ -n "$(valor_env DASHBOARD_PASSWORD)" ]] && echo "contraseña: $(valor_env DASHBOARD_PASSWORD)" || echo "(sin contraseña)")
    Airflow          : http://localhost:8080   usuario: $(valor_env AIRFLOW_ADMIN_USER)  contraseña: $(valor_env AIRFLOW_ADMIN_PASSWORD)
    Neo4j Browser    : http://localhost:7474   usuario: neo4j  contraseña: $(valor_env NEO4J_PASSWORD)
    API (docs)       : http://localhost:8501/api/docs
    MongoDB          : mongodb://localhost:27017  usuario: $(valor_env MONGO_USER)  contraseña: $(valor_env MONGO_PASSWORD)
    Cassandra        : localhost:9042 (sin contraseña)
EOF
}

case "$accion" in
  detener)
    docker compose stop
    echo "==> Contenedores detenidos. Los datos se conservan; vuelve a levantarlos con ./local.sh"
    exit 0 ;;
  estado)
    docker compose ps
    direcciones
    exit 0 ;;
  borrar)
    if [[ "${2:-}" != "--si" ]]; then
      read -r -p "Esto borra TODOS los datos locales (bases y archivos de data/). Escribe 'si' para seguir: " r
      [[ "$r" == "si" ]] || { echo "Cancelado."; exit 0; }
    fi
    docker compose down -v --remove-orphans
    # data/ puede tener archivos del usuario de Airflow: se borran desde un contenedor para evitar problemas de permisos.
    if [[ -d data ]]; then
      docker run --rm -v "$PWD/data:/data" alpine sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null || true'
      rmdir data 2>/dev/null || true
    fi
    echo "==> Todo borrado. El .env se conserva; para empezar de cero ejecuta ./local.sh"
    exit 0 ;;
  iniciar) ;;
  *) echo "Uso: ./local.sh [iniciar|estado|detener|borrar]"; exit 1 ;;
esac

# ---------------------------------------------------------------- 1. archivo .env
aleatoria() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true; }
if [[ ! -f .env ]]; then
  echo "==> Creando .env a partir de .env.example, con contraseñas generadas"
  cp .env.example .env
  for clave in MONGO_PASSWORD NEO4J_PASSWORD AIRFLOW_ADMIN_PASSWORD AIRFLOW_DB_PASSWORD; do
    nueva="$(aleatoria)"
    sed -i.bak "s|^$clave=.*|$clave=$nueva|" .env
  done
  # En Linux, Airflow tiene que escribir en data/ con tu usuario; en Mac y Windows Docker Desktop lo resuelve solo.
  if [[ "$(uname -s)" == "Linux" ]]; then
    sed -i.bak "s|^AIRFLOW_UID=.*|AIRFLOW_UID=$(id -u)|" .env
  fi
  rm -f .env.bak
elif grep -q "=cambiar-" .env; then
  echo "AVISO: tu .env todavía tiene contraseñas de ejemplo (cambiar-…). Funciona, pero conviene cambiarlas."
fi
if grep -q "tu-correo@ejemplo.com" .env; then
  echo "AVISO: pon tu correo en WIKI_USER_AGENT dentro de .env (Wikimedia pide un contacto). Funciona igual."
fi

# ---------------------------------------------------------------- 2. memoria disponible para Docker
memoria=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
if (( memoria > 0 && memoria < 3900000000 )); then
  echo "AVISO: Docker tiene $((memoria / 1000000)) MB de RAM. El proyecto necesita al menos 4 GB (mejor 6 GB):"
  echo "       súbela en Docker Desktop > Settings > Resources > Memory."
fi

# ---------------------------------------------------------------- 3. levantar
mkdir -p data
echo "==> Construyendo y levantando los contenedores (la primera vez tarda 5–10 minutos)"
docker compose up -d --build

# ---------------------------------------------------------------- 4. esperar a que respondan
espera() {  # espera <nombre> <url> <segundos>
  local nombre="$1" url="$2" limite="$3" t=0
  printf "==> Esperando a %s" "$nombre"
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    sleep 5; t=$((t + 5)); printf "."
    if (( t >= limite )); then
      echo " no respondió en $((limite / 60)) min. Revisa: docker compose logs --tail 50"; return 1
    fi
  done
  echo " listo"
}
espera "el dashboard" http://localhost:8501/api/health 600
espera "Airflow" http://localhost:8080/health 600

# ---------------------------------------------------------------- 5. activar el DAG
# Al activarlo, Airflow procesa enseguida la última hora completa (catchup=False), así hay KPIs y grafo en unos minutos.
if docker compose exec -T airflow airflow dags list-runs -d wikipedia_recent_changes -o plain 2>/dev/null | grep -q "wikipedia_recent_changes"; then
  echo "==> El DAG ya tiene corridas: se deja como está."
else
  docker compose exec -T airflow airflow dags unpause wikipedia_recent_changes >/dev/null
  echo "==> DAG activado: en ~3–5 minutos procesa la última hora completa (síguelo en Airflow)."
fi

direcciones
cat <<EOF

    El servicio stream ya está guardando eventos: la página «En vivo» se llena en segundos.
    Los KPIs, el grafo y la actividad por hora aparecen cuando el DAG termina su primera hora.
    Apagar: ./local.sh detener   ·   Empezar de cero: ./local.sh borrar   ·   Guía: docs/local.md
EOF
