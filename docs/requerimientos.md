# Requerimientos del proyecto y cómo los cumplimos

Big Data · Proyecto Grupal II · UTEC · entrega: 17 de noviembre de 2026

Este documento recorre, sección por sección, lo que piden las instrucciones del proyecto (`Instrucciones Proyecto Grupal II.pdf`) y cómo lo resuelve nuestro trabajo. Las cifras son de la VM en GCP al 7 de noviembre de 2026, 14:08 UTC.

**Estado general:** las secciones 1 a 6 están implementadas y desplegadas. Quedan pendientes el informe en PDF (con capturas del dashboard) y el video.

| Sección | Estado |
| --- | --- |
| 1. Fuente de datos | Cumplido |
| 2. Arquitectura multimodelo | Cumplido |
| 3. Automatización con Airflow | Cumplido |
| 4. Operaciones CRUD | Cumplido (MongoDB rediseñado; Cassandra y Neo4j funcionan con la interfaz anterior) |
| 5. Dashboard analítico | Cumplido |
| 6. Indicadores (KPIs) | Cumplido (12 KPIs, el mínimo es 5) |
| Entregables | Código, scripts, DAG y dashboard listos; faltan informe PDF y video |

---

## 1. Fuente de datos

> Datos no estructurados o semiestructurados, al menos 50,000 registros, que se actualicen periódicamente, y documentar su origen, estructura y características.

- **Fuente:** el stream público **Wikipedia Recent Changes** de Wikimedia (EventStreams, `stream.wikimedia.org/v2/stream/recentchange`). Cada cambio en Wikipedia llega en tiempo real como un evento JSON.
- **Semiestructurado:** cada evento es un JSON con campos comunes y campos que dependen del tipo (`edit`, `new`, `categorize`, `log`), con objetos anidados (`meta`, `length`, `revision`, `log_params`). No todos los registros tienen la misma forma.
- **Volumen:** MongoDB guarda **2,570,895 eventos** de enwiki y eswiki, del 31 de octubre al 7 de noviembre de 2026. Es unas 50 veces el mínimo pedido.
- **Actualización periódica:** los datos llegan solos. El servicio de streaming los guarda cada ~2 segundos y el DAG procesa cada hora completa.
- **Documentación:** está en dos lugares con el mismo contenido.
  - `docs/justificacion-dataset.md`: origen, protocolo, licencia, estructura de cada tipo de evento y una captura de prueba (~37 eventos/s).
  - La página **Arquitectura** del dashboard, en el modal de Wikimedia EventStreams. Muestra el problema que planteamos, el origen completo (fuente, endpoint, SSE, esquema versionado, autenticación, datos pasados con `?since=`, licencia y documentación oficial), los campos comunes y los de cada tipo, un evento real de MongoDB, la captura de prueba del 31 de octubre con su gráfico y la tabla de cumplimiento de estos cuatro requisitos. Suma cifras en vivo: volumen, velocidad, mezcla de tipos de las últimas 24 h y calidad.

## 2. Arquitectura multimodelo

> Usar MongoDB (documentos originales), Cassandra (consultas masivas y series temporales) y Neo4j (relaciones entre entidades), y justificar por qué cada dato va en cada base.

**MongoDB: los eventos originales.**
- Colección `events`: un documento por evento, con todos sus campos originales más el bloque `derived` que agrega la limpieza (fecha, hora, tipo de editor, bytes cambiados, a quién revierte, etc.).
- Encaja con MongoDB porque cada tipo de evento tiene campos distintos y anidados. Un esquema flexible los guarda sin forzar columnas vacías.
- Un validador `$jsonSchema` exige los campos mínimos, y hay índices por fecha, por wiki y tipo, por editor y por página (`db/mongo/schema.json`).

