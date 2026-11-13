-- Esquema de Cassandra. Cada tabla responde una consulta del dashboard (modelo orientado a consultas).
-- Todas las escrituras son valores ya calculados que se sobrescriben: re-ejecutar una hora no duplica nada.

CREATE KEYSPACE IF NOT EXISTS wikipipe
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

-- Consulta: resumen de cada hora de un día, por wiki (tarjetas y gráficos del dashboard).
CREATE TABLE IF NOT EXISTS wikipipe.resumen_por_hora (
  fecha date,
  hora int,
  wiki text,
  eventos int,
  ediciones int,
  creaciones int,
  categorizaciones int,
  logs int,
  eventos_bot int,
  eventos_humanos int,
  editores int,
  editores_humanos int,
  reversiones int,
  delta_bytes bigint,
  PRIMARY KEY ((fecha), hora, wiki)
);

-- Consulta: serie por minuto de una wiki en un día (gráfico de actividad en el tiempo).
CREATE TABLE IF NOT EXISTS wikipipe.eventos_por_minuto (
  wiki text,
  fecha date,
  minuto timestamp,
  eventos int,
  ediciones int,
  eventos_bot int,
  reversiones int,
  PRIMARY KEY ((wiki, fecha), minuto)
) WITH CLUSTERING ORDER BY (minuto DESC);

-- Consulta: historial de un editor, hora por hora.
CREATE TABLE IF NOT EXISTS wikipipe.actividad_editor (
  editor text,
  fecha date,
  hora int,
  wiki text,
  tipo_editor text,
  eventos int,
  ediciones int,
  paginas int,
  delta_bytes bigint,
  reversiones_hechas int,
  reversiones_recibidas int,
  PRIMARY KEY ((editor), fecha, hora, wiki)
) WITH CLUSTERING ORDER BY (fecha DESC, hora DESC, wiki ASC);

-- Consulta: páginas más editadas de cada hora en una wiki (top 20 por hora).
CREATE TABLE IF NOT EXISTS wikipipe.paginas_top_por_hora (
  wiki text,
  fecha date,
  hora int,
  posicion int,
  pagina text,
  ediciones int,
  editores int,
  delta_bytes bigint,
  PRIMARY KEY ((wiki, fecha), hora, posicion)
) WITH CLUSTERING ORDER BY (hora DESC, posicion ASC);

-- Consulta: páginas en disputa de cada hora en una wiki (top 20 por reversiones recibidas).
CREATE TABLE IF NOT EXISTS wikipipe.paginas_disputadas_por_hora (
  wiki text,
  fecha date,
  hora int,
  posicion int,
  pagina text,
  reversiones int,
  ediciones int,
  editores int,
  PRIMARY KEY ((wiki, fecha), hora, posicion)
) WITH CLUSTERING ORDER BY (hora DESC, posicion ASC);

-- Consulta: serie de tiempo de un KPI (el valor más reciente es la primera fila).
CREATE TABLE IF NOT EXISTS wikipipe.kpis (
  kpi text,
  ventana timestamp,
  valor double,
  detalle text,
  PRIMARY KEY ((kpi), ventana)
) WITH CLUSTERING ORDER BY (ventana DESC);

-- Consulta: serie de tiempo de un KPI calculado solo sobre una wiki (enwiki o eswiki).
CREATE TABLE IF NOT EXISTS wikipipe.kpis_por_wiki (
  kpi text,
  wiki text,
  ventana timestamp,
  valor double,
  detalle text,
  PRIMARY KEY ((kpi, wiki), ventana)
) WITH CLUSTERING ORDER BY (ventana DESC);

-- Consulta: registros procesados por cada ejecución del DAG en un día.
CREATE TABLE IF NOT EXISTS wikipipe.ejecuciones (
  fecha date,
  ventana timestamp,
  leidos_stream int,
  extraidos int,
  validos int,
  rechazados int,
  calidad_pct double,
  segundos_extraccion double,
  fuente text,
  PRIMARY KEY ((fecha), ventana)
) WITH CLUSTERING ORDER BY (ventana DESC);
