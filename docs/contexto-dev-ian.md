# Contexto para continuar el proyecto

Estado comprobado el **17 de noviembre de 2026**, zona UTC−5. Este documento describe la entrega de trabajo y sus límites de verificación.

## Ramas y publicación

- Rama del workspace: `dev-ian`.
- Último cambio funcional: `1feac14` — historial de registros creados en los selectores CRUD.
- Ese cambio y los cambios anteriores de `dev-ian` ya están integrados en `main`, mediante el merge `846ac7f`.
- El merge conservó los cambios propios de `main`, incluida la configuración de despliegue automático de la VM y el reinicio del aviso de clave existente en el formulario de Cassandra.
- Este documento se publica en `dev-ian`; no supone otro merge a `main`.
- El merge se preparó y comprobó en un worktree temporal separado. El workspace principal sigue en `dev-ian`; no se cambió su rama.

## Qué se terminó

- **Resumen:** pestañas «Por hora» y «Acumulado», cuatro tarjetas principales por período y «Más detalles» encima del gráfico. Los protagonistas cambian con el período; el gráfico conserva su evolución por hora y la tabla de ejecuciones del pipeline permanece igual.
- **Métricas:** valores principales en negro, salvo «Variación de contenido», verde si añade bytes y rojo si los elimina. Las diferencias van en una pastilla con signo, junto al título, arriba a la derecha. Textos alineados a la izquierda y alturas coherentes entre tarjetas.
- **En vivo:** tarjetas de los últimos cinco minutos frente a los cinco anteriores. El gráfico conserva treinta minutos. Editores participantes significa cuentas distintas con actividad, no usuarios conectados.
- **Colores:** azul empolvado y rosa pastel compartidos entre gráficos y categorías repetidas; evitar añadir colores arbitrarios a los valores de los KPIs.
- **Arquitectura:** dos pestañas, «Arquitectura» y «Cómo funciona». Diagrama con logos, bases de datos diferenciadas, Docker con fondo azul y leyenda breve para las rutas especiales. La ruta azul lleva conteos provisionales por minuto; la morada corresponde a recuperación de horas incompletas.
- **Red de editores:** primero las tres tarjetas de las últimas 24 horas consolidadas; después, el grafo del historial acumulado y los rankings de editores. Se eliminó el bloque «Páginas con reversiones» de esta página.
- **Explorador:** cuatro tarjetas por tipo de evento del dataset almacenado en MongoDB. Cada porcentaje muestra su denominador explícito. Los filtros de búsqueda afectan los resultados, no el resumen del dataset.

## Cómo interpretar los conteos

- MongoDB conserva eventos originales, incluidos los recientes pendientes de consolidar. El Explorador cuenta ese dataset para las wikis elegidas.
- Streaming publica conteos provisionales por minuto en Cassandra. Airflow consolida las horas y calcula sus métricas y relaciones.
- Resumen y Actividad usan las mismas ventanas completadas para sus métricas consolidadas. Actividad informa los eventos pendientes por separado.
- Por eso, el total almacenado en MongoDB puede superar el total consolidado. No mezclar ambos alcances en una misma tarjeta o porcentaje.
- La muestra inicial de **55,000 eventos es sintética**, generada para pruebas locales; no acredita por sí misma el volumen de eventos reales exigido para la entrega.
- En el acumulado, el pie de «Eventos de bots» quedó como «7,858 del total de eventos» para esa muestra; el número se calcula a partir de los datos, no está fijado.

## Último cambio: selector CRUD

