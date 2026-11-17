# Correcciones y verificación de `dev-ian`

El modelo 2 conserva las contribuciones de Neo4j por hora UTC y wiki. Los protagonistas del Resumen cuentan exclusivamente la hora indicada. Red de editores identifica sus métricas de 24 horas consolidadas y su historial acumulado.

Streaming guarda el documento completo en MongoDB y reconstruye los conteos provisionales del minuto desde esos documentos. Airflow consolida los resúmenes y corrige los minutos. Ambos escritores coordinan cada hora mediante `pipeline_windows`, un bloqueo renovable y timestamps crecientes de Cassandra. Los manifiestos incluyen escrituras pendientes para recuperar cargas parciales.

Reprocesar una hora elimina sus filas anteriores y reemplaza sus contribuciones del grafo en una transacción. También se actualizan los acumulados posteriores y el crecimiento de la siguiente hora. La API alinea los KPIs con ejecuciones completadas del modelo 2.

## Verificación local

Las pruebas de integración utilizan bases y keyspaces temporales con el prefijo `wikipipe_test_` en MongoDB y Cassandra y editores de Neo4j con un prefijo único. Ejecutarlas en el proyecto Compose de desarrollo. Se pueden ejecutar las pruebas unitarias con `PYTHONPATH=src python -m pytest tests`.

```bash
docker compose -p wikipipe-dev-ian up -d --build
docker compose -p wikipipe-dev-ian cp tests/. api:/tmp/tests/
docker compose -p wikipipe-dev-ian exec -T api pip install pytest httpx
docker compose -p wikipipe-dev-ian exec -T -e WIKIPIPE_INTEGRATION=1 api python -m pytest /tmp/tests/test_clean.py /tmp/tests/test_fuente.py /tmp/tests/test_streaming.py /tmp/tests/test_pipeline_integration.py -q
```

Las regresiones cubren reinicio, replay, fallo de escritura, escrituras atrasadas, separación por wiki, cuentas distintas, correcciones y eliminaciones, aislamiento histórico, rollback de Neo4j, alineación de series y CRUD de las tres bases a través de la API.

`node tests/test_dashboard.mjs` comprueba mediante renderizado React los períodos, unidades, textos y la arquitectura, incluidos los estados sin datos.

Las tarjetas conservan el texto a la izquierda y alinean verticalmente nombres, valores y contexto, con o sin pastilla de variación. Los nombres tienen mayor énfasis que sus descripciones. Los valores principales permanecen en negro (o blanco en modo oscuro), excepto «Variación de contenido», que usa verde para bytes positivos y rojo para negativos. Las diferencias respecto del período anterior se muestran en pastillas en la esquina superior derecha, junto al título, con signos explícitos como «−3 pp» o «+1.00 MB». La cabecera y el contexto de cada tarjeta reservan dos líneas para mantener su altura entre pestañas, con subtítulos en frases completas. Los gráficos comparten una paleta pastel: humanos en azul suave y bots en lavanda, incluyendo leyendas, barras, rankings y grafo. Las wikis conservan sus tonos azul y lavanda entre vistas; la evolución destaca la última hora con mayor opacidad.

Resumen alterna entre «Por hora» y «Acumulado», con cuatro tarjetas principales, detalles y protagonistas propios de cada período. «Más detalles» está encima del gráfico, con menos separación respecto de las tarjetas y manteniendo la separación con el gráfico. Los encabezados evitan repetir la wiki, el período seleccionado y los nombres de tablas internas. El gráfico conserva su serie horaria y las ejecuciones del pipeline permanecen iguales. El acumulado ya no se repite en un panel separado. En vivo compara los últimos cinco minutos con los cinco anteriores usando eventos originales de MongoDB, un único corte temporal, límites contiguos sin solapamiento y editores distintos por intervalo. Las tarjetas presentan eventos registrados (con su promedio por segundo como contexto), editores participantes, proporción de eventos de bots con numerador y denominador, y reversiones con una descripción breve. Los editores representan participantes distintos, no usuarios conectados. Las tarjetas y sus detalles comparten esas cifras; el gráfico mantiene los últimos treinta minutos como contexto. Actividad compara los mismos minutos del día anterior solamente cuando hay cobertura completa.

