// Los ATS donde se puede rellenar (CV-507): dominios, permisos de host opcionales y adaptadores.
//
// Los patrones de ORIGINS son los mismos que `optional_host_permissions` de scripts/manifest.mjs
// (un test comprueba que no se desvían). Solo se piden cuando la persona activa el autorrelleno.
// Fuera de estos dominios no hay autorrelleno: queda la copia de datos desde el panel.

import type { AtsKey, FieldKind } from './types';

export const ATS_ORIGINS: Record<AtsKey, readonly string[]> = {
  workday: ['*://*.myworkdayjobs.com/*', '*://*.myworkdaysite.com/*'],
  greenhouse: ['*://boards.greenhouse.io/*', '*://job-boards.greenhouse.io/*', '*://job-boards.eu.greenhouse.io/*'],
  lever: ['*://jobs.lever.co/*', '*://jobs.eu.lever.co/*'],
  smartrecruiters: ['*://jobs.smartrecruiters.com/*'],
  workable: ['*://apply.workable.com/*'],
  teamtailor: ['*://*.teamtailor.com/*'],
  personio: ['*://*.jobs.personio.de/*', '*://*.jobs.personio.com/*'],
};

/** `*://*.dominio/*` (cualquier subdominio) o `*://host/*` (solo ese host). Solo http y https. */
function hostMatches(pattern: string, host: string): boolean {
  const domain = pattern.slice('*://'.length, pattern.indexOf('/*', 4));
  if (domain.startsWith('*.')) return host.endsWith(domain.slice(1));
  return host === domain;
}

/** El ATS de una URL, o null si no es uno de los siete (o no es http/https). */
export function atsFromUrl(url: string | undefined | null): AtsKey | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  for (const [ats, patterns] of Object.entries(ATS_ORIGINS) as [AtsKey, readonly string[]][]) {
    if (patterns.some((pattern) => hostMatches(pattern, host))) return ats;
  }
  return null;
}

/**
 * Adaptadores: lo que la detección genérica (etiquetas, aria, placeholder, nombre) no resuelve por sí
 * sola. Cada regla mira un atributo exacto del campo. Los nombres salen de la estructura conocida de
 * cada ATS (ver README: Workday, Workable y SmartRecruiters, provisionales hasta capturar la página real).
 */
export type AdapterRule = { attr: string; pattern: RegExp; kind: FieldKind };
export type Adapter = { rules: readonly AdapterRule[]; cvSelector: string };

export const ADAPTERS: Record<AtsKey, Adapter> = {
  workday: {
    rules: [
      { attr: 'data-automation-id', pattern: /^legalNameSection_firstName$/, kind: 'firstName' },
      { attr: 'data-automation-id', pattern: /^legalNameSection_lastName$/, kind: 'lastName' },
      { attr: 'data-automation-id', pattern: /^email$/, kind: 'email' },
      { attr: 'data-automation-id', pattern: /^phone-number$/, kind: 'phone' },
      { attr: 'data-automation-id', pattern: /^addressSection_city$/, kind: 'city' },
    ],
    cvSelector: 'input[type="file"][data-automation-id="file-upload-input-ref"]',
  },
  greenhouse: {
    rules: [
      { attr: 'id', pattern: /^first_name$/, kind: 'firstName' },
      { attr: 'id', pattern: /^last_name$/, kind: 'lastName' },
      { attr: 'id', pattern: /^email$/, kind: 'email' },
      { attr: 'id', pattern: /^phone$/, kind: 'phone' },
      { attr: 'id', pattern: /^candidate-location$/, kind: 'location' },
    ],
    cvSelector: 'input[type="file"]#resume, input[type="file"][name="resume"]',
  },
  lever: {
    rules: [
      { attr: 'name', pattern: /^name$/, kind: 'fullName' },
      { attr: 'name', pattern: /^email$/, kind: 'email' },
      { attr: 'name', pattern: /^phone$/, kind: 'phone' },
      { attr: 'name', pattern: /^org$/, kind: 'currentCompany' },
      { attr: 'name', pattern: /^location$/, kind: 'location' },
      { attr: 'name', pattern: /^urls\[linkedin\]$/i, kind: 'linkedin' },
      { attr: 'name', pattern: /^urls\[github\]$/i, kind: 'github' },
      { attr: 'name', pattern: /^urls\[(portfolio|other)\]$/i, kind: 'website' },
    ],
    cvSelector: 'input[type="file"][name="resume"]',
  },
  smartrecruiters: {
    rules: [
      { attr: 'name', pattern: /^firstName$/, kind: 'firstName' },
      { attr: 'name', pattern: /^lastName$/, kind: 'lastName' },
      { attr: 'name', pattern: /^(confirmEmail|email)$/, kind: 'email' },
      { attr: 'name', pattern: /^phoneNumber$/, kind: 'phone' },
      { attr: 'name', pattern: /^city$/, kind: 'city' },
    ],
    cvSelector: 'input[type="file"]',
  },
  workable: {
    rules: [
      { attr: 'data-ui', pattern: /^firstname$/, kind: 'firstName' },
      { attr: 'data-ui', pattern: /^lastname$/, kind: 'lastName' },
      { attr: 'data-ui', pattern: /^email$/, kind: 'email' },
      { attr: 'data-ui', pattern: /^phone$/, kind: 'phone' },
      { attr: 'data-ui', pattern: /^address$/, kind: 'location' },
    ],
    cvSelector: 'input[type="file"][data-ui="resume"], input[type="file"][name="resume"]',
  },
  teamtailor: {
    rules: [
      { attr: 'name', pattern: /^candidate\[first_name\]$/, kind: 'firstName' },
      { attr: 'name', pattern: /^candidate\[last_name\]$/, kind: 'lastName' },
      { attr: 'name', pattern: /^candidate\[email\]$/, kind: 'email' },
      { attr: 'name', pattern: /^candidate\[phone\]$/, kind: 'phone' },
      { attr: 'name', pattern: /^candidate\[linkedin\]$/, kind: 'linkedin' },
    ],
    cvSelector: 'input[type="file"][name="candidate[resume]"]',
  },
  personio: {
    rules: [
      { attr: 'name', pattern: /^first_name$/, kind: 'firstName' },
      { attr: 'name', pattern: /^last_name$/, kind: 'lastName' },
      { attr: 'name', pattern: /^email$/, kind: 'email' },
      { attr: 'name', pattern: /^phone$/, kind: 'phone' },
      { attr: 'name', pattern: /^location$/, kind: 'location' },
      { attr: 'name', pattern: /^linkedin$/, kind: 'linkedin' },
    ],
    cvSelector: 'input[type="file"][name="cv"], input[type="file"][name="resume"]',
  },
};
