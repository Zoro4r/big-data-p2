# Requerimientos del proyecto y cómo los cumplimos

Big Data · Proyecto Grupal II · UTEC · entrega: 17 de noviembre de 2026

Este documento recorre, sección por sección, lo que piden las instrucciones del proyecto ([Instrucciones Proyecto Grupal II.pdf](../Instrucciones%20Proyecto%20Grupal%20II.pdf)) y cómo lo resuelve nuestro trabajo. Las cifras son de la VM en GCP al 7 de noviembre de 2026, 14:08 UTC.

Cada referencia a otro archivo indica la sección o las líneas y lleva un enlace directo. Las páginas del dashboard enlazan a la versión desplegada (http://34.45.96.253:8501, pide la contraseña del equipo).

La revisión de desarrollo en `dev-ian` añade ventanas por wiki en Neo4j, recuperación de conteos, métricas con períodos explícitos y pruebas locales. El procedimiento está en [correcciones-dev-ian.md](correcciones-dev-ian.md). Las cifras de GCP de este documento corresponden a la fecha indicada arriba.

**Estado general de esa revisión:** las secciones 1 a 6 están implementadas y desplegadas. Quedan pendientes el informe en PDF (con capturas del dashboard) y el video.

| Sección | Estado |
| --- | --- |
| 1. Fuente de datos | Cumplido |
| 2. Arquitectura multimodelo | Cumplido |
| 3. Automatización con Airflow | Cumplido |
| 4. Operaciones CRUD | Cumplido en las tres bases, con la interfaz rediseñada |
| 5. Dashboard analítico | Cumplido |
| 6. Indicadores (KPIs) | Cumplido (12 KPIs, el mínimo es 5) |
| Entregables | Código, scripts, DAG y dashboard listos; faltan informe PDF y video |

---

## 1. Fuente de datos

> Datos no estructurados o semiestructurados, al menos 50,000 registros, que se actualicen periódicamente, y documentar su origen, estructura y características.
>
> Instrucciones, [sección 1 «Fuente de Datos», página 1](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=1).

- **Fuente:** el stream público **Wikipedia Recent Changes** de Wikimedia (EventStreams, `stream.wikimedia.org/v2/stream/recentchange`). Cada cambio en Wikipedia llega en tiempo real como un evento JSON.
- **Semiestructurado:** cada evento es un JSON con campos comunes y campos que dependen del tipo (`edit`, `new`, `categorize`, `log`), con objetos anidados (`meta`, `length`, `revision`, `log_params`). No todos los registros tienen la misma forma.
- **Volumen:** MongoDB guarda **2,570,895 eventos** de enwiki y eswiki, del 31 de octubre al 7 de noviembre de 2026. Es unas 50 veces el mínimo pedido.
- **Actualización periódica:** los datos llegan solos. El servicio de streaming los guarda cada ~2 segundos y el DAG procesa cada hora completa.
- **Documentación:** está en dos lugares con el mismo contenido.
  - [docs/justificacion-dataset.md](justificacion-dataset.md), en sus secciones:
    - [«Origen del dataset»](justificacion-dataset.md#origen-del-dataset): endpoint, protocolo, formato, autenticación, datos pasados y licencia.
    - [«Estructura del registro»](justificacion-dataset.md#estructura-del-registro): los 4 tipos de evento, sus campos y un ejemplo real.
    - [«Verificación empírica»](justificacion-dataset.md#verificación-empírica): la captura de prueba (~37 eventos/s).
    - [«Cumplimiento de requisitos»](justificacion-dataset.md#cumplimiento-de-requisitos): cómo cumple cada requisito de esta sección.
  - La página [Arquitectura](http://34.45.96.253:8501/arquitectura) del dashboard, en el modal de Wikimedia EventStreams (código: [`Fuente` en Arquitectura.tsx, línea 206](../web/src/pages/Arquitectura.tsx#L206)).
    - Muestra el problema que planteamos, el origen completo (fuente, endpoint, SSE, esquema versionado, autenticación, datos pasados con `?since=`, licencia y documentación oficial), los campos comunes y los de cada tipo, y un evento real de MongoDB.
    - Incluye la captura de prueba del 31 de octubre con su gráfico ([`CAPTURA`, línea 149](../web/src/pages/Arquitectura.tsx#L149)) y la tabla de cumplimiento de estos cuatro requisitos ([`REQUISITOS`, línea 161](../web/src/pages/Arquitectura.tsx#L161)).
    - Suma cifras en vivo: volumen, velocidad, mezcla de tipos de las últimas 24 h y calidad.

## 2. Arquitectura multimodelo

> Usar MongoDB (documentos originales), Cassandra (consultas masivas y series temporales) y Neo4j (relaciones entre entidades), y justificar por qué cada dato va en cada base.
>
> Instrucciones, [sección 2 «Arquitectura Multimodelo», página 1](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=1).

**MongoDB: los eventos originales.**
- Colección `events`: un documento por evento, con todos sus campos originales más el bloque `derived` que agrega la limpieza (fecha, hora, tipo de editor, bytes cambiados, a quién revierte, etc.).
- Encaja con MongoDB porque cada tipo de evento tiene campos distintos y anidados. Un esquema flexible los guarda sin forzar columnas vacías.
- En [db/mongo/schema.json](../db/mongo/schema.json):
  - un validador `$jsonSchema` exige los campos mínimos ([`validator`, línea 6](../db/mongo/schema.json#L6));
  - hay índices por fecha, por wiki y tipo, por editor y por página ([`indexes`, línea 65](../db/mongo/schema.json#L65)).

**Cassandra: series de tiempo y agregados.**
- Ocho tablas en [db/cassandra/schema.cql](../db/cassandra/schema.cql), cada una diseñada para una consulta del dashboard:
  - [`resumen_por_hora` (línea 8)](../db/cassandra/schema.cql#L8): totales de cada hora por wiki.
  - [`eventos_por_minuto` (línea 27)](../db/cassandra/schema.cql#L27): serie por minuto.
  - [`actividad_editor` (línea 39)](../db/cassandra/schema.cql#L39): historial de un editor, hora por hora.
  - [`paginas_top_por_hora` (línea 55)](../db/cassandra/schema.cql#L55): páginas más editadas de cada hora.
  - `paginas_disputadas_por_hora`: ranking horario de páginas con reversiones.
  - [`kpis` (línea 68)](../db/cassandra/schema.cql#L68) y [`kpis_por_wiki` (línea 77)](../db/cassandra/schema.cql#L77): el valor de cada KPI por hora.
  - [`ejecuciones` (línea 87)](../db/cassandra/schema.cql#L87): registro de las corridas del pipeline.
- Encaja con Cassandra porque son series temporales que se escriben sin parar y se leen por partición (un día, una wiki, un editor) con orden por tiempo.

**Neo4j: la red de colaboración.**
- **Nodos:** `Editor` (137,532), `Pagina` (734,742), `Categoria` (72,329) y `Wiki` (2).
- **Relaciones:**
  - con páginas: `EDITO`, `CREO`, `SUBIO`, `MOVIDA_A`, `PERTENECE_A` y `EN_CATEGORIA`;
  - entre editores: `REVIRTIO`, `MENSAJE_A`, `AGRADECIO`, `BLOQUEO` y `COEDITA`.
  - En total, unos 2.8 millones de relaciones.
- Encaja con Neo4j porque las preguntas son de relaciones: quién revierte a quién, qué editores comparten páginas, qué página atrae a más editores. En un grafo se responden recorriendo vecinos, sin joins costosos.
- **Restricciones de unicidad e índices:** [db/neo4j/constraints.cypher, desde la línea 4](../db/neo4j/constraints.cypher#L4).

**Justificación técnica:** hoy está en dos lugares.
- [docs/justificacion-dataset.md](justificacion-dataset.md):
  - [«Encaje multimodelo»](justificacion-dataset.md#encaje-multimodelo): qué guarda cada base y por qué;
  - [«Modelo de grafo preliminar»](justificacion-dataset.md#modelo-de-grafo-preliminar): el esquema del grafo, de dónde sale cada relación y un ejemplo real.
- La página [Arquitectura](http://34.45.96.253:8501/arquitectura) del dashboard: cada base abre un modal con qué guarda, por qué ahí y quién escribe.
  - MongoDB, además, el validador y los índices ([`Mongo`, línea 354](../web/src/pages/Arquitectura.tsx#L354)).
  - Cassandra, las 8 tablas con su clave primaria ([`Cassandra`, línea 385](../web/src/pages/Arquitectura.tsx#L385)).
  - Neo4j, el esquema del grafo, de qué parte del evento sale cada relación y un ejemplo real de reversiones ([`Neo4j`, línea 416](../web/src/pages/Arquitectura.tsx#L416)).

Falta pasarla al informe técnico en PDF, que todavía está pendiente (ver [Entregables](#entregables)). Este material será la base de su sección de modelos de datos.

**Arquitectura Lambda** (README, [«Arquitectura: capa rápida + capa por lotes (Lambda)»](../README.md#arquitectura-capa-rápida--capa-por-lotes-lambda)):
- **Capa rápida:** el servicio `stream` ([src/wikipipe/streaming.py](../src/wikipipe/streaming.py)) guarda los eventos en MongoDB y los contadores por minuto en Cassandra en ~2 segundos.
- **Capa por lotes:** el DAG horario recalcula todo y corrige esos contadores.

Las dos capas usan el mismo `_id`, así que no hay duplicados.

## 3. Automatización con Apache Airflow

> Un DAG con extracción, validación y limpieza, carga en MongoDB, transformación y carga en Cassandra, construcción de relaciones y carga en Neo4j, y generación automática de indicadores, ejecutado de forma programada.
>
> Instrucciones, [sección 3 «Automatización con Apache Airflow», página 2](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=2).

- **DAG `wikipedia_recent_changes`** en [airflow/dags/wikipedia_pipeline.py](../airflow/dags/wikipedia_pipeline.py), definido en el [`@dag` de la línea 33](../airflow/dags/wikipedia_pipeline.py#L33) y programado **cada hora** ([`schedule="@hourly"`, línea 35](../airflow/dags/wikipedia_pipeline.py#L35)). En la VM lleva **163 corridas** registradas.
- Sus seis tareas son exactamente las seis etapas pedidas:
  1. [`extraer` (línea 47)](../airflow/dags/wikipedia_pipeline.py#L47): descarga del stream la hora completa (con `?since=`) y la guarda cruda en `.jsonl.gz`.
  2. [`validar_y_limpiar` (línea 53)](../airflow/dags/wikipedia_pipeline.py#L53): descarta eventos inválidos (sin `meta`, sin campos obligatorios, tipo desconocido, fecha mal formada) y agrega los campos derivados. Los rechazados se guardan aparte con su motivo.
  3. [`cargar_mongo` (línea 64)](../airflow/dags/wikipedia_pipeline.py#L64): inserta o reemplaza los eventos limpios en `events`.
  4. [`cargar_cassandra` (línea 70)](../airflow/dags/wikipedia_pipeline.py#L70): agrega la hora (totales, series por minuto, actividad por editor, páginas top) y la escribe en Cassandra.
  5. [`cargar_neo4j` (línea 82)](../airflow/dags/wikipedia_pipeline.py#L82): construye nodos y relaciones de la hora con `MERGE`.
  6. [`calcular_kpis` (línea 95)](../airflow/dags/wikipedia_pipeline.py#L95): calcula los 12 KPIs (global y por wiki) y los guarda en Cassandra.
- **Orden** (README, [«Flujo del DAG»](../README.md#flujo-del-dag)): `extraer → validar_y_limpiar → cargar_mongo → [cargar_cassandra, cargar_neo4j] → calcular_kpis`. Cassandra y Neo4j se cargan en paralelo.
- **Idempotente:** volver a correr una hora no duplica datos. Tiene 2 reintentos por tarea ([`retries`, línea 25](../airflow/dags/wikipedia_pipeline.py#L25)) y respaldo de los datos crudos en Cloud Storage (despliegue, [«Qué se crea»](despliegue.md#qué-se-crea)).
- En el dashboard, la página [Arquitectura](http://34.45.96.253:8501/arquitectura) explica este flujo paso a paso en el modal «Capa por lotes» ([`CapaLotes`, línea 307](../web/src/pages/Arquitectura.tsx#L307)).

## 4. Operaciones CRUD

> Operaciones básicas en cada base, demostradas durante la exposición.
>
> Instrucciones, [sección 4 «Operaciones CRUD», página 3](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=3).

Las operaciones están en dos lugares:
- La página [Operaciones CRUD](http://34.45.96.253:8501/crud) del dashboard ([web/src/pages/Crud.tsx](../web/src/pages/Crud.tsx)). Sus rutas de API están en [api/main.py, desde la línea 184](../api/main.py#L184).
- Una demo por consola: `python -m wikipipe.crud mongo|cassandra|neo4j|todo`, en [src/wikipipe/crud.py, «Demo para la exposición», línea 320](../src/wikipipe/crud.py#L320). Cómo correrla: README, [«Demo de operaciones CRUD»](../README.md#demo-de-operaciones-crud).

**MongoDB (colección `events`), con interfaz rediseñada:**
- **Crear documento** ([crear-evento.tsx](../web/src/components/crear-evento.tsx); en el servidor, [`preparar_evento`, crud.py línea 54](../src/wikipipe/crud.py#L54)):
  - formulario por tipo de evento (Edición, Página nueva, Categorización, Otros) sincronizado con un editor JSON;
  - el servidor calcula `derived` y el validador `$jsonSchema` rechaza documentos incompletos, lo que sirve para demostrarlo.
- **Consultar documento** ([consultar-evento.tsx](../web/src/components/consultar-evento.tsx); ruta [`mongo_buscar`, main.py línea 221](../api/main.py#L221)): búsqueda con filtros (wiki, tipo, periodo, editor, título, solo demostración o `_id` exacto). Muestra las coincidencias y una ficha con el JSON completo.
- **Actualizar documento** ([actualizar-evento.tsx](../web/src/components/actualizar-evento.tsx); en el servidor, [`preparar_actualizacion`, crud.py línea 87](../src/wikipipe/crud.py#L87)):
  - formulario con los valores actuales, marcas de "editado" y tabla de cambios;
  - el servidor recalcula `derived` (por ejemplo `delta_bytes`) y guarda con un solo `update_one`.
- **Eliminar documento** ([eliminar-evento.tsx](../web/src/components/eliminar-evento.tsx); ruta [`mongo_eliminar`, main.py línea 261](../api/main.py#L261)): muestra el documento, pide escribir su `_id` y confirmar en un diálogo, y luego ejecuta `delete_one`.

Las tres bases usan la misma interfaz: la columna izquierda tiene los campos y la derecha muestra el resultado antes de ejecutar. Las piezas compartidas están en [crud-comun.tsx](../web/src/components/crud-comun.tsx).

**Cassandra (tabla `kpis`, clave `((kpi), ventana)`)**. La interfaz está en [cassandra-crud.tsx](../web/src/components/cassandra-crud.tsx) y reutiliza las funciones de [crud.py](../src/wikipipe/crud.py).
- **Inserción** de una fila con nombre de KPI, ventana UTC, valor y detalle. Una clave existente se reemplaza mediante upsert.
- **Consulta** por KPI, con fecha y hora opcionales.
- **Actualización** de `valor` y `detalle` por clave completa. Se comprueba que la fila exista.
- **Eliminación** de una fila o de la partición del KPI, con confirmación en la interfaz.
- Los datos de prueba se identifican con el prefijo `demo_`.

**Neo4j (grafo de editores)**: interfaz en [neo4j-crud.tsx](../web/src/components/neo4j-crud.tsx) ([`useNeo4jCrud`, línea 46](../web/src/components/neo4j-crud.tsx#L46)). Las rutas de API van desde [`neo_crear_editor`, main.py línea 384](../api/main.py#L384) y las funciones de base, en [crud.py, sección «Neo4j», línea 210](../src/wikipipe/crud.py#L210).
- **Crear nodo:** `MERGE (:Editor {user})` con su tipo.
- **Crear relación:**
  - `MERGE` de `REVIRTIO`, `MENSAJE_A`, `AGRADECIO` o `BLOQUEO`, con `veces` y `wiki`;
  - si un editor no existe, se crea junto con la relación ([`neo4j_asegurar_editor`, crud.py línea 229](../src/wikipipe/crud.py#L229));
  - a la derecha se dibuja cómo quedará en el grafo y qué nodos son nuevos.
- **Consulta:**
  - búsqueda por el comienzo del nombre, que usa el índice único de `user` ([`neo4j_buscar_editores`, línea 236](../src/wikipipe/crud.py#L236));
  - las coincidencias aparecen debajo de "Buscar";
  - la ficha tiene un mini grafo del editor con sus vecinos, la tabla de relaciones y sus propiedades ([`neo4j_detalle_editor`, línea 257](../src/wikipipe/crud.py#L257)).
- **Actualizar propiedades:**
  - `SET` de las propiedades del nodo, con "· editado", deshacer y "+ Agregar propiedad";
  - `user` es la clave única y no se cambia.
- **Eliminar:**
  - `DETACH DELETE` de un nodo, que antes lista las relaciones que se borrarán con él;
  - o `DELETE` de una sola relación, identificada mediante `elementId`, respetando su wiki y ventana;
  - el nodo se confirma escribiendo su nombre y luego en un diálogo.

**Datos de demostración:**
- Cassandra y Neo4j guardan datos que calcula el pipeline. Por eso consultar funciona con cualquier editor real, pero crear, actualizar y eliminar solo se permiten sobre nombres que empiezan con «Demo_».
- Lo impide la API ([`solo_demo`, main.py línea 272](../api/main.py#L272)) y la interfaz lo avisa y desactiva el botón.
- En la exposición se crean datos «Demo_» y se borran al final, así no se alteran los datos que alimentan los KPIs.

## 5. Dashboard analítico

> Conectar las 3 bases a un dashboard (Streamlit, Dash u otro) con indicadores y visualizaciones intuitivas; se valora creatividad y claridad.
>
> Instrucciones, [sección 5 «Dashboard Analítico», página 3](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=3).

- **Tecnología:** React + shadcn/ui ([web/](../web/)) sobre una API FastAPI ([api/](../api/)), desplegado en una VM de GCP (puerto 8501, con contraseña). Se migró desde una primera versión en Streamlit. Cómo desarrollarlo: README, [«Desarrollo del dashboard»](../README.md#desarrollo-del-dashboard).
- **Las tres bases conectadas:** cada vista lee de la base que corresponde. Los logos de MongoDB, Cassandra y Neo4j indican de dónde sale cada dato.
- **Siete vistas** (código en [web/src/pages/](../web/src/pages/)):
  - [Resumen y KPIs](http://34.45.96.253:8501/) ([Resumen.tsx](../web/src/pages/Resumen.tsx)): los 12 KPIs de la última hora con variación frente a la hora anterior, ritmo de ediciones del día y los "protagonistas" que salen de Neo4j.
  - [En vivo](http://34.45.96.253:8501/vivo) ([Vivo.tsx](../web/src/pages/Vivo.tsx)): eventos por segundo y últimas ediciones al instante (capa rápida), con filtros por tipo de evento y de editor, y detalle de cada evento.
  - [Actividad en el tiempo](http://34.45.96.253:8501/actividad) ([Actividad.tsx](../web/src/pages/Actividad.tsx)): serie por minuto del día y el historial de un editor (Cassandra).
  - [Explorador de eventos](http://34.45.96.253:8501/explorador) ([Explorador.tsx](../web/src/pages/Explorador.tsx)): búsqueda y conteos por tipo sobre MongoDB.
  - [Red de editores](http://34.45.96.253:8501/red) ([Red.tsx](../web/src/pages/Red.tsx)): tarjetas de conflicto y comunidad de las últimas 24 h, rankings de editores revertidos, patrulleros y editores más conectados, la red alrededor de un editor (Neo4j) y las páginas con más reversiones (Cassandra).
  - [Operaciones CRUD](http://34.45.96.253:8501/crud) ([Crud.tsx](../web/src/pages/Crud.tsx)): ver la [sección 4](#4-operaciones-crud).
  - [Arquitectura](http://34.45.96.253:8501/arquitectura) ([Arquitectura.tsx](../web/src/pages/Arquitectura.tsx)): diagrama clicable del flujo de datos ([`Diagrama`, línea 59](../web/src/pages/Arquitectura.tsx#L59)). Cada componente abre su detalle:
    - la fuente: origen, estructura, características y captura de prueba del dataset;
    - las dos capas: el servicio stream y el flujo de Airflow paso a paso;
    - las tres bases: qué guarda cada una, por qué ahí y su tamaño;
    - la API y el dashboard: qué base consulta cada vista ([`Api`, línea 454](../web/src/pages/Arquitectura.tsx#L454)).
- **Claridad:**
  - todas las tarjetas abren un modal con definición, cálculo, lectura y origen del dato ([modal-metrica.tsx](../web/src/components/modal-metrica.tsx));
  - un filtro global de wiki (Ambas, enwiki, eswiki) aplica a todas las vistas;
  - hay modo claro y oscuro.

## 6. Indicadores (KPIs)

> Al menos cinco KPIs, cada uno con definición, fórmula e interpretación.
>
> Instrucciones, [sección 6 «Indicadores (KPIs)», página 4](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=4).

Calculamos **12 KPIs** cada hora, global y por wiki:
- **Cálculo:** [src/wikipipe/kpis.py](../src/wikipipe/kpis.py), [función `compute`, línea 122](../src/wikipipe/kpis.py#L122).
- **Definición, fórmula e interpretación:** en el objeto [`KPIS` de web/src/lib/kpis.ts, línea 29](../web/src/lib/kpis.ts#L29). Se muestran en el modal de cada KPI de la página [Resumen y KPIs](http://34.45.96.253:8501/).

| KPI | Fórmula | Se calcula en |
| --- | --- | --- |
| Eventos procesados | eventos en la hora | Cassandra |
| Crecimiento de actividad | (eventos h − eventos h−1) / eventos h−1 × 100 | Cassandra |
| Tasa de automatización | eventos de bots / eventos × 100 | Cassandra |
| Actividad por editor humano | eventos humanos / cuentas humanas distintas de la ventana | MongoDB |
| Tasa de creación | páginas nuevas / (ediciones + páginas nuevas) × 100 | MongoDB |
| Volumen neto de contenido | Σ (bytes nuevos − bytes anteriores) | MongoDB |
| Tasa de reversión | ediciones que revierten a otro editor / ediciones × 100 | MongoDB |
| Eventos acumulados | documentos en `events` hasta el fin de la hora | MongoDB |
| Página más disputada | página con más reversiones recibidas en la hora | Cassandra |
| Editor humano más conectado | editor con más coeditores humanos durante esa hora | Neo4j |
| Editor más revertido | editor con más reversiones recibidas durante esa hora | Neo4j |
| Calidad de datos | eventos válidos / eventos extraídos × 100 | Limpieza (DAG) |

- Cubren los ejemplos de las instrucciones: registros procesados (Eventos procesados), crecimiento (Crecimiento de actividad), entidad con más conexiones (Editor más conectado), promedio por usuario (Actividad por editor humano) y tendencia temporal (serie del día en el dashboard).
- Todos se guardan en Cassandra ([`kpis`](../db/cassandra/schema.cql#L68) y [`kpis_por_wiki`](../db/cassandra/schema.cql#L77)), aunque se calculen en otra base, y el dashboard los lee de ahí.

## Entregables

> Instrucciones, [«Entregables», páginas 4 y 5](../Instrucciones%20Proyecto%20Grupal%20II.pdf#page=4).

**1. Informe técnico en PDF:** pendiente. Ya tenemos el material de casi todas las secciones:

| Sección del informe | Material disponible |
| --- | --- |
| Introducción y descripción del problema | [justificacion-dataset.md, «Resumen»](justificacion-dataset.md#resumen) (monitorear la actividad colaborativa en Wikimedia) y el modal de Wikimedia EventStreams de la página [Arquitectura](http://34.45.96.253:8501/arquitectura) |
| Arquitectura propuesta | El diagrama de la página [Arquitectura](http://34.45.96.253:8501/arquitectura), [README, «Arquitectura: capa rápida + capa por lotes (Lambda)»](../README.md#arquitectura-capa-rápida--capa-por-lotes-lambda) y [despliegue.md, «Qué se crea»](despliegue.md#qué-se-crea) (GCP) |
| Descripción del dataset | [justificacion-dataset.md, «Origen del dataset»](justificacion-dataset.md#origen-del-dataset), [«Estructura del registro»](justificacion-dataset.md#estructura-del-registro) y [«Verificación empírica»](justificacion-dataset.md#verificación-empírica); el modal de Wikimedia EventStreams |
| Modelos de MongoDB, Cassandra y Neo4j | [db/mongo/schema.json](../db/mongo/schema.json), [db/cassandra/schema.cql](../db/cassandra/schema.cql), [db/neo4j/constraints.cypher](../db/neo4j/constraints.cypher) e [img/esquema-grafo.png](img/esquema-grafo.png) |
| Explicación del DAG | [airflow/dags/wikipedia_pipeline.py](../airflow/dags/wikipedia_pipeline.py), [README, «Flujo del DAG»](../README.md#flujo-del-dag) y el modal «Capa por lotes» de la página [Arquitectura](http://34.45.96.253:8501/arquitectura) |
| KPIs implementados | [Sección 6 de este documento](#6-indicadores-kpis) |
| Capturas del dashboard | Pendientes |
| Conclusiones | Pendientes |

**2. Entregable:**
- **Código fuente completo:** listo, en el repositorio privado [github.com/Zoro4r/big-data-p2](https://github.com/Zoro4r/big-data-p2).
- **Scripts de creación de las bases:** listos. [db/create_schemas.py](../db/create_schemas.py) aplica [db/mongo/schema.json](../db/mongo/schema.json), [db/cassandra/schema.cql](../db/cassandra/schema.cql) y [db/neo4j/constraints.cypher](../db/neo4j/constraints.cypher).
- **DAG de Airflow:** listo, en [airflow/dags/wikipedia_pipeline.py](../airflow/dags/wikipedia_pipeline.py).
- **Dashboard funcional:** listo y [desplegado en la VM de GCP](http://34.45.96.253:8501). Se levanta en local con `docker compose` (README, [«Levantar el entorno en local»](../README.md#levantar-el-entorno-en-local)).
- **Informe técnico en PDF:** pendiente.
- **Video demostrativo (20–25 min, con todos los integrantes):** pendiente.

**Evaluación de pares:** es individual, de cada integrante sobre los otros grupos; no depende del código.

**Trazabilidad:** cada cambio del proyecto queda registrado en [docs/trazabilidad.md](trazabilidad.md).
