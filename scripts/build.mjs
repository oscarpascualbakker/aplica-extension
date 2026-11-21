// Build por destino: dist/chrome, dist/edge y dist/firefox (CV-503).
// Uso: node scripts/build.mjs [--dev]. --dev apunta a http://localhost:8000 y añade la clave
// de desarrollo al manifest de Chrome y Edge.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildManifest, TARGETS } from './manifest.mjs';

const dev = process.argv.includes('--dev');
const apiBase = dev ? 'http://localhost:8000' : 'https://aplica.cv';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync('dist', { recursive: true, force: true });

for (const target of TARGETS) {
  const out = `dist/${target}`;
  mkdirSync(out, { recursive: true });

  // El service worker de Chrome y Edge es un módulo; el resto va como script clásico.
  const common = {
    bundle: true,
    target: 'es2022',
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    define: { __API_BASE__: JSON.stringify(apiBase) },
    logLevel: 'warning',
  };
  await build({
    ...common,
    entryPoints: { background: 'src/background.ts' },
    outdir: out,
    format: target === 'firefox' ? 'iife' : 'esm',
  });
  await build({
    ...common,
    entryPoints: { panel: 'src/panel/panel.ts' },
    outdir: out,
    format: 'iife',
  });

  cpSync('src/panel/panel.html', `${out}/panel.html`);
  cpSync('src/panel/panel.css', `${out}/panel.css`);
  cpSync('src/icons', `${out}/icons`, { recursive: true });
  cpSync('src/_locales', `${out}/_locales`, { recursive: true });
  writeFileSync(
    `${out}/manifest.json`,
    `${JSON.stringify(buildManifest(target, { version, dev }), null, 2)}\n`,
  );
  console.log(`${target}: ${out} (${apiBase})`);
}