**Cassandra: series de tiempo y agregados.**
- Siete tablas, cada una diseñada para una consulta del dashboard (`db/cassandra/schema.cql`):
  - `resumen_por_hora`: totales de cada hora por wiki.
  - `eventos_por_minuto`: serie por minuto.
  - `actividad_editor`: historial de un editor, hora por hora.
  - `paginas_top_por_hora`: páginas más editadas de cada hora.
  - `kpis` y `kpis_por_wiki`: el valor de cada KPI por hora.
  - `ejecuciones`: registro de las corridas del pipeline.
- Encaja con Cassandra porque son series temporales que se escriben sin parar y se leen por partición (un día, una wiki, un editor) con orden por tiempo.

**Neo4j: la red de colaboración.**
- **Nodos:** `Editor` (137,532), `Pagina` (734,742), `Categoria` (72,329) y `Wiki` (2).
- **Relaciones:**
  - con páginas: `EDITO`, `CREO`, `SUBIO`, `MOVIDA_A`, `PERTENECE_A` y `EN_CATEGORIA`;
  - entre editores: `REVIRTIO`, `MENSAJE_A`, `AGRADECIO`, `BLOQUEO` y `COEDITA`.
  - En total, unos 2.8 millones de relaciones.
- Encaja con Neo4j porque las preguntas son de relaciones: quién revierte a quién, qué editores comparten páginas, qué página atrae a más editores. En un grafo se responden recorriendo vecinos, sin joins costosos.
- **Restricciones de unicidad e índices:** `db/neo4j/constraints.cypher`.

**Justificación técnica:** está en tres lugares.
- `docs/justificacion-dataset.md`: qué guarda cada base y por qué.
- La página **Arquitectura** del dashboard: cada base abre un modal con qué guarda, por qué ahí y quién escribe.
  - MongoDB: además, el validador y los índices.
  - Cassandra: las 7 tablas con su clave primaria.
  - Neo4j: el esquema del grafo, de qué parte del evento sale cada relación y un ejemplo real de reversiones.
- El informe técnico.

**Arquitectura Lambda:**
- **Capa rápida:** el servicio `stream` guarda los eventos en MongoDB y los contadores por minuto en Cassandra en ~2 segundos.
- **Capa por lotes:** el DAG horario recalcula todo y corrige esos contadores.

Las dos capas usan el mismo `_id`, así que no hay duplicados.

## 3. Automatización con Apache Airflow

> Un DAG con extracción, validación y limpieza, carga en MongoDB, transformación y carga en Cassandra, construcción de relaciones y carga en Neo4j, y generación automática de indicadores, ejecutado de forma programada.

- **DAG `wikipedia_recent_changes`** (`airflow/dags/wikipedia_pipeline.py`), programado **cada hora** (`@hourly`). En la VM lleva **163 corridas** registradas.
- Sus seis tareas son exactamente las seis etapas pedidas:
  1. `extraer`: descarga del stream la hora completa (con `?since=`) y la guarda cruda en `.jsonl.gz`.
  2. `validar_y_limpiar`: descarta eventos inválidos (sin `meta`, sin campos obligatorios, tipo desconocido, fecha mal formada) y agrega los campos derivados. Los rechazados se guardan aparte con su motivo.
  3. `cargar_mongo`: inserta o reemplaza los eventos limpios en `events`.
  4. `cargar_cassandra`: agrega la hora (totales, series por minuto, actividad por editor, páginas top) y la escribe en Cassandra.
  5. `cargar_neo4j`: construye nodos y relaciones de la hora con `MERGE`.
  6. `calcular_kpis`: calcula los 12 KPIs (global y por wiki) y los guarda en Cassandra.
- **Orden:** `extraer → validar_y_limpiar → cargar_mongo → [cargar_cassandra, cargar_neo4j] → calcular_kpis`. Cassandra y Neo4j se cargan en paralelo.
- **Idempotente:** volver a correr una hora no duplica datos. Tiene 2 reintentos por tarea y respaldo de los datos crudos en Cloud Storage.

## 4. Operaciones CRUD

> Operaciones básicas en cada base, demostradas durante la exposición.

