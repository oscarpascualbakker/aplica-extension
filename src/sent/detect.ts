// Detección de la página de confirmación de un ATS (CV-508, D-220). Función pura sobre un Document para
// probarla con fixtures; la carga en la página la hace inject.ts.
//
// Solo en los siete ATS del autorrelleno (src/fill/ats.ts). Cada ATS tiene su regla: la URL de su página de
// confirmación, un elemento propio de esa página o un titular que dice que la candidatura se ha enviado
// ("Gracias por tu candidatura", "Application submitted"). Mientras la página siga teniendo el formulario
// (un campo de email o de archivo), no es la confirmación: así la oferta y el formulario nunca dan positivo.
//
// No envía nada ni toca la página: solo lee. La regla de Workday sale de la captura real de su confirmación
// (noviembre de 2026, CV-543). Las de Workable, SmartRecruiters, Teamtailor y Personio siguen siendo las de la
// estructura conocida de sus páginas: son provisionales hasta capturar las reales (CV-556).

import { atsFromDocument, atsFromUrl } from '../fill/ats';
import type { AtsKey } from '../fill/types';
import { MAX_FIELD } from '../extract/types';
import { clip, inlineText } from '../extract/text';

export type Confirmation = {
  ats: AtsKey;
  /** El enlace de la oferta, sacado de la URL de la confirmación. */
  offerUrl: string;
  /** Puesto y empresa si la página los dice; si no, vacíos (la persona los puede escribir en el panel). */
  title: string;
  company: string;
};

type Rule = {
  /** Ruta de la página de confirmación: si coincide, es la confirmación. */
  path?: RegExp;
  /** Un elemento que solo existe en la confirmación de ese ATS. */
  selector?: string;
  /** De la ruta de la confirmación (o del formulario) a la de la oferta. */
  offerPath(path: string): string;
  /** Puesto y empresa de la página, si los dice. */
  names(doc: Document): { title: string; company: string };
};

/**
 * Frases de un titular de confirmación, ya en minúsculas y sin tildes. En español y en inglés, como el resto
 * de la extensión. Solo frases que dicen que la candidatura está enviada: nunca "gracias por tu interés", que
 * sale en las propias ofertas.
 */
export const CONFIRMATION_PHRASES: readonly string[] = [
  'gracias por tu candidatura',
  'gracias por su candidatura',
  'gracias por enviar tu candidatura',
  'gracias por presentar tu candidatura',
  'gracias por tu solicitud',
  'gracias por su solicitud',
  'gracias por postularte',
  'gracias por aplicar',
  'hemos recibido tu candidatura',
  'hemos recibido su candidatura',
  'hemos recibido tu solicitud',
  'hemos recibido su solicitud',
  'candidatura enviada',
  'solicitud enviada',
  'tu candidatura se ha enviado',
  'tu solicitud se ha enviado',
  'thank you for applying',
  'thanks for applying',
  'thank you for your application',
  'thanks for your application',
  'thank you for submitting your application',
  'application submitted',
  'application received',
  'application has been submitted',
  'application has been received',
  'application was submitted',
  'we have received your application',
  "we've received your application",
  'we received your application',
];

/** Dónde se mira el titular: encabezados y avisos, no el cuerpo de la página. */
const HEADLINES = 'h1, h2, h3, [role="heading"], [role="alert"], [role="status"]';
/** Un titular es corto; un bloque largo es texto de la oferta, que puede citar estas frases. */
const MAX_HEADLINE = 200;

