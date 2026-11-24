# Aplica, extensión del navegador

Extensión gratuita y de código abierto (GPL-3.0) de Aplica (`aplica.cv`) para Chrome, Edge y
Firefox. Qué hace, sus permisos y cómo se desarrolla están en el `README.md`. Las decisiones
(`D-nn`) viven en la especificación del repositorio de la web (`docs/especificaciones-web.md`);
cítalas en los commits y en los comentarios del código.

## Entorno de desarrollo

Todo se ejecuta en Docker, en el servicio `node` de `docker-compose.yml`. En el equipo no hay
Node y no se instala. Los comandos están en el `README.md` ("Development (Docker only)").

## Datos

Solo datos ficticios en el código, los tests y las fixtures. Las capturas reales van a
`fixtures-raw/`, que no se sube nunca.

## La página de la extensión es su ayuda (D-229)

`aplica.cv/es/extension` y `aplica.cv/en/extension` explican cómo se usa la extensión, dónde lee
la oferta sola, qué hacer si algo no va y qué versión hay en las tiendas, con sus novedades. Viven
en el repositorio de la web (`resources/content/*/extension.md`). Se mantienen así:

- **Todo PR que cambie algo visible** (un botón, un mensaje, un portal que se lee solo, un paso)
  lleva en su cuerpo la sección `## Página de la extensión`, con lo que cambia en la página, o
  "Nada" si no cambia nada. El cambio de la página va en un PR del repositorio de la web.
- **La versión y las novedades** se actualizan en la página **al publicar una versión en las
  tiendas**, no con cada fusión: la página describe lo que la gente tiene instalado. Una línea por
  cambio visible, en español y en inglés británico.
- El enlace "Ayuda" del panel abre cada sección por su ancla. Las anclas salen de los títulos de
  la página y están en `content.extension_help_anchors` de la web: si cambia una, cambia también
  el panel.

## Convenciones de escritura

Sin guiones largos (em-dash), nunca. Español de España y inglés británico (en-GB). Todo texto del
panel, en los dos idiomas (`src/_locales/es` y `src/_locales/en`).