Las operaciones están en la página **Operaciones CRUD** del dashboard (`web/src/pages/Crud.tsx`, API en `api/main.py`) y también como demo por consola (`python -m wikipipe.crud mongo|cassandra|neo4j|todo`, en `src/wikipipe/crud.py`).

**MongoDB (colección `events`), con interfaz rediseñada:**
- **Crear documento:**
  - formulario por tipo de evento (Edición, Página nueva, Categorización, Otros) sincronizado con un editor JSON;
  - el servidor calcula `derived` y el validador `$jsonSchema` rechaza documentos incompletos, lo que sirve para demostrarlo.
- **Consultar documento:** búsqueda con filtros (wiki, tipo, periodo, editor, título, solo demostración o `_id` exacto). Muestra las coincidencias y una ficha con el JSON completo.
- **Actualizar documento:**
  - formulario con los valores actuales, marcas de "editado" y tabla de cambios;
  - el servidor recalcula `derived` (por ejemplo `delta_bytes`) y guarda con un solo `update_one`.
- **Eliminar documento:** muestra el documento, pide escribir su `_id` y confirmar en un diálogo, y luego ejecuta `delete_one`.

**Cassandra (tabla `actividad_editor`, partición = editor):**
- **Inserción:** `INSERT` de una fila con editor, fecha, hora y wiki.
- **Consulta:** `SELECT` por partición, es decir, el historial de un editor.
- **Actualización:** `UPDATE` por clave primaria completa.
- **Eliminación:** `DELETE` de una fila, o de la partición completa del editor.

**Neo4j (grafo de editores):**
- **Crear nodo:** `MERGE (:Editor {user})`.
- **Crear relación:** `MERGE` de `REVIRTIO`, `MENSAJE_A`, `AGRADECIO`, `BLOQUEO` o `EDITO` entre nodos existentes.
- **Actualizar propiedades:** `SET` sobre el nodo. `user` es la clave única y no se cambia.
- **Eliminar:** `DELETE` de una relación o `DETACH DELETE` de un nodo con sus relaciones.

**Para la exposición:** se usan nombres que empiezan con «Demo_» y se borran al final, así no se alteran los datos reales que alimentan los KPIs. El rediseño de Cassandra y Neo4j está propuesto en Claude Design y quedó en pausa.

## 5. Dashboard analítico

> Conectar las 3 bases a un dashboard (Streamlit, Dash u otro) con indicadores y visualizaciones intuitivas; se valora creatividad y claridad.

- **Tecnología:** React + shadcn/ui sobre una API FastAPI, desplegado en una VM de GCP (puerto 8501, con contraseña). Se migró desde una primera versión en Streamlit.
- **Las tres bases conectadas:** cada vista lee de la base que corresponde. Los logos de MongoDB, Cassandra y Neo4j indican de dónde sale cada dato.
- **Siete vistas:**
  - **Resumen y KPIs:** los 12 KPIs de la última hora con variación frente a la hora anterior, ritmo de ediciones del día y los "protagonistas" que salen de Neo4j.
  - **En vivo:** eventos por segundo y últimas ediciones al instante (capa rápida), con filtros por tipo de evento y de editor, y detalle de cada evento.
  - **Actividad en el tiempo:** serie por minuto del día y el historial de un editor (Cassandra).
  - **Explorador de eventos:** búsqueda y conteos por tipo sobre MongoDB.
  - **Red de editores:** totales del grafo, rankings de editores revertidos y patrulleros, páginas disputadas y la red alrededor de un editor (Neo4j).
  - **Operaciones CRUD** (sección 4).
  - **Arquitectura:** diagrama clicable del flujo de datos. Cada componente abre su detalle:
    - la fuente: origen, estructura, características y captura de prueba del dataset;
    - las dos capas: el servicio stream y el flujo de Airflow paso a paso;
    - las tres bases: qué guarda cada una, por qué ahí y su tamaño;
    - la API y el dashboard: qué base consulta cada vista.
- **Claridad:**
  - todas las tarjetas abren un modal con definición, cálculo, lectura y origen del dato;
  - un filtro global de wiki (Ambas, enwiki, eswiki) aplica a todas las vistas;
  - hay modo claro y oscuro.

