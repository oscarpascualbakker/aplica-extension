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

/**
 * Workable con dominio propio de la empresa (CV-543): la careers page cuelga de `/_/` y cada oferta de
 * `/_/j/<código>/` (con `/apply/` el formulario). En `apply.workable.com` la ruta lleva el nombre de la
 * empresa en lugar de `_`, y ya la cubre su dominio.
 */
const WORKABLE_OWN_DOMAIN_PATH = /^\/_\/j\/[A-Za-z0-9]+(\/|$)/;

/** ¿La URL es de uno de los dominios de los siete ATS (los que se piden como permiso opcional)? */
export function isKnownAtsHost(url: string | undefined | null): boolean {
  return atsFromUrl(url, false) !== null;
}

/**
 * El ATS de una URL, o null si no es uno de los siete (o no es http/https). Con `byStructure` (por defecto)
 * reconoce también Workable en el dominio propio de la empresa, por la forma de su ruta (CV-543). Ese
 * dominio no se puede declarar en el manifiesto: ahí no hay permiso opcional y solo vale `activeTab`.
 */
export function atsFromUrl(url: string | undefined | null, byStructure = true): AtsKey | null {
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
  if (byStructure && WORKABLE_OWN_DOMAIN_PATH.test(parsed.pathname)) return 'workable';
  return null;
}

/**
 * El ATS por la estructura de la página, para los que viven en un dominio propio de la empresa (CV-543).
 * Hoy solo Workable: su careers page y su formulario llevan `data-ui` propios. Mira un atributo estable,
 * nunca el texto.
 */
export function atsFromDocument(doc: Document): AtsKey | null {
  if (doc.querySelector('[data-ui="careers-page-content"], form[data-ui="application-form"]')) return 'workable';
  return null;
}

/**
 * Adaptadores: lo que la detección genérica (etiquetas, aria, placeholder, nombre) no resuelve por sí
 * sola. Cada regla mira un atributo exacto del campo. Los nombres salen de las páginas reales capturadas
 * en noviembre de 2026 (CV-543), con "Export page"; Greenhouse y Lever se comprobaron antes contra sus
 * formularios públicos.
 *
 * - `skip`: campos de la página que no son de contacto aunque lo parezcan (el historial de Workday, su
 *   segundo apellido); no se rellenan ni se marcan.
 * - `cvSelector`: el campo de archivo del CV. Se prueba contra el propio campo y contra los elementos que
 *   lo contienen, también a través de shadow roots (SmartRecruiters pone su atributo en el host).
 * - `strictCv`: si el selector no encuentra nada, no se adivina otro campo de archivo (SmartRecruiters
 *   tiene uno para el CV, otro para "adjuntos adicionales" y otro para la foto).
 */
export type AdapterRule = { attr: string; pattern: RegExp; kind: FieldKind };
export type Adapter = { rules: readonly AdapterRule[]; cvSelector: string; skip?: string; strictCv?: boolean };

export const ADAPTERS: Record<AtsKey, Adapter> = {
  workday: {
    rules: [
      // Los campos de Workday no llevan data-automation-id (lo llevan sus contenedores): se reconocen por name.
      { attr: 'name', pattern: /^legalName--firstName$/, kind: 'firstName' },
      { attr: 'name', pattern: /^legalName--lastName$/, kind: 'lastName' },
      { attr: 'name', pattern: /^phoneNumber$/, kind: 'phone' },
      { attr: 'name', pattern: /^city$/, kind: 'city' },
      // El email solo se pide al crear la cuenta, y ahí sí lleva data-automation-id.
      { attr: 'data-automation-id', pattern: /^email$/, kind: 'email' },
    ],
    cvSelector: 'input[type="file"][data-automation-id="file-upload-input-ref"]',
    skip: '[id^="workExperience-"], [id^="education-"], [id$="--secondaryLastName"]',
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
    // Los campos viven dentro de shadow roots y no llevan name: se reconocen por id.
    rules: [
      { attr: 'id', pattern: /^first-name-input$/, kind: 'firstName' },
      { attr: 'id', pattern: /^last-name-input$/, kind: 'lastName' },
      { attr: 'id', pattern: /^(confirm-)?email-input$/, kind: 'email' },
      { attr: 'id', pattern: /^linkedin-input$/, kind: 'linkedin' },
    ],
    // El host de la sección "Resume". La zona de arriba (autorrellenar con un CV) analiza el archivo y
    // reescribe el formulario: no es el CV de la candidatura.
    cvSelector: 'spl-dropzone[data-test="resume-upload"]',
    strictCv: true,
  },
  workable: {
    rules: [
      { attr: 'data-ui', pattern: /^firstname$/, kind: 'firstName' },
      { attr: 'data-ui', pattern: /^lastname$/, kind: 'lastName' },
      { attr: 'data-ui', pattern: /^email$/, kind: 'email' },
      // El teléfono lleva el data-ui en su contenedor, no en el campo.
      { attr: 'name', pattern: /^phone$/, kind: 'phone' },
      { attr: 'data-ui', pattern: /^address$/, kind: 'location' },
    ],
    cvSelector: 'input[type="file"][data-ui="resume"]',
  },
  teamtailor: {
    rules: [
      { attr: 'name', pattern: /^candidate\[first_name\]$/, kind: 'firstName' },
      { attr: 'name', pattern: /^candidate\[last_name\]$/, kind: 'lastName' },
      { attr: 'name', pattern: /^candidate\[email\]$/, kind: 'email' },
      { attr: 'name', pattern: /^candidate\[phone\]$/, kind: 'phone' },
      { attr: 'name', pattern: /^candidate\[linkedin\]$/, kind: 'linkedin' },
    ],
    // El campo de archivo no lleva name (lo lleva un input oculto aparte): se reconoce por id.
    cvSelector: 'input[type="file"]#candidate_resume_remote_url',
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
    // Hay un campo para el CV y otro "Otro" (certificados): el CV es el de `documents.cv`.
    cvSelector: 'input[type="file"][name="documents.cv"]',
  },
};
