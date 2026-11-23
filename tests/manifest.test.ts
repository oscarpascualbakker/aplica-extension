import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATS_HOST_PATTERNS, buildManifest, DEV_PUBLIC_KEY, TARGETS } from '../scripts/manifest.mjs';

const FORBIDDEN = ['host_permissions', 'content_scripts', 'externally_connectable'];

describe.each(TARGETS)('manifest %s', (target) => {
  for (const dev of [false, true]) {
    it(`no pide acceso a páginas (dev=${String(dev)})`, () => {
      const manifest = buildManifest(target, { version: '0.1.0', dev });
      for (const key of FORBIDDEN) expect(manifest).not.toHaveProperty(key);
      // La página solo se lee con activeTab + scripting, tras pulsar el icono (CV-504).
      expect(manifest.permissions).toEqual(expect.arrayContaining(['activeTab', 'scripting']));
      // Los únicos patrones de sitios son los permisos opcionales de los ATS (CV-507): nada
      // obligatorio, nada de <all_urls> y nada en la parte que se concede al instalar.
      const { optional_host_permissions: chromeOptional, optional_permissions: firefoxOptional, ...rest } = manifest;
      expect(target === 'firefox' ? firefoxOptional : chromeOptional).toEqual(ATS_HOST_PATTERNS);
      expect(target === 'firefox' ? chromeOptional : firefoxOptional).toBeUndefined();
      expect(JSON.stringify(rest)).not.toMatch(/<all_urls>|https?:\/\/\*|\*:\/\//);
      expect(ATS_HOST_PATTERNS.join(' ')).not.toContain('<all_urls>');
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
      expect(m.permissions).toEqual(['activeTab', 'scripting', 'storage', 'sidePanel', 'identity']);
      expect(m).not.toHaveProperty('key');
      expect(m).not.toHaveProperty('sidebar_action');
    }
  });

  it('Firefox: scripts, sidebar_action, gecko y data_collection_permissions', () => {
    const m = buildManifest('firefox', { version: '0.1.0' });
    expect(m.background).toEqual({ scripts: ['background.js'] });
    expect(m).not.toHaveProperty('side_panel');
    expect(m.permissions).toEqual(['activeTab', 'scripting', 'storage', 'identity']);
    expect(m.browser_specific_settings).toMatchObject({
      gecko: {
        id: 'extension@aplica.cv',
        data_collection_permissions: { required: ['authenticationInfo', 'websiteContent', 'browsingActivity'] },
      },
    });
  });

  it('la clave de desarrollo solo va en Chrome y Edge con --dev', () => {
    expect(buildManifest('chrome', { version: '0.1.0', dev: true }).key).toBe(DEV_PUBLIC_KEY);
    expect(buildManifest('edge', { version: '0.1.0', dev: true }).key).toBe(DEV_PUBLIC_KEY);
    expect(buildManifest('firefox', { version: '0.1.0', dev: true })).not.toHaveProperty('key');
  });
});

describe('icono (CV-504)', () => {
  it('el icono abre el panel desde action.onClicked, dentro del gesto, y no con setPanelBehavior', () => {
    const code = readFileSync('src/background.ts', 'utf8');
    expect(code).toContain('action.onClicked.addListener');
    expect(code).not.toContain('setPanelBehavior');
    // Lo primero que hace el manejador es abrir el panel, sin await ni promesas por delante.
    const handler = code.slice(code.indexOf('action.onClicked.addListener'));
    expect(handler.indexOf('sidePanel.open')).toBeGreaterThan(-1);
    expect(handler.indexOf('sidePanel.open')).toBeLessThan(handler.indexOf('notifyPanel()'));
    expect(handler).not.toContain('await');
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
    const sources = ['src/panel/panel.ts', 'src/panel/dev-export.ts', 'src/panel/fill-section.ts', 'src/panel/sent-run.ts', 'src/background.ts'];
    const used = new Set<string>();
    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/(?:\bt\(|key: )'(\w+)'/g)) used.add(m[1] as string);
      for (const m of code.matchAll(/^\s+\w+: '(\w+)',?$/gm)) if (/^(error|notice)/.test(m[1] as string)) used.add(m[1] as string);
    }
    for (const key of used) expect(en).toHaveProperty(key);

    // Y al revés: ninguna clave de _locales queda sin usar (código o manifest).
    const everything = [...sources, 'scripts/manifest.mjs'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const manifestText = JSON.stringify(TARGETS.map((t) => buildManifest(t, { version: '0.1.0' })));
    for (const key of Object.keys(en)) {
      expect(everything.includes(`'${key}'`) || manifestText.includes(`__MSG_${key}__`), key).toBe(true);
    }

    for (const lang of readdirSync('src/_locales')) {
      expect(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')).not.toMatch(new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`));
    }
  });
});

describe('permisos de host opcionales (CV-507)', () => {
  it('son solo los dominios de formulario de los siete ATS, y todos terminan en /*', () => {
    const allowed =
      /^\*:\/\/(\*\.)?(myworkdayjobs\.com|myworkdaysite\.com|boards\.greenhouse\.io|job-boards\.greenhouse\.io|job-boards\.eu\.greenhouse\.io|jobs\.lever\.co|jobs\.eu\.lever\.co|jobs\.smartrecruiters\.com|apply\.workable\.com|teamtailor\.com|jobs\.personio\.de|jobs\.personio\.com)\/\*$/;
    expect(ATS_HOST_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of ATS_HOST_PATTERNS) expect(pattern).toMatch(allowed);
  });

  it('se piden al activar el autorrelleno, nunca al instalar: no hay permisos de host obligatorios', () => {
    for (const target of TARGETS) {
      const manifest = buildManifest(target, { version: '0.1.0' });
      expect(manifest).not.toHaveProperty('host_permissions');
      expect(manifest).not.toHaveProperty('content_scripts');
      expect((manifest.permissions as string[]).some((p) => p.includes('://') || p === '<all_urls>')).toBe(false);
    }
    // permissions.request solo se llama desde el rellenado, tras el clic de la persona.
    const requests = ['src/panel/panel.ts', 'src/panel/fill-section.ts', 'src/panel/fill-run.ts', 'src/background.ts'].filter((file) =>
      readFileSync(file, 'utf8').includes('permissions.request'),
    );
    expect(requests).toEqual([]);
    expect(readFileSync('src/panel/fill-page.ts', 'utf8')).toContain('permissions.request({ origins })');
  });
});
