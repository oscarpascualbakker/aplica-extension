// Adaptador de navegador (CV-503). En Chrome y Edge, `chrome.*` devuelve promesas (MV3).
// En Firefox, `browser.*` es el espacio con promesas; `chrome.*` solo admite callbacks en
// algunas APIs. Por eso se usa `browser` si existe y `chrome` si no: sin polyfill y sin
// dependencias de ejecución. Solo se usa el subconjunto con promesas en ambos.

export type BrowserName = 'chrome' | 'edge' | 'firefox';

type Api = typeof chrome;

export function extensionApi(): Api {
  const scope = globalThis as unknown as { browser?: Api; chrome?: Api };
  const api = scope.browser ?? scope.chrome;
  if (!api) throw new Error('No extension API available');
  return api;
}

/** Edge se detecta por `userAgentData` o por `Edg/` en el UA; Firefox por el esquema moz-extension. */
export function detectBrowser(
  extensionUrl: string,
  nav: { userAgent: string; userAgentData?: { brands: { brand: string }[] } },
): BrowserName {
  if (extensionUrl.startsWith('moz-extension:')) return 'firefox';
  const brands = nav.userAgentData?.brands ?? [];
  if (brands.some((b) => b.brand === 'Microsoft Edge')) return 'edge';
  if (/\bEdg\//.test(nav.userAgent)) return 'edge';
  return 'chrome';
}
