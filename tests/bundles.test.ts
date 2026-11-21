// Pruebas sobre los bundles reales (CV-504): el script inyectado y la ausencia de las
// herramientas de desarrollo en producción. Se compilan en memoria con las mismas opciones
// que el build (scripts/build-options.mjs).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { bundleOptions, filterLocale } from '../scripts/build-options.mjs';
import { fixture, parseHtml } from './helpers/dom';

type Bundles = { background: string; panel: string; extract: string };

async function compile(dev: boolean, target: 'chrome' | 'firefox' = 'chrome'): Promise<Bundles> {
  const options = bundleOptions({ target, dev, apiBase: dev ? 'http://localhost:8000' : 'https://aplica.cv', write: false });
  const out: Record<string, string> = {};
  for (const [name, opts] of Object.entries(options)) {
    const result = await build({ ...opts, outdir: 'dist-test' });
    out[name] = (result.outputFiles ?? []).map((f) => f.text).join('');
  }
  return out as Bundles;
}

let production: Bundles;
let development: Bundles;

beforeAll(async () => {
  production = await compile(false);
  development = await compile(true);
});

describe('extract.js inyectado', () => {
  /** Ejecuta el script como lo hace executeScript: el resultado es el valor de la última expresión. */
  function run(code: string, html: string, url: string, selection = ''): unknown {
    const document = parseHtml(html, url);
    const location = new URL(url);
    const sandbox = { document, location, getSelection: () => ({ toString: () => selection }) };
    return vm.runInContext(code, vm.createContext(sandbox));
  }

  it('devuelve el objeto serializable con la oferta (valor de la última expresión)', () => {
    const result = run(production.extract, fixture('lever'), 'https://jobs.lever.co/empresaficticia/1');
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      title: 'Desarrolladora backend',
      company: 'Empresa Ficticia S.L.',
      portal: 'lever',
      workMode: 'hibrido',
    });
  });

  it('usa el texto seleccionado cuando no hay descripción', () => {
    const result = run(production.extract, '<html><body><p>Nada</p></body></html>', 'https://example.org/a', 'Texto elegido');
    expect(result).toMatchObject({ description: 'Texto elegido', descriptionFromSelection: true });
  });

  it('no envía nada a ningún sitio ni toca las APIs de la extensión', () => {
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'chrome.', 'browser.', 'localStorage', 'eval(']) {
      expect(production.extract, forbidden).not.toContain(forbidden);
    }
  });

  it('el build de desarrollo funciona igual', () => {
    const result = run(development.extract, fixture('greenhouse'), 'https://job-boards.greenhouse.io/x/jobs/1');
    expect(result).toMatchObject({ portal: 'greenhouse', title: 'Desarrolladora backend' });
  });
});

describe('herramientas de desarrollo (botón "Exportar página")', () => {
  const MARKERS = ['aplica-export', 'devExport', 'outerHTML'];

  it('no existen en el bundle de producción del panel', () => {
    for (const marker of MARKERS) expect(production.panel, marker).not.toContain(marker);
  });

  it('no existen en el service worker ni en el script de extracción de producción', () => {
    for (const marker of MARKERS) {
      expect(production.background, marker).not.toContain(marker);
      expect(production.extract, marker).not.toContain(marker);
    }
  });

  it('sí existen en el build de desarrollo', () => {
    for (const marker of MARKERS) expect(development.panel, marker).toContain(marker);
  });

  it('el build de producción de Firefox tampoco las lleva', async () => {
    const firefox = await compile(false, 'firefox');
    for (const marker of MARKERS) expect(firefox.panel, marker).not.toContain(marker);
  });

  it('los textos de desarrollo se quitan de _locales en producción y se conservan en desarrollo', () => {
    for (const lang of ['es', 'en']) {
      const messages = JSON.parse(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(messages).some((k) => k.startsWith('dev'))).toBe(true);
      expect(Object.keys(filterLocale(messages, false)).some((k) => k.startsWith('dev'))).toBe(false);
      expect(Object.keys(filterLocale(messages, true))).toEqual(Object.keys(messages));
    }
  });
});
