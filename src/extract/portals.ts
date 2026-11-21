// Extractores por portal (CV-504). Se usan solo cuando el JSON-LD no existe o le falta algo:
// completan puesto, empresa, descripción, ubicación, modalidad y salario con los selectores
// que cada portal publica en su HTML. Los selectores salen de páginas reales descargadas
// (fixtures en tests/fixtures, con datos ficticios). Portales sin fixture real no tienen
// extractor propio: los cubren el JSON-LD y la selección.
//
// La modalidad solo se deduce de etiquetas claras o atributos estructurados, nunca del texto
// libre de la oferta.

import { elementToText, inlineText } from './text';
import type { OfferFields, PortalKey, WorkMode } from './types';

export type PortalExtractor = (doc: Document) => Partial<OfferFields>;

/** Clave del portal por el hostname de la pestaña. */
export function portalFromHost(hostname: string): PortalKey {
  const host = hostname.toLowerCase();
  const is = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
  if (is('linkedin.com')) return 'linkedin';
  if (is('infojobs.net')) return 'infojobs';
  if (is('indeed.com')) return 'indeed';
  if (is('infoempleo.com')) return 'infoempleo';
  if (is('tecnoempleo.com')) return 'tecnoempleo';
  if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) return 'glassdoor';
  if (is('myworkdayjobs.com')) return 'workday';
  if (is('greenhouse.io')) return 'greenhouse';
  if (is('lever.co')) return 'lever';
  if (is('smartrecruiters.com')) return 'smartrecruiters';
  if (is('workable.com')) return 'workable';
  if (is('teamtailor.com')) return 'teamtailor';
  if (is('personio.de') || is('personio.com')) return 'personio';
  if (is('factorialhr.com') || is('factorialhr.es') || /(^|\.)factorial\.(com|co)$/.test(host)) return 'factorial';
  return 'other';
}

function textOf(doc: ParentNode, selector: string): string {
  const el = doc.querySelector(selector);
  return el ? inlineText(el.textContent) : '';
}

function attrOf(doc: ParentNode, selector: string, attribute: string): string {
  return inlineText(doc.querySelector(selector)?.getAttribute(attribute));
}

/** Descripción de varios bloques, uno tras otro. */
function blocksText(blocks: Element[]): string {
  return blocks.map((block) => elementToText(block)).filter(Boolean).join('\n\n');
}

/** Modalidad a partir de una etiqueta clara del portal (o un valor de atributo estructurado). */
export function workModeFromLabel(label: string): WorkMode | null {
  const value = label.toLowerCase().replace(/[\s_-]+/g, '');
  if (['onsite', 'presencial', 'enoficina'].includes(value)) return 'presencial';
  if (['hybrid', 'hibrido', 'híbrido'].includes(value)) return 'hibrido';
  if (['remote', 'remoto', 'teletrabajo'].includes(value)) return 'remoto';
  return null;
}

const greenhouse: PortalExtractor = (doc) => {
  const titleTag = textOf(doc, 'title');
  const atCompany = /^Job Application for .+ at (.+)$/.exec(titleTag)?.[1] ?? '';
  const logo = attrOf(doc, 'img[alt$=" Logo"]', 'alt').replace(/ Logo$/, '');
  const description = doc.querySelector('.job__description');
  return {
    title: textOf(doc, '.job__title h1'),
    company: logo || inlineText(atCompany),
    location: textOf(doc, '.job__location div'),
    description: description ? elementToText(description) : '',
  };
};

const lever: PortalExtractor = (doc) => {
  const logo = attrOf(doc, '.main-header-logo img', 'alt').replace(/ logo$/i, '');
  const sections = Array.from(doc.querySelectorAll('.posting-page .section.page-centered')).filter(
    (el) => !el.classList.contains('posting-header') && !el.classList.contains('last-section-apply'),
  );
  return {
    title: textOf(doc, '.posting-headline h2'),
    company: logo,
    location: textOf(doc, '.posting-categories .location'),
    workMode: workModeFromLabel(textOf(doc, '.posting-categories .workplaceTypes')),
    description: blocksText(sections),
  };
};

const smartrecruiters: PortalExtractor = (doc) => {
  const parts = ['addressLocality', 'addressRegion', 'addressCountry']
    .map((prop) => attrOf(doc, `[itemprop="${prop}"]`, 'content'))
    .filter(Boolean);
  const description = doc.querySelector('[itemprop="description"]');
  return {
    title: textOf(doc, '[itemprop="title"]'),
    company: attrOf(doc, '[itemprop="hiringOrganization"] [itemprop="name"]', 'content'),
    location: [...new Set(parts)].join(', '),
    workMode: workModeFromLabel(attrOf(doc, 'spl-job-location', 'workplacetype')),
    description: description ? elementToText(description) : '',
  };
};