function normalize(text: string | null | undefined): string {
  return inlineText(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .toLowerCase();
}

/** ¿Algún titular de la página dice que la candidatura se ha enviado? */
export function headlineConfirms(doc: Document): boolean {
  for (const node of Array.from(doc.querySelectorAll(HEADLINES))) {
    const text = normalize(node.textContent);
    if (text.length === 0 || text.length > MAX_HEADLINE) continue;
    if (CONFIRMATION_PHRASES.some((phrase) => text.includes(phrase))) return true;
  }
  return false;
}

/** ¿La página sigue teniendo el formulario de la candidatura? Entonces no es la confirmación. */
export function hasApplicationForm(doc: Document): boolean {
  return doc.querySelector('input[type="file"], input[type="email"]') !== null;
}

function text(doc: Document, selector: string): string {
  return inlineText(doc.querySelector(selector)?.textContent);
}

function meta(doc: Document, property: string): string {
  return inlineText(doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content'));
}

/** "Puesto at Empresa" o "Job Application for Puesto at Empresa" (Greenhouse). */
function titleAtCompany(value: string): { title: string; company: string } | null {
  const match = /^(?:job application for\s+)?(.+?)\s+at\s+(.+)$/i.exec(value);
  return match ? { title: match[1] ?? '', company: match[2] ?? '' } : null;
}

/** "Empresa - Puesto" (Lever). */
function companyDashTitle(value: string): { title: string; company: string } | null {
  const match = /^(.+?)\s+[-–|]\s+(.+)$/.exec(value);
  return match ? { title: match[2] ?? '', company: match[1] ?? '' } : null;
}

const none = (): { title: string; company: string } => ({ title: '', company: '' });

/** Recorta la ruta en el primer segmento que ya no es de la oferta. */
function cutAt(path: string, pattern: RegExp): string {
  const match = pattern.exec(path);
  return match ? path.slice(0, match.index) : path;
}

/**
 * ATS cuya página de confirmación no dice de qué oferta es (CV-543). Workday navega a
 * `/<idioma>/<sitio>/jobTasks/completed/application`, sin la ruta de la oferta ni su título: la misma
 * dirección para todas las candidaturas del sitio. Ahí la oferta solo se conoce si el panel la vio antes en
 * esa pestaña (la oferta leída, guardada o encontrada, `Remembered`); si no, no se propone nada, porque con
 * la dirección del sitio todas las candidaturas se confundirían entre sí. Limitación conocida.
 */
export const OFFER_NOT_IN_CONFIRMATION: readonly AtsKey[] = ['workday'];

export const CONFIRMATION_RULES: Record<AtsKey, Rule> = {
  // https://job-boards.greenhouse.io/<empresa>/jobs/<id>/confirmation
  greenhouse: {
    path: /\/jobs\/\d+\/confirmation\/?$/,
    offerPath: (path) => cutAt(path, /\/confirmation\/?$/),
    names: (doc) => titleAtCompany(text(doc, 'title')) ?? { title: text(doc, '.job__title h1, .app-title'), company: text(doc, '.company-name') },
  },
  // https://jobs.lever.co/<empresa>/<uuid>/thanks
  lever: {
    path: /^\/[^/]+\/[0-9a-f-]{36}\/thanks\/?$/i,
    offerPath: (path) => cutAt(path, /\/(thanks|apply)\/?$/),
    names: (doc) => companyDashTitle(text(doc, 'title')) ?? none(),
  },
  // https://<empresa>.wd3.myworkdayjobs.com/<idioma>/<sitio>/jobTasks/completed/application: tras enviar, Workday
  // navega ahí y abre un diálogo (candidateHomeTaskModal) con "Application Submitted". La página no lleva la
  // oferta (ver OFFER_NOT_IN_CONFIRMATION): `offerPath` da la raíz del sitio y la oferta sale de lo recordado.
  workday: {
    path: /\/jobTasks\/completed\/application\/?$/,
    offerPath: (path) => cutAt(path, /\/jobTasks(\/|$)/),
    names: none,
  },
  // https://apply.workable.com/<empresa>/j/<código>/apply/ (o <dominio propio>/_/j/<código>/apply/) → aviso de
  // enviado en la misma ruta.
  workable: {
    selector: '[data-ui="application-success"], [data-ui="application-form-success"]',
    offerPath: (path) => {
      const match = /^\/[^/]+\/j\/[^/]+/.exec(path);
      return match ? `${match[0]}/` : path;
    },
    // La empresa, del logo de la cabecera si la página no la dice en og:site_name.
    names: (doc) => ({ title: text(doc, '[data-ui="job-title"]'), company: meta(doc, 'og:site_name') || inlineText(doc.querySelector('[data-ui="company-logo"] img')?.getAttribute('alt')) }),
  },
  // https://jobs.smartrecruiters.com/oneclick-ui/company/<Empresa>/publication/<uuid>/...
  smartrecruiters: {
    path: /\/(confirmation|thank-you|success)\/?$/,
    offerPath: (path) => cutAt(path, /\/(confirmation|thank-you|success|apply)\/?$/),
    names: (doc) => ({ title: text(doc, '[data-test="job-title"], .job-title'), company: meta(doc, 'og:site_name') }),
  },
  // https://<empresa>.teamtailor.com/jobs/<id>-<slug>/applications/... → página de gracias.
  teamtailor: {
    path: /^\/jobs\/[^/]+\/applications\/(thank-you|thanks|[^/]+\/thanks)\/?$/,
    offerPath: (path) => cutAt(path, /\/applications(\/|$)/),
    names: (doc) => ({ title: text(doc, '[data-job-title], .job-title'), company: meta(doc, 'og:site_name') }),
  },
  // https://<empresa>.jobs.personio.de/job/<id>?... → aviso de enviado en la misma ruta.
  personio: {
    selector: '[data-test-id="application-success"], .application-success',
    offerPath: (path) => {
      const match = /^\/job\/\d+/.exec(path);
      return match ? match[0] : path;
    },
    names: (doc) => ({ title: text(doc, '[data-test-id="job-title"], .job-title, h1.title'), company: meta(doc, 'og:site_name') }),
  },
};

/** El enlace de la oferta a partir de la URL de la confirmación: sin consulta ni fragmento. */
export function offerUrlFromConfirmation(ats: AtsKey, pageUrl: string): string {
  const url = new URL(pageUrl);
  return `${url.origin}${CONFIRMATION_RULES[ats].offerPath(url.pathname)}`;
}

/**
 * La confirmación de la página, o null si no lo es (o no es uno de los siete ATS). Primero descarta lo que
 * aún tiene formulario; después la regla del ATS (ruta o elemento propio) o un titular de confirmación.
 */
export function detectConfirmation(doc: Document, pageUrl: string): Confirmation | null {
  // Workable en el dominio propio de la empresa se reconoce por la estructura de la página (CV-543).
  const ats = atsFromUrl(pageUrl) ?? atsFromDocument(doc);
  if (!ats) return null;
  if (hasApplicationForm(doc)) return null;

  const rule = CONFIRMATION_RULES[ats];
  const path = new URL(pageUrl).pathname;
  const confirmed =
    (rule.path !== undefined && rule.path.test(path)) ||
    (rule.selector !== undefined && doc.querySelector(rule.selector) !== null) ||
    headlineConfirms(doc);
  if (!confirmed) return null;

  const names = rule.names(doc);
  return {
    ats,
    offerUrl: offerUrlFromConfirmation(ats, pageUrl),
    title: clip(inlineText(names.title), MAX_FIELD),
    company: clip(inlineText(names.company), MAX_FIELD),
  };
}