- Se reutilizan el botón y el popup existentes en MongoDB, Cassandra y Neo4j.
- Después de una creación exitosa, aparece arriba la sección «Tus registros», del más nuevo al más antiguo. Debajo siguen los últimos cinco registros que ya ofrecía cada selector.
- Sin creaciones propias, se mantiene el selector de últimos cinco.
- Cada base tiene su historial independiente. Se guardan solo sus identificadores en `sessionStorage`, por lo que sobreviven a una recarga de la misma pestaña; no constituyen un historial compartido entre equipos o pestañas nuevas.
- Al abrir el popup se consultan los registros actuales: se ven las modificaciones y se retiran del historial los que devuelvan 404. Un error de conexión o autenticación no se interpreta como una eliminación.
- MongoDB respeta la wiki del formulario. Cassandra identifica cada fila por KPI y ventana completa. Neo4j permite recuperar los nodos creados y los editores de una relación creada desde el formulario.
- Los INSERT/upsert de Cassandra y los MERGE de Neo4j también quedan accesibles tras guardar desde «Crear». Repetir una clave no duplica su entrada ni altera su posición original.
- Seleccionar una entrada la lleva a Consultar, Actualizar o Eliminar, según la operación activa. Los registros propios no están limitados a cinco.
- Archivos principales: [crud-creados.ts](../web/src/lib/crud-creados.ts), [Crud.tsx](../web/src/pages/Crud.tsx), [crud-comun.tsx](../web/src/components/crud-comun.tsx), [cassandra-crud.tsx](../web/src/components/cassandra-crud.tsx) y [neo4j-crud.tsx](../web/src/components/neo4j-crud.tsx).

## Entorno local comprobado

| Servicio | Dirección / estado |
| --- | --- |
| Dashboard | `http://localhost:8501` — operativo |
| API | `http://127.0.0.1:8010` — salud comprobada también mediante `/api/health` del dashboard |
| Airflow | `http://localhost:18080` |
| Neo4j Browser | `http://localhost:7474` |
| Vite | `http://127.0.0.1:5173` — detenido; usar el dashboard de 8501 |
| Docker Compose | Proyecto `wikipipe-dev-ian`; los ocho servicios están levantados |

- **Mantener libre el puerto 8080 del equipo:** el usuario lo está utilizando. Airflow conserva su puerto interno 8080 y se publica localmente en 18080 mediante `AIRFLOW_WEB_PORT` en `.env`. No cambiarlo sin indicación del usuario.
- La web local de 8501 se reconstruyó con la versión combinada del merge a `main`. Editar el código requiere reconstruir `web` para actualizar esa versión.
- Las credenciales están en `.env`, excluido de Git; no copiarlas a la documentación ni a los commits.

## Verificación realizada

- **10 pruebas de integración aprobadas** con las tres bases reales, incluyendo crear, consultar, actualizar y eliminar mediante la API, rechazo de documentos inválidos, claves duplicadas, upsert y eliminación de una relación exacta de Neo4j.
- Historial CRUD: probados más de cinco registros propios, orden de creación, datos actualizados, desaparición de eliminados y conservación ante errores de red/autenticación.
- Pruebas de renderizado React del dashboard aprobadas, incluidos alcances temporales y estados sin datos.
- La versión combinada con `main` compiló correctamente y volvió a pasar las pruebas JavaScript.
- ESLint de los archivos modificados: sin errores; conserva los cuatro avisos existentes de Fast Refresh de esos componentes.
- Dashboard y API locales respondieron HTTP 200 después de reconstruir la web.

Comandos para repetir las comprobaciones desde la raíz:

```powershell
npm --prefix web run build
node tests/test_dashboard.mjs
node tests/test_crud_history.mjs
docker cp ./tests/. wikipipe-dev-ian-api-1:/tmp/tests/
docker compose -p wikipipe-dev-ian exec -T -e WIKIPIPE_INTEGRATION=1 api python -m pytest /tmp/tests/test_pipeline_integration.py -q -p no:cacheprovider
```

Las pruebas de integración usan una base y un keyspace temporales con prefijo `wikipipe_test_`, además de entidades Neo4j con prefijos únicos; limpian sus datos al terminar.

## Qué no está acreditado todavía

- La comprobación visual interactiva con el navegador quedó pendiente por restricciones de las herramientas. Las pruebas React, de compilación y API no equivalen a esa revisión manual.
- `main` contiene despliegue automático, pero en esta sesión no se comprobó qué commit está ejecutando la VM ni el resultado del despliegue en Google Cloud.
- Tampoco se acredita aquí una reconstrucción del histórico en la VM. Una instalación con el modelo antiguo necesita revisar el procedimiento de [correcciones-dev-ian.md](correcciones-dev-ian.md) antes de usar sus indicadores históricos. `--reset-graph` vacía el grafo, incluidas entidades manuales: requiere el respaldo y la coordinación indicados allí.

Para más detalle del pipeline y la migración, consultar [correcciones-dev-ian.md](correcciones-dev-ian.md). Para iniciar otra instalación local, consultar [local.md](local.md).