El tab acumulado muestra eventos almacenados, páginas creadas, contenido neto y participación de bots, con el corte visible y el número de horas en sus detalles. Sus detalles incluyen ediciones, reversiones, proporción de creaciones y horas consolidadas. Los porcentajes usan totales acumulados, sin promediar porcentajes horarios. Los indicadores consolidados se suman desde las filas horarias de Cassandra correspondientes a ejecuciones completadas del modelo 2, descartando ventanas que cambien durante la lectura. Los protagonistas acumulados se consultan al abrir su tab: MongoDB identifica la página con más reversiones y Neo4j los editores más conectado y más revertido, restringiendo ambas bases a las ventanas completadas hasta el mismo corte y a la wiki elegida. No se suman rankings horarios truncados. La arquitectura ofrece las pestañas «Arquitectura» y «Cómo funciona», con los mismos detalles de cada componente. El diagrama usa una leyenda breve con flechas de color, conexiones especiales con mayor contraste y más separación vertical.

`tests/seed_local.py` genera 55,000 registros **sintéticos** en una base de desarrollo vacía. Se utiliza para probar el volumen y el pipeline. El dataset de la entrega debe acreditarse con los eventos reales de Wikimedia.

Para esta muestra, iniciar `airflow` y `api` con sus dependencias en un proyecto Compose vacío y ejecutar el script antes de iniciar `stream`.

```bash
docker compose -p wikipipe-dev-ian exec -T api python /tmp/tests/seed_local.py
```

El script imprime los tres inicios de intervalo. Para cada intervalo, pasar su hora de cierre a `airflow dags test`. Por ejemplo, el cierre `2026-11-17T00:00:00+00:00` procesa la hora anterior, del 16 de noviembre a las 23:00 UTC.

```bash
docker compose -p wikipipe-dev-ian exec -T airflow airflow dags test wikipedia_recent_changes 2026-11-17T00:00:00+00:00
```

Airflow usa 8080 por defecto. `AIRFLOW_WEB_PORT=18080` en el `.env` local permite compartir el equipo con otro servicio que utilice 8080.

## Actualización de una instalación existente

El modelo anterior de Neo4j acumulaba las interacciones sin conservar su atribución por ventana y wiki. Para obtener los nuevos resultados históricos es necesario reconstruir los datos derivados a partir de MongoDB.

1. Registrar el commit instalado y crear una copia recuperable de los volúmenes o del disco de la instalación.
2. Pausar el DAG, esperar que terminen sus ejecuciones activas y detener el servicio `stream` antes de actualizar el código.
3. Ejecutar la reconstrucción desde Airflow, cuyo `DATA_DIR` está montado en la carpeta persistente `data/`.

```bash
docker compose exec -T airflow python -m wikipipe.rebuild --reset-graph
```

`--reset-graph` exporta primero todos los nodos y relaciones a `data/backups/neo4j-*.jsonl.gz` y luego vacía el grafo, incluidas las entidades manuales. La copia de volúmenes del primer paso permite restaurar el estado anterior completo. MongoDB conserva los eventos originales durante la reconstrucción.

El comando incorpora los editores antiguos al manifiesto, reconstruye cronológicamente las ventanas procesadas o cubiertas por streaming y publica los KPIs del modelo 2. Una hora sin cobertura suficiente se informa y queda pendiente. La validación histórica conserva las estadísticas registradas anteriormente y muestra un valor ausente si esas estadísticas faltan.

4. Comprobar las ventanas reconstruidas, conteos por wiki, indicadores y operaciones CRUD. Reiniciar API y streaming y reactivar el DAG.
5. Si hace falta recuperar la instalación anterior, restaurar conjuntamente su commit y los volúmenes respaldados.

La validación de esta rama se realiza en local. La revisión visual mediante el control de Chrome quedó pendiente porque la herramienta bloqueó el acceso al no poder identificar la URL con suficiente confianza.
