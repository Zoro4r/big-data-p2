// Esquema de Neo4j: claves únicas de cada tipo de nodo e índices para las consultas de KPIs.
// Las restricciones de unicidad también crean un índice, lo que acelera los MERGE de la carga.

CREATE CONSTRAINT editor_user IF NOT EXISTS FOR (e:Editor) REQUIRE e.user IS UNIQUE;
CREATE CONSTRAINT pagina_key IF NOT EXISTS FOR (p:Pagina) REQUIRE p.key IS UNIQUE;
CREATE CONSTRAINT wiki_nombre IF NOT EXISTS FOR (w:Wiki) REQUIRE w.nombre IS UNIQUE;
CREATE CONSTRAINT categoria_key IF NOT EXISTS FOR (c:Categoria) REQUIRE c.key IS UNIQUE;

CREATE INDEX pagina_ultima_edicion IF NOT EXISTS FOR (p:Pagina) ON (p.ultima_edicion);
CREATE INDEX editor_ultima_actividad IF NOT EXISTS FOR (e:Editor) ON (e.ultima_actividad);
CREATE INDEX editor_tipo IF NOT EXISTS FOR (e:Editor) ON (e.tipo);

// Modelo temporal y mutex transaccional de reconstrucción.
CREATE CONSTRAINT pipeline_modelo IF NOT EXISTS FOR (m:PipelineModelo) REQUIRE m.id IS UNIQUE;
CREATE INDEX edito_ventana IF NOT EXISTS FOR ()-[r:EDITO]-() ON (r.ventana);
CREATE INDEX revirtio_ventana IF NOT EXISTS FOR ()-[r:REVIRTIO]-() ON (r.ventana);
CREATE INDEX actividad_ventana IF NOT EXISTS FOR ()-[r:ACTIVO_EN]-() ON (r.ventana);