## 6. Indicadores (KPIs)

> Al menos cinco KPIs, cada uno con definición, fórmula e interpretación.

Calculamos **12 KPIs** cada hora, global y por wiki. Las definiciones, fórmulas e interpretaciones están en `web/src/lib/kpis.ts` y se muestran en el modal de cada KPI del dashboard.

| KPI | Fórmula | Se calcula en |
| --- | --- | --- |
| Eventos procesados | eventos en la hora | Cassandra |
| Crecimiento de actividad | (eventos h − eventos h−1) / eventos h−1 × 100 | Cassandra |
| Tasa de automatización | eventos de bots / eventos × 100 | Cassandra |
| Actividad por editor humano | eventos humanos / editores humanos distintos | Cassandra |
| Tasa de creación | páginas nuevas / (ediciones + páginas nuevas) × 100 | MongoDB |
| Volumen neto de contenido | Σ (bytes nuevos − bytes anteriores) | MongoDB |
| Tasa de reversión | ediciones que revierten a otro editor / ediciones × 100 | MongoDB |
| Eventos acumulados | documentos en `events` hasta el fin de la hora | MongoDB |
| Página más disputada | página editada en la hora con más editores distintos | Neo4j |
| Editor humano más conectado | editor activo con más relaciones `COEDITA` | Neo4j |
| Editor más revertido | editor con más reversiones recibidas | Neo4j |
| Calidad de datos | eventos válidos / eventos extraídos × 100 | Limpieza (DAG) |

- Cubren los ejemplos de las instrucciones: registros procesados (Eventos procesados), crecimiento (Crecimiento de actividad), entidad con más conexiones (Editor más conectado), promedio por usuario (Actividad por editor humano) y tendencia temporal (serie del día en el dashboard).
- Todos se guardan en Cassandra (`kpis` y `kpis_por_wiki`), aunque se calculen en otra base, y el dashboard los lee de ahí.

## Entregables

**1. Informe técnico en PDF:** pendiente. Ya tenemos el material de casi todas las secciones:

| Sección del informe | Material disponible |
| --- | --- |
| Introducción y descripción del problema | `docs/justificacion-dataset.md` (monitorear la actividad colaborativa en Wikimedia) y la página Arquitectura |
| Arquitectura propuesta | Diagrama de la página Arquitectura, `README.md` (arquitectura Lambda) y `docs/despliegue.md` (GCP) |
| Descripción del dataset | `docs/justificacion-dataset.md` y el modal de Wikimedia EventStreams de la página Arquitectura |
| Modelos de MongoDB, Cassandra y Neo4j | `db/mongo/schema.json`, `db/cassandra/schema.cql`, `db/neo4j/constraints.cypher`, `docs/img/esquema-grafo.png` |
| Explicación del DAG | `airflow/dags/wikipedia_pipeline.py`, `README.md` y el modal «Capa por lotes» de la página Arquitectura |
| KPIs implementados | Sección 6 de este documento |
| Capturas del dashboard | Pendientes |
| Conclusiones | Pendientes |

**2. Entregable:**
- **Código fuente completo:** listo, en el repositorio privado `github.com/Zoro4r/big-data-p2`.
- **Scripts de creación de las bases:** listos. `db/create_schemas.py` aplica `db/mongo/schema.json`, `db/cassandra/schema.cql` y `db/neo4j/constraints.cypher`.
- **DAG de Airflow:** listo, en `airflow/dags/wikipedia_pipeline.py`.
- **Dashboard funcional:** listo y desplegado en la VM de GCP; se levanta en local con `docker compose`.
- **Informe técnico en PDF:** pendiente.
- **Video demostrativo (20–25 min, con todos los integrantes):** pendiente.

**Evaluación de pares:** es individual, de cada integrante sobre los otros grupos; no depende del código.

**Trazabilidad:** cada cambio del proyecto queda registrado en `docs/trazabilidad.md`.
