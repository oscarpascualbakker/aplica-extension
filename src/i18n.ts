// Todo texto visible sale de t() (CV-503). Punto único de entrada.
//
// CV-504: el panel sigue el `locale` de la cuenta (lo devuelve /me), no el del navegador.
// i18n.getMessage solo conoce el idioma del navegador, así que con sesión iniciada los textos
// se cargan de _locales/<locale>/messages.json con un cargador propio. Sin sesión (o sin
// diccionario cargado) se usa i18n.getMessage, como hasta ahora.

import { extensionApi } from './browser';

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

type Entry = { message: string; placeholders?: Record<string, { content: string }> };
export type Dictionary = Record<string, Entry>;

let dictionary: Dictionary | null = null;
let current: Locale | null = null;

/** Sustituye $NOMBRE$ por el contenido del placeholder ($1 a $9 son los argumentos) y $$ por $. */
export function formatMessage(entry: Entry, substitutions?: string | string[]): string {
  const args = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const placeholders = Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value.content]),
  );
  const withArgs = (content: string): string =>
    content.replace(/\$([1-9])/g, (_, n: string) => args[Number(n) - 1] ?? '');
  return entry.message.replace(/\$([A-Za-z0-9_@]+)\$|\$\$/g, (match, name: string | undefined) => {
    if (name === undefined) return '$';
    const content = placeholders[name.toLowerCase()];
    return content === undefined ? match : withArgs(content);
  });
}

function isDictionary(value: unknown): value is Dictionary {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Carga los textos del idioma. Si falla, se queda con el diccionario anterior (o el del navegador). */
export async function loadLocale(
  locale: Locale,
  fetchJson: (path: string) => Promise<unknown> = async (path) => {
    const response = await fetch(extensionApi().runtime.getURL(path));
    return (await response.json()) as unknown;
  },
): Promise<boolean> {
  try {
    const loaded = await fetchJson(`_locales/${locale}/messages.json`);
    if (!isDictionary(loaded)) return false;
    dictionary = loaded;
    current = locale;
    return true;
  } catch {
    return false;
  }
}

/**
 * El idioma en el que se ve el panel (CV-544): el de la cuenta si hay uno cargado y, si no, el del
 * navegador (español si empieza por `es`, inglés en el resto). Sirve para enlazar la página de Aplica
 * en el mismo idioma.
 */
export function currentLocale(): Locale {
  if (current) return current;
  const api = extensionApi() as { i18n: { getUILanguage?: () => string } };
  const ui = api.i18n.getUILanguage?.() ?? (typeof navigator === 'undefined' ? '' : navigator.language);
  return ui.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Vuelve al idioma del navegador (sin sesión). */
export function resetLocale(): void {
  dictionary = null;
  current = null;
}

/**
 * Una fecha `YYYY-MM-DD` escrita en el idioma de la cuenta (CV-508): "30 de noviembre de 2026" o
 * "30 November 2026" (en-GB). Sin idioma cargado, el del navegador.
 */
export function formatDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  const locale = current === 'en' ? 'en-GB' : current === 'es' ? 'es-ES' : undefined;
  return new Date(year, month - 1, day).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function t(key: string, substitutions?: string | string[]): string {
  const entry = dictionary?.[key];
  if (entry) return formatMessage(entry, substitutions);
  return extensionApi().i18n.getMessage(key, substitutions) || key;
}
