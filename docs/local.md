# Levantar el proyecto en tu computadora (para pruebas)

> **El despliegue oficial del proyecto es el de Google Cloud**: la VM del grupo, con los datos que se presentan y el dashboard que se muestra en la exposición ([docs/despliegue.md](despliegue.md)). Esta guía es solo para que cada integrante pueda **probar en su computadora** sin afectar ese despliegue: lo que hagas en local no toca la nube.

Con esta guía corres **todo el proyecto en tu propia máquina**, sin Google Cloud y sin pagar nada:
- las tres bases (MongoDB, Cassandra y Neo4j);
- Airflow con el DAG horario;
- el servicio que lee el stream de Wikipedia;
- la API y el dashboard.

Es el mismo `docker-compose.yml` que corre en la VM de GCP, así que lo que pruebes en local se comporta igual que en el despliegue.

## 1. Requisitos

| Qué | Detalle |
| --- | --- |
| **Docker Desktop** | [Descargar](https://docs.docker.com/get-docker/). Ábrelo y espera a que diga *running* antes de seguir. |
| **Memoria para Docker** | **Recomendado: 6 GB o más.** Se cambia en Docker Desktop → *Settings* → *Resources* → *Memory*. Con 4–6 GB funciona en [modo liviano](#modo-liviano-poca-memoria), que `./local.sh` activa solo. Con menos de 4 GB no alcanza. |
| **Disco libre** | Unos 10 GB: imágenes de Docker más los datos, que crecen ~1 GB por día. |
| **Git** | Para clonar el repositorio. |
| **Puertos libres** | 8501 (dashboard), 8080 (Airflow), 7474 y 7687 (Neo4j), 27017 (MongoDB) y 9042 (Cassandra). Si otro programa usa alguno, ver [Problemas comunes](#6-problemas-comunes). |
| **Windows** | Usa **WSL 2** (recomendado) o **Git Bash** para ejecutar `./local.sh`. Docker Desktop debe usar el motor WSL 2 (viene así por defecto). |

## 2. Levantarlo (un solo comando)

```bash
git clone https://github.com/Zoro4r/big-data-p2.git
cd big-data-p2
./local.sh
```

El script [local.sh](../local.sh) hace todo esto:

1. **Crea el archivo `.env`** a partir de [.env.example](../.env.example), con contraseñas generadas al azar. En Linux también pone tu usuario en `AIRFLOW_UID`. Si Docker tiene menos de 6 GB, agrega el [modo liviano](#modo-liviano-poca-memoria).
2. Avisa si Docker tiene muy poca memoria.
3. Construye y levanta los contenedores. **La primera vez tarda 5–10 minutos**; las siguientes, segundos.
4. Espera a que el dashboard y Airflow respondan.
5. **Activa el DAG.** Al activarse, Airflow procesa enseguida la última hora completa.
6. Muestra las direcciones y contraseñas.

Al terminar verás algo así:

```
==> Direcciones (en tu navegador)
    Dashboard        : http://localhost:8501   (sin contraseña)
    Airflow          : http://localhost:8080   usuario: admin  contraseña: …
    Neo4j Browser    : http://localhost:7474   usuario: neo4j  contraseña: …
```

Las contraseñas quedan guardadas en tu `.env`. Para verlas de nuevo: `./local.sh estado`.

### Otros comandos

| Comando | Qué hace |
| --- | --- |
| `./local.sh` | Levanta o actualiza todo. Úsalo también después de un `git pull`. |
| `./local.sh estado` | Muestra los contenedores, las direcciones y las contraseñas. |
| `./local.sh detener` | Apaga los contenedores. **Los datos se conservan.** |
| `./local.sh borrar` | Apaga y **borra todo**: contenedores, volúmenes y la carpeta `data/`. Sirve para empezar de cero. Pide escribir `si`. |

## 3. Variables del archivo `.env`

`./local.sh` crea el `.env` solo, así que **no hace falta tocar nada para empezar**. Estas son todas las variables, por si quieres cambiar algo. Después de editar el `.env`, vuelve a ejecutar `./local.sh`.

El `.env` tiene contraseñas: **no lo subas al repositorio**. Ya está excluido en [.gitignore](../.gitignore).

**Conviene cambiar:**

| Variable | Para qué | Valor sugerido |
| --- | --- | --- |
| `WIKI_USER_AGENT` | Wikimedia pide que cada cliente del stream se identifique con un contacto. | `UTEC-BigData-P2/0.1 (contacto: tu-correo@…)` con **tu correo** |

**Contraseñas** (el script las genera; cámbialas solo si quieres unas que recuerdes):

| Variable | Para qué | Nota |
| --- | --- | --- |
| `MONGO_USER` / `MONGO_PASSWORD` | Usuario administrador de MongoDB | |
| `NEO4J_PASSWORD` | Contraseña de Neo4j (el usuario siempre es `neo4j`) | Mínimo 8 caracteres |
| `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD` | Usuario de la interfaz de Airflow | |
| `AIRFLOW_DB_PASSWORD` | Base de datos interna de Airflow (Postgres) | No la usas directamente |

**Cambiar solo si hace falta:**

| Variable | Valor por defecto | Cuándo cambiarla |
| --- | --- | --- |
| `WIKIS` | `enwiki,eswiki` | Para procesar otras wikis (por ejemplo, `frwiki`). Separadas por coma. |
| `AIRFLOW_UID` | `50000` | **Solo en Linux**: tu UID (comando `id -u`), para que Airflow pueda escribir en `data/`. El script lo pone solo al crear el `.env`. |
| `DASHBOARD_PASSWORD` | vacía (sin contraseña) | Si quieres que el dashboard pida contraseña, como en la VM. |
| `NEO4J_HEAP` / `NEO4J_PAGECACHE` | `512m` / `256m` | Memoria de Neo4j. Ver [modo liviano](#modo-liviano-poca-memoria). |
| `CASSANDRA_HEAP` / `CASSANDRA_HEAP_NEW` | `512M` / `128M` | Memoria de Cassandra. Ver [modo liviano](#modo-liviano-poca-memoria). |
| `AIRFLOW_PARALLELISM` | `4` | Cuántas tareas corre Airflow a la vez. Con poca memoria, `2`. |
| `AIRFLOW_WEB_PORT` | `8080` | Puerto de Airflow en el equipo. Por ejemplo, `18080` si el 8080 está ocupado. |
| `DAGS_PAUSED` | `true` | Con `false` el DAG arranca activo. `./local.sh` igual lo activa la primera vez. |

### Modo liviano (poca memoria)

Con todo el proyecto corriendo, Docker necesita unos 6 GB. Con menos, Docker mata a Neo4j o a Cassandra por falta de memoria y Airflow se congela: las tareas `cargar_cassandra` y `cargar_neo4j` fallan y se reintentan.

Si al crear el `.env` Docker tiene menos de 6 GB, `./local.sh` agrega al final del `.env`:

```
CASSANDRA_HEAP=384M
CASSANDRA_HEAP_NEW=96M
NEO4J_HEAP=384m
NEO4J_PAGECACHE=128m
AIRFLOW_PARALLELISM=2
```

Así las bases usan menos memoria y Airflow carga Cassandra y Neo4j de a una. Es más lento pero estable. Si después le das más memoria a Docker, borra esas líneas del `.env` y ejecuta `./local.sh`. La VM de GCP no usa el modo liviano.

Cambiar las contraseñas de las bases **después** de haberlas levantado no cambia la contraseña ya guardada en ellas. En ese caso ejecuta `./local.sh borrar` y luego `./local.sh`.

## 4. Qué ver y en qué orden

| Qué | Dónde | Cuándo tiene datos |
| --- | --- | --- |
| **Dashboard**, página «En vivo» | http://localhost:8501/vivo | En segundos: el servicio stream guarda eventos desde que arranca. |
| **Airflow** | http://localhost:8080 | El DAG `wikipedia_recent_changes` aparece activo; su primera corrida termina en ~3–5 min. En *Grid* ves cada tarea y sus logs. |
| **Dashboard**, «Resumen y KPIs», «Actividad» y «Red de editores» | http://localhost:8501 | Cuando el DAG termina su primera hora. Después se actualizan cada hora. |
| **Arquitectura** | http://localhost:8501/arquitectura | Explica el flujo y los datos; las cifras crecen con el tiempo. |
| **Neo4j Browser** | http://localhost:7474 | Después de la primera corrida del DAG. Prueba: `MATCH (e:Editor)-[r:REVIRTIO]->(o) RETURN e, r, o LIMIT 25` |

Tu entorno **empieza sin datos**: no trae los ~2.6 millones de eventos de la VM del grupo. Junta unos 18 mil eventos por hora, así que los 50 mil que pide el proyecto se juntan en unas 3 horas. Si quieres más datos de una vez, procesa horas pasadas, como se explica abajo.

## 5. Hacer pruebas

**Procesar una hora concreta** (Wikimedia guarda el stream unos días hacia atrás):

```bash
docker compose exec airflow airflow dags trigger wikipedia_recent_changes -e 2026-11-09T15:00:00+00:00
```

**Procesar varias horas seguidas** (backfill), por ejemplo las de una mañana:

```bash
docker compose exec airflow airflow dags backfill wikipedia_recent_changes -s 2026-11-09T08:00:00+00:00 -e 2026-11-09T12:00:00+00:00
```

Volver a procesar una hora es seguro: las cargas no duplican datos.

**Ver las corridas y sus tareas desde la terminal:**

```bash
docker compose exec airflow airflow dags list-runs -d wikipedia_recent_changes | head
docker compose exec airflow airflow tasks states-for-dag-run wikipedia_recent_changes "<run_id de la lista anterior>"
```

**Operaciones CRUD:** en http://localhost:8501/crud se crean, consultan, actualizan y eliminan datos en las tres bases.
- En Cassandra y Neo4j solo se puede escribir sobre nombres que empiezan con **«Demo_»**, para no alterar los datos que alimentan los KPIs. Consultar sí funciona con cualquier editor.
- Al terminar, borra lo que creaste.

**Demo del CRUD por consola** (crea y borra sus propios datos):

```bash
docker compose exec airflow python -m wikipipe.crud todo
```

**Ver los logs de un servicio:**

```bash
docker compose logs -f --tail 50 airflow    # o: stream, api, mongo, cassandra, neo4j
```

## 6. Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| `Docker no está corriendo` | Abre Docker Desktop y espera a que diga *running*. |
| `port is already allocated` al levantar | Otro programa usa ese puerto. Ciérralo, o detén el otro proyecto de Docker con `docker compose stop` en su carpeta. |
| Cassandra o Neo4j se reinician solos, `exited (137)`, o `cargar_cassandra` / `cargar_neo4j` quedan en *up_for_retry* | Falta memoria. Sube la RAM de Docker a 6 GB, o usa el [modo liviano](#modo-liviano-poca-memoria). Cierra también otros contenedores que no sean del proyecto (`docker ps` los lista). |
| `./local.sh` dice que Airflow no respondió en 10 min | La primera vez puede tardar más en máquinas lentas. Mira `docker compose logs --tail 50 airflow` y vuelve a ejecutar `./local.sh`. |
| El DAG falla en `extraer` con `Permission denied` (Linux) | `AIRFLOW_UID` no es tu usuario. Pon `AIRFLOW_UID=$(id -u)` en el `.env` y ejecuta `./local.sh`. |
| El DAG falla en `extraer` por tiempo o conexión | Wikimedia cortó el stream un momento. Airflow reintenta solo 2 veces; si sigue fallando, revisa tu conexión a internet. |
| El dashboard muestra KPIs vacíos | El DAG todavía no terminó su primera hora. Míralo en Airflow → *Grid*. |
| `bash: ./local.sh: Permission denied` | Ejecuta `chmod +x local.sh` o usa `bash local.sh`. |
| En Windows: `/usr/bin/env: 'bash\r'` | El archivo se guardó con finales de línea de Windows. Ejecuta `git config core.autocrlf false`, borra la carpeta y clona de nuevo. |
| Quiero empezar de cero | `./local.sh borrar` y luego `./local.sh`. |

## 7. Diferencias con el despliegue en GCP

| | Local (pruebas) | VM de GCP: el despliegue oficial ([despliegue.md](despliegue.md)) |
| --- | --- | --- |
| Costo | Gratis | Créditos de GCP |
| Contraseña del dashboard | No (opcional) | Sí |
| DAG al arrancar | `./local.sh` lo activa | Activo |
| Respaldo de datos crudos | No | Cloud Storage cada 30 min |
| Acceso | Solo tu computadora | Desde las IP permitidas |
| Datos | Empiezan de cero | Los del grupo |

El código es el mismo. Para actualizar tu copia: `git pull` y luego `./local.sh`.

## Pruebas de las correcciones

La rama `dev-ian` se verifica con una muestra sintética y pruebas de regresión contra las tres bases. Consulta [el procedimiento y la reconstrucción del modelo 2](correcciones-dev-ian.md).
