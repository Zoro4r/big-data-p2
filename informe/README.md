# Informe técnico en LaTeX

Informe elaborado con la clase y los recursos de `Plantilla_UTEC_PFC.zip`.

- Entrada: `main.tex`.
- Portada: `datos.tex`. Se incorporaron los nombres completos proporcionados por el equipo; el docente puede completarse si corresponde.
- Contenido: `secciones/`.
- Referencias: `referencias.bib`, estilo IEEEtran.
- Verificaciones: `evidencias/verificacion.txt`.
- PDF compilado junto al código: `Informe_Wikipedia_UTEC.pdf`.
- Copia de entrega: `../output/pdf/Informe_Wikipedia_UTEC.pdf`.

## Compilar

Con TeX Live o MacTeX:

```sh
cd informe
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

En Overleaf: subir el contenido de esta carpeta y elegir `main.tex` como documento principal, compilador pdfLaTeX. No se requieren herramientas externas ni shell escape. La clase original se conserva; la portada se adapta al curso en `main.tex`.

## Alcance

Código revisado: commit `3ce1bb5`. Las mediciones históricas de GCP se atribuyen a la bitácora. Las capturas de la interfaz se obtuvieron del dashboard desplegado en `http://34.45.96.253:8501/` el 17 de noviembre de 2026. Las pruebas de integración necesitan servicios activos y no fueron ejecutadas en esta revisión. El informe distingue el recorte del 17 de noviembre de las mediciones anteriores.

## Maquetación auditada

Se conserva la clase UTEC y el cuerpo de 12 pt. La adaptación visual usa márgenes de 2.5 cm e interlineado de 1.15; se ajustan espaciados de títulos, párrafos y ecuaciones. Las capturas CRUD se integran junto a sus explicaciones, y la vista de Arquitectura comparte página con su introducción y lectura. Los bloques de código permanecen completos y se revisan tablas, numeración y referencias. El detalle de la auditoría está en `evidencias/auditoria-maquetacion.md`.
