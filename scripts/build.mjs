// Build por destino: dist/chrome, dist/edge y dist/firefox (CV-503, CV-504).
// Uso: node scripts/build.mjs [--dev]. --dev apunta a http://localhost:8000, añade la clave
// de desarrollo al manifest de Chrome y Edge e incluye las herramientas de desarrollo.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { bundleOptions, filterLocale } from './build-options.mjs';
import { buildManifest, TARGETS } from './manifest.mjs';

const dev = process.argv.includes('--dev');
const apiBase = dev ? 'http://localhost:8000' : 'https://aplica.cv';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync('dist', { recursive: true, force: true });

for (const target of TARGETS) {
  const out = `dist/${target}`;
  mkdirSync(out, { recursive: true });

  const bundles = bundleOptions({ target, dev, apiBase, outdir: out });
  await build(bundles.background);
  await build(bundles.panel);
  await build(bundles.extract);
  await build(bundles.fill);

  cpSync('src/panel/panel.html', `${out}/panel.html`);
  cpSync('src/panel/panel.css', `${out}/panel.css`);
  cpSync('src/icons', `${out}/icons`, { recursive: true });
  for (const lang of readdirSync('src/_locales')) {
    mkdirSync(`${out}/_locales/${lang}`, { recursive: true });
    const messages = JSON.parse(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8'));
    writeFileSync(
      `${out}/_locales/${lang}/messages.json`,
      `${JSON.stringify(filterLocale(messages, dev), null, 2)}\n`,
    );
  }
  writeFileSync(
    `${out}/manifest.json`,
    `${JSON.stringify(buildManifest(target, { version, dev }), null, 2)}\n`,
  );
  console.log(`${target}: ${out} (${apiBase})`);
}
