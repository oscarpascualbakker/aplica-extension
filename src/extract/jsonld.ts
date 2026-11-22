// Lectura de schema.org/JobPosting en los <script type="application/ld+json"> (CV-504).
// Primer paso de la extracción: es el dato estructurado que publican los portales.

import { inlineText, htmlToText } from './text';
import type { OfferFields, WorkMode } from './types';

export type JsonLdOffer = Partial<OfferFields> & { url?: string };

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Aplana arrays y `@graph` en una lista de nodos. */
function nodes(value: Json, out: Record<string, Json>[] = []): Record<string, Json>[] {
  if (Array.isArray(value)) {
    for (const item of value) nodes(item, out);
  } else if (isRecord(value)) {
    out.push(value);
    if ('@graph' in value) nodes(value['@graph'], out);
  }
  return out;
}

function isJobPosting(node: Record<string, Json>): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && /(^|\/)JobPosting$/i.test(t));
}

function text(value: Json): string {
  return typeof value === 'string' ? inlineText(decode(value)) : '';
}

// Las entidades HTML en un campo de una línea (p. ej. "Ventas &amp; Marketing") se decodifican
// con el analizador de la página: no se evalúa nada.
let decoder: Document | null = null;
function decode(value: string): string {
  if (!value.includes('&') || !decoder) return value;
  const box = decoder.createElement('textarea');
  box.innerHTML = value;
  return box.value;
}

function named(value: Json): string {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return named(value[0]);
  if (isRecord(value)) return text(value.name);
  return '';
}

function place(value: Json): string {
  if (typeof value === 'string') return text(value);
  if (!isRecord(value)) return '';
  const address = isRecord(value.address) ? value.address : value;
  if (typeof value.address === 'string') return text(value.address);
  const country = isRecord(address.addressCountry) ? address.addressCountry.name : address.addressCountry;
  const parts = [address.addressLocality, address.addressRegion, country].map(text).filter(Boolean);
  const unique = parts.filter((part, i) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === i);
  return unique.join(', ');
}

function locations(value: Json): string {
  const list = Array.isArray(value) ? value : [value];
  const found = list.map(place).filter(Boolean);
  return [...new Set(found)].join('; ');
}

const UNITS: Record<string, { es: string; en: string }> = {
  HOUR: { es: 'hora', en: 'hour' },
  DAY: { es: 'día', en: 'day' },
  WEEK: { es: 'semana', en: 'week' },
  MONTH: { es: 'mes', en: 'month' },
  YEAR: { es: 'año', en: 'year' },
};

function amount(value: Json): number | null {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** `baseSalary` (valor o rango, con moneda y unidad) a texto legible, en el idioma de la página. */
function salary(value: Json, lang: 'es' | 'en'): string {
  if (!isRecord(value)) return '';
  const currency = text(value.currency);
  const detail = isRecord(value.value) ? value.value : value;
  const min = amount(detail.minValue);
  const max = amount(detail.maxValue);
  const single = amount(detail.value ?? (isRecord(value.value) ? null : value.value));
  const format = (n: number): string => new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB').format(n);
  let figures = '';
  if (min !== null && max !== null && min !== max) figures = `${format(min)} - ${format(max)}`;
  else if (min !== null || max !== null || single !== null) figures = format((min ?? max ?? single) as number);
  if (!figures) return '';
  const unit = UNITS[text(detail.unitText).toUpperCase()]?.[lang];
  return [figures, currency, unit ? `/ ${unit}` : ''].filter(Boolean).join(' ');
}

function workMode(node: Record<string, Json>): WorkMode | null {
  if (text(node.jobLocationType).toUpperCase() === 'TELECOMMUTE') return 'remoto';
  const requirements = node.applicantLocationRequirements;
  if (Array.isArray(requirements) ? requirements.length > 0 : requirements) return 'remoto';
  return null;
}

/** Primer JobPosting de la página, o null si no hay ninguno legible. JSON malformado: se ignora ese bloque. */
export function parseJsonLd(doc: Document): JsonLdOffer | null {
  decoder = doc.implementation.createHTMLDocument('');
  const lang = doc.documentElement.lang.toLowerCase().startsWith('es') ? 'es' : 'en';
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: Json;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const posting = nodes(data).find(isJobPosting);
    if (!posting) continue;
    const description = typeof posting.description === 'string' ? htmlToText(doc, posting.description) : '';
    return {
      title: text(posting.title) || text(posting.name),
      company: named(posting.hiringOrganization),
      location: locations(posting.jobLocation),
      workMode: workMode(posting),
      salary: salary(posting.baseSalary, lang),
      description,
      url: typeof posting.url === 'string' ? posting.url : undefined,
    };
  }
  return null;
}