const teamtailor: PortalExtractor = (doc) => {
  const description = doc.querySelector('main .prose');
  return {
    title: textOf(doc, 'main h1'),
    company: attrOf(doc, 'meta[property="og:site_name"]', 'content'),
    description: description ? elementToText(description) : '',
  };
};

const personio: PortalExtractor = (doc) => {
  const items = Array.from(doc.querySelectorAll('.jb-description-item')).map((item) => {
    const heading = textOf(item, '.detail-block-title');
    const body = item.querySelector('.detail-block-description');
    return [heading, body ? elementToText(body) : ''].filter(Boolean).join('\n\n');
  });
  return {
    title: textOf(doc, 'h1.job-position-title'),
    company: attrOf(doc, '.logo-wrapper img', 'alt') || attrOf(doc, 'a.logo-wrapper', 'aria-label'),
    location: textOf(doc, '[class*="TruncatedLocations_locationText"]'),
    description: items.filter(Boolean).join('\n\n'),
  };
};

const factorial: PortalExtractor = (doc) => {
  const description = doc.querySelector('.styledText');
  return {
    title: textOf(doc, 'h1'),
    company: attrOf(doc, 'img.topNav__logo', 'alt').replace(/ logo$/i, ''),
    description: description ? elementToText(description) : '',
  };
};

/** Valor de un `li.list-item` de Tecnoempleo a partir de su etiqueta ("Ubicación", "Salario"). */
function tecnoempleoItem(doc: Document, label: string): string {
  for (const li of Array.from(doc.querySelectorAll('li.list-item'))) {
    const spans = Array.from(li.querySelectorAll(':scope > span'));
    const last = spans[spans.length - 1];
    if (last && inlineText(last.textContent) === label) return inlineText(spans[0]?.textContent);
  }
  return '';
}

const tecnoempleo: PortalExtractor = (doc) => {
  const heading = doc.querySelector('h1[itemprop="title"]');
  const clone = heading?.cloneNode(true) as Element | undefined;
  clone?.querySelectorAll('.badge').forEach((badge) => {
    badge.remove();
  });
  const description = doc.querySelector('[itemprop="description"] > div');
  return {
    title: inlineText(clone?.textContent),
    company: textOf(doc, 'a[href*="/re-"] > [itemprop="name"]'),
    location: tecnoempleoItem(doc, 'Ubicación'),
    salary: tecnoempleoItem(doc, 'Salario'),
    description: description ? elementToText(description) : '',
  };
};

const infoempleo: PortalExtractor = (doc) => {
  const location = textOf(doc, 'ul.details li.block');
  let title = textOf(doc, '.main-title h1');
  // El h1 de Infoempleo termina en " en <ubicación>".
  if (location && title.endsWith(` en ${location}`)) title = title.slice(0, -` en ${location}`.length);
  const offer = doc.querySelector('.offer')?.cloneNode(true) as Element | undefined;
  offer?.querySelectorAll('h3.l1-hide').forEach((heading) => {
    heading.remove();
  });
  let salary = '';
  for (const li of Array.from(doc.querySelectorAll('.offer-excerpt li'))) {
    if (textOf(li, 'h3') === 'Salario') salary = textOf(li, 'p');
  }
  return {
    title,
    company: textOf(doc, '.companyname a'),
    location,
    salary: /\d/.test(salary) ? salary : '',
    description: offer ? elementToText(offer) : '',
  };
};

// Página de invitado de LinkedIn (/jobs/view/<id> sin sesión). El DOM con sesión iniciada no
// se ha capturado todavía: ver README (portales pendientes de fixture).
const linkedin: PortalExtractor = (doc) => {
  const description = doc.querySelector('.show-more-less-html__markup');
  return {
    title: textOf(doc, 'h1.top-card-layout__title'),
    company: textOf(doc, '.topcard__org-name-link'),
    location: textOf(doc, '.topcard__flavor--bullet'),
    description: description ? elementToText(description) : '',
  };
};

export const EXTRACTORS: Partial<Record<PortalKey, PortalExtractor>> = {
  greenhouse,
  lever,
  smartrecruiters,
  teamtailor,
  personio,
  factorial,
  tecnoempleo,
  infoempleo,
  linkedin,
};
