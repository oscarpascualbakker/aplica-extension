// Opciones de esbuild y utilidades compartidas entre el build y los tests (CV-503, CV-504).

export const EXTRACT_GLOBAL = '__aplicaExtract';

/**
 * Los tres bundles de un destino: segundo plano, panel y script de extracción.
 * @param {{ target: 'chrome' | 'edge' | 'firefox', dev: boolean, apiBase: string, outdir?: string, write?: boolean }} options
 */
export function bundleOptions({ target, dev, apiBase, outdir = 'dist', write = true }) {
  // El service worker de Chrome y Edge es un módulo; el resto va como script clásico.
  const common = {
    bundle: true,
    target: 'es2022',
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    define: {
      __API_BASE__: JSON.stringify(apiBase),
      // En producción esbuild elimina el código de desarrollo (botón "Exportar página", CV-504).
      __DEV_BUILD__: JSON.stringify(dev),
    },
    logLevel: 'warning',
    outdir,
    write,
  };
  return {
    background: {
      ...common,
      entryPoints: { background: 'src/background.ts' },
      format: target === 'firefox' ? 'iife' : 'esm',
    },
    panel: {
      ...common,
      entryPoints: { panel: 'src/panel/panel.ts' },
      format: 'iife',
    },
    // executeScript devuelve el valor de la última expresión del script: el pie la deja
    // como resultado de la ejecución (CV-504).
    extract: {
      ...common,
      entryPoints: { extract: 'src/extract/inject.ts' },
      format: 'iife',
      globalName: EXTRACT_GLOBAL,
      footer: { js: `${EXTRACT_GLOBAL}.result;` },
    },
  };
}

/** Textos de _locales: en producción se quitan las claves de desarrollo (prefijo `dev`). */
export function filterLocale(messages, dev) {
  if (dev) return messages;
  return Object.fromEntries(Object.entries(messages).filter(([key]) => !key.startsWith('dev')));
}
