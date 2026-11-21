import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildManifest, DEV_PUBLIC_KEY, TARGETS } from '../scripts/manifest.mjs';

const FORBIDDEN = ['host_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable'];

describe.each(TARGETS)('manifest %s', (target) => {
  for (const dev of [false, true]) {
    it(`no pide acceso a páginas (dev=${String(dev)})`, () => {
      const manifest = buildManifest(target, { version: '0.1.0', dev });
      for (const key of FORBIDDEN) expect(manifest).not.toHaveProperty(key);
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.default_locale).toBe('en');
    });
  }
});

describe('diferencias por destino', () => {
  it('Chrome y Edge: service worker, side panel y permisos mínimos', () => {
    for (const target of ['chrome', 'edge'] as const) {
      const m = buildManifest(target, { version: '0.1.0' });
      expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
      expect(m.side_panel).toEqual({ default_path: 'panel.html' });
      expect(m.permissions).toEqual(['activeTab', 'storage', 'sidePanel', 'identity']);
      expect(m).not.toHaveProperty('key');
      expect(m).not.toHaveProperty('sidebar_action');
    }
  });

  it('Firefox: scripts, sidebar_action, gecko y data_collection_permissions', () => {
    const m = buildManifest('firefox', { version: '0.1.0' });
    expect(m.background).toEqual({ scripts: ['background.js'] });
    expect(m).not.toHaveProperty('side_panel');
    expect(m.permissions).toEqual(['activeTab', 'storage', 'identity']);
    expect(m.browser_specific_settings).toMatchObject({
      gecko: {
        id: 'extension@aplica.cv',
        data_collection_permissions: { required: ['authenticationInfo'] },
      },
    });
  });

  it('la clave de desarrollo solo va en Chrome y Edge con --dev', () => {
    expect(buildManifest('chrome', { version: '0.1.0', dev: true }).key).toBe(DEV_PUBLIC_KEY);
    expect(buildManifest('edge', { version: '0.1.0', dev: true }).key).toBe(DEV_PUBLIC_KEY);
    expect(buildManifest('firefox', { version: '0.1.0', dev: true })).not.toHaveProperty('key');
  });
});

describe('textos', () => {
  const read = (lang: string): Record<string, { message: string }> =>
    JSON.parse(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')) as Record<string, { message: string }>;

  it('es y en tienen las mismas claves', () => {
    expect(Object.keys(read('es')).sort()).toEqual(Object.keys(read('en')).sort());
  });

  it('el manifest solo usa claves que existen', () => {
    const text = JSON.stringify(TARGETS.map((t) => buildManifest(t, { version: '0.1.0' })));
    const keys = [...text.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(read('en')).toHaveProperty(key);
  });

  it('las claves usadas en el código existen y no hay guiones largos', () => {
    const en = read('en');
    const sources = ['src/panel/panel.ts', 'src/background.ts'];
    const used = new Set<string>();
    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/(?:t\(|key: )'(\w+)'/g)) used.add(m[1] as string);
      for (const m of code.matchAll(/^\s+\w+: '(\w+)',?$/gm)) if (/^(error|notice)/.test(m[1] as string)) used.add(m[1] as string);
    }
    for (const key of used) expect(en).toHaveProperty(key);

    for (const lang of readdirSync('src/_locales')) {
      expect(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')).not.toMatch(new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`));
    }
  });
});
