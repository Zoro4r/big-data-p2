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

# Carpeta con los scripts de creación de las bases (db/).
DB_DIR = Path(os.getenv("DB_DIR", Path(__file__).resolve().parents[2] / "db"))

# Conexiones a las bases.
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "wikipipe")
CASSANDRA_HOSTS = [h.strip() for h in os.getenv("CASSANDRA_HOSTS", "localhost").split(",")]
CASSANDRA_KEYSPACE = os.getenv("CASSANDRA_KEYSPACE", "wikipipe")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

# Segundos que se sigue leyendo después del fin de la ventana. El stream mezcla dos
# datacenters (eqiad y codfw), así que los eventos no llegan en orden estricto.
STREAM_GRACE_SECONDS = int(os.getenv("STREAM_GRACE_SECONDS", "120"))
