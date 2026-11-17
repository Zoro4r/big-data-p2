# Auditoría de maquetación

Versión revisada: informe de Wikipedia en vivo, 17 de noviembre de 2026.
Resultado: 42 páginas, frente a las 56 de la versión anterior.

## Hallazgos y correcciones

| Hallazgo | Corrección aplicada |
| --- | --- |
| Introducción de capturas aislada en una página y cuatro figuras forzadas a páginas separadas. | Se eliminaron los flotantes exclusivos de página. Cada captura CRUD acompaña a su explicación; Arquitectura comparte página con introducción, figura y lectura. |
| Capturas pequeñas con amplias áreas vacías alrededor. | Se ampliaron dentro del área de lectura y se ajustaron límites de tamaño y espaciados. |
| Tablas que se desplazaban de su sección o terminaban solas al final. | Se revisó la colocación; las tablas de usuarios y de requisitos permanecen con sus títulos. |
| Bloque JSON y comandos partidos entre páginas. | Los bloques de código cortos se mantienen completos junto a sus leyendas. |
| Acumulación de espacios en títulos, párrafos y ecuaciones. | Se ajustaron márgenes, interlineado y espaciados, manteniendo 12 pt en el cuerpo principal. |
| Párrafos de metodología aislados al terminar la introducción. | Se reubicó el alcance de revisión en el anexo A.7 y se compactó su cierre para evitar una última página con una línea aislada. |
| Referencias bibliográficas extendidas a una página adicional casi vacía. | Se normalizaron cuerpo y espaciado de la bibliografía. |

## Parámetros de la adaptación

- Clase UTEC y estilo IEEEtran originales sin modificación.
- Márgenes de 2.5 cm y cuerpo principal de 12 pt con interlineado 1.15.
- Tablas, bibliografía y anexos con tamaño y espaciado propios para lectura compacta.
- Portada con los cuatro nombres completos proporcionados.
- Contenido técnico conservado; se reformularon la introducción de las capturas, sus leyendas y el cierre metodológico sin cambiar su alcance.
- Cuatro capturas renovadas desde el dashboard desplegado en GCP; recorte de marcos del navegador, sin alterar los datos mostrados.
- Fuente de las capturas: dashboard del proyecto desplegado en Google Cloud Platform. Los diagramas propios conservan su atribución.

## Verificación final

- 42 páginas renderizadas y revisadas visualmente, con ampliación de capturas y tablas.
- Sin páginas vacías ni texto fuera de los límites físicos.
- Compilación sin avisos, desbordes ni referencias pendientes.
- 110 enlaces internos y bibliográficos presentes.
- Índices, numeración, figuras y tablas regenerados.
- No se modificó el código de la aplicación ni se alteraron mediciones del proyecto.
