import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMessage, isLocale, loadLocale, resetLocale, t } from '../src/i18n';
import { createLocaleStore } from '../src/locale-store';

afterEach(() => {
  resetLocale();
  vi.unstubAllGlobals();
});

describe('formatMessage', () => {
  const entry = {
    message: 'Conectado como $EMAIL$ ($1 veces, $$ y $DESCONOCIDO$)',
    placeholders: { email: { content: '$1' }, Otro: { content: 'fijo $2' } },
  };

  it('sustituye placeholders como i18n.getMessage', () => {
    expect(formatMessage(entry, ['ana@example.com', 'dos'])).toBe('Conectado como ana@example.com ($1 veces, $ y $DESCONOCIDO$)');
  });

  it('un solo argumento como texto', () => {
    expect(formatMessage({ message: 'Hola $N$', placeholders: { n: { content: '$1' } } }, 'Ana')).toBe('Hola Ana');
  });

  it('los nombres de placeholder no distinguen mayúsculas y el contenido puede llevar texto fijo', () => {
    expect(formatMessage({ message: '$otro$', placeholders: { Otro: { content: 'fijo $2' } } }, ['a', 'b'])).toBe('fijo b');
  });

  it('sin argumentos, los $n quedan vacíos', () => {
    expect(formatMessage({ message: 'x $A$', placeholders: { a: { content: '$1' } } })).toBe('x ');
  });
});

describe('loadLocale y t', () => {
  function stubBrowser(getMessage: (key: string) => string): void {
    vi.stubGlobal('chrome', { i18n: { getMessage } });
  }

  it('sin diccionario cargado, t usa i18n.getMessage (idioma del navegador)', () => {
    stubBrowser((key) => `navegador:${key}`);
    expect(t('connectButton')).toBe('navegador:connectButton');
  });

  it('con el idioma de la cuenta cargado, t lee de _locales/<locale>', async () => {
    stubBrowser(() => 'navegador');
    const paths: string[] = [];
    const ok = await loadLocale('es', (path) => {
      paths.push(path);
      return Promise.resolve({ connectButton: { message: 'Conectar con Aplica' } });
    });
    expect(ok).toBe(true);
    expect(paths).toEqual(['_locales/es/messages.json']);
    expect(t('connectButton')).toBe('Conectar con Aplica');
    // Clave que falta en el diccionario: cae en el navegador.
    expect(t('otra')).toBe('navegador');
  });

  it('si la carga falla, no cambia nada', async () => {
    stubBrowser((key) => `navegador:${key}`);
    expect(await loadLocale('en', () => Promise.reject(new Error('sin red')))).toBe(false);
    expect(await loadLocale('en', () => Promise.resolve('no es un diccionario'))).toBe(false);
    expect(t('x')).toBe('navegador:x');
  });

  it('resetLocale vuelve al idioma del navegador', async () => {
    stubBrowser((key) => `navegador:${key}`);
    await loadLocale('es', () => Promise.resolve({ x: { message: 'propio' } }));
    resetLocale();
    expect(t('x')).toBe('navegador:x');
  });

  it('solo es y en son idiomas válidos', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('locale store', () => {
  function memoryArea(): chrome.storage.LocalStorageArea {
    const data: Record<string, unknown> = {};
    return {
      get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
      set: (items: Record<string, unknown>) => {
        Object.assign(data, items);
        return Promise.resolve();
      },
      remove: (key: string) => {
        Reflect.deleteProperty(data, key);
        return Promise.resolve();
      },
    } as unknown as chrome.storage.LocalStorageArea;
  }

  it('guarda solo un idioma válido, y se borra', async () => {
    const area = memoryArea();
    const store = createLocaleStore(area);
    expect(await store.get()).toBeNull();
    await store.set('en');
    expect(await store.get()).toBe('en');
    await area.set({ 'aplica.locale': 'klingon' });
    expect(await store.get()).toBeNull();
    await store.set('es');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
