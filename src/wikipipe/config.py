"""Configuración leída de variables de entorno, con valores por defecto para desarrollo local."""

import os
from pathlib import Path

STREAM_URL = os.getenv("WIKI_STREAM_URL", "https://stream.wikimedia.org/v2/stream/recentchange")

# Wikimedia pide un User-Agent que identifique al cliente y un contacto.
USER_AGENT = os.getenv("WIKI_USER_AGENT", "UTEC-BigData-P2/0.1 (proyecto academico)")

# Wikis que procesamos (separadas por coma).
WIKIS = frozenset(w.strip() for w in os.getenv("WIKIS", "enwiki,eswiki").split(",") if w.strip())

# Carpeta raíz de los datos: raw/ (extraídos), clean/ (válidos) y rejected/ (descartados).
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parents[2] / "data"))

# Segundos que se sigue leyendo después del fin de la ventana. El stream mezcla dos
# datacenters (eqiad y codfw), así que los eventos no llegan en orden estricto.
STREAM_GRACE_SECONDS = int(os.getenv("STREAM_GRACE_SECONDS", "120"))
