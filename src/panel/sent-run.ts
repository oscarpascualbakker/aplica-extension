// Registrar la candidatura como enviada (CV-508, D-220). Sin DOM: las dependencias entran por parámetro
// (pruebas).
//
// Con el panel abierto, al cargar una página de uno de los siete ATS, el panel inyecta detect.js. Si es la
// página de confirmación, busca la candidatura: primero la que el panel ya conocía de esa pestaña (la oferta
// que leyó o guardó antes en el mismo ATS); si no, la de la cuenta con el enlace de la oferta, o el puesto y
// la empresa (offers/match). Si no está en la cuenta, propone crearla ya como enviada. Nada cambia hasta que
// la persona pulsa: el aviso pregunta y un clic la marca.

import { STAGES_BEFORE_SENT, type ApiClient, type ApplicationRef, type OfferPayload } from '../api';
import { atsFromUrl } from '../fill/ats';
import { ATS_KEYS } from '../fill/types';
import type { ExtractedOffer } from '../extract/types';
import { OFFER_NOT_IN_CONFIRMATION, type Confirmation } from '../sent/detect';

/** Lo que el panel sabe de una pestaña mientras está abierto (solo en memoria, nunca en `storage.*`). */
export type Remembered = {
  /** La página donde lo supo (la oferta o el formulario). */
  pageUrl: string;
  /** La oferta leída en esa página, si se leyó. */
  offer: (ExtractedOffer & { url: string }) | null;
  /** Su candidatura en Aplica, si la hay. */
  application: ApplicationRef | null;
};

export type SentDeps = {
  /** Inyecta detect.js en la pestaña y devuelve lo que devuelve el script. */
  detect(tabId: number): Promise<unknown>;
};

/** Qué propone el aviso: una candidatura de la cuenta o una nueva con lo que se sabe de la oferta. */
export type SentCandidate =
  | { kind: 'existing'; application: ApplicationRef }
  | { kind: 'new'; offer: OfferPayload };

export type SentOutcome =
  | { status: 'done'; application: ApplicationRef; followUpAt: string | null }
  /** Ya estaba en una etapa posterior: no se toca. */
  | { status: 'later'; application: ApplicationRef }
  | { status: 'unauthenticated' }
  | { status: 'error'; key: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Valida lo que devuelve el script inyectado: solo se acepta el formato esperado. */
export function parseConfirmation(value: unknown): Confirmation | null {
  if (!isRecord(value)) return null;
  const { ats, offerUrl, title, company } = value;
  if (typeof ats !== 'string' || !(ATS_KEYS as readonly string[]).includes(ats)) return null;
  if (typeof offerUrl !== 'string' || !/^https?:\/\//i.test(offerUrl)) return null;
  if (typeof title !== 'string' || typeof company !== 'string') return null;
  return { ats: ats as Confirmation['ats'], offerUrl, title, company };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Lo recordado vale para esta página solo si es del mismo sitio del ATS (no se ha ido a otra oferta). */
function rememberedFor(remembered: Remembered | undefined, tabUrl: string): Remembered | null {
  if (!remembered) return null;
  const host = hostOf(tabUrl);
  return host !== null && host === hostOf(remembered.pageUrl) ? remembered : null;
}

/** Solo se propone si aún no se ha enviado: nunca se retrasa una candidatura que ya va más allá. */
function proposable(application: ApplicationRef): SentCandidate | null {
  return STAGES_BEFORE_SENT.includes(application.stage) ? { kind: 'existing', application } : null;
}

function newOffer(confirmation: Confirmation, offer: Remembered['offer']): OfferPayload {
  if (offer) {
    return {
      url: offer.url,
      title: offer.title,
      company: offer.company,
      location: offer.location,
      work_mode: offer.workMode,
      salary: offer.salary,
      description: offer.description,
      portal: offer.portal,
      force: false,
      sent: true,
    };
  }
  return {
    url: confirmation.offerUrl,
    title: confirmation.title,
    company: confirmation.company,
    location: '',
    work_mode: null,
    salary: '',
    description: '',
    portal: confirmation.ats,
    force: false,
    sent: true,
  };
}

/**
 * ¿Es la pestaña la confirmación de un ATS? Si lo es, la candidatura que propone el aviso; si no, o si la
 * candidatura ya está enviada o más allá, null. Solo lee: no cambia nada en la cuenta.
 */
export async function findSentCandidate(
  tabId: number,
  tabUrl: string,
  remembered: Remembered | undefined,
  token: string,
  client: ApiClient,
  deps: SentDeps,
): Promise<SentCandidate | 'unauthenticated' | null> {
  if (!atsFromUrl(tabUrl)) return null;
  let confirmation: Confirmation | null;
  try {
    confirmation = parseConfirmation(await deps.detect(tabId));
  } catch {
    // Sin permiso para esa página (o la pestaña se ha cerrado): no hay nada que avisar.
    return null;
  }
  if (!confirmation) return null;

  const known = rememberedFor(remembered, tabUrl);
  if (known?.application) return proposable(known.application);
  // Workday no dice la oferta en su confirmación: sin la oferta recordada, no se adivina (CV-543).
  if (!known?.offer && OFFER_NOT_IN_CONFIRMATION.includes(confirmation.ats)) return null;

  const query = {
    url: known?.offer?.url ?? confirmation.offerUrl,
    title: known?.offer?.title || confirmation.title,
    company: known?.offer?.company || confirmation.company,
  };
  const match = await client.matchOffer(token, query);
  if (!match.ok && match.kind === 'unauthenticated') return 'unauthenticated';
  if (match.ok && match.data) return proposable(match.data.application);
  // Sin coincidencia (o sin poder consultarla): se propone crearla; el servidor vuelve a mirar duplicados.
  return { kind: 'new', offer: newOffer(confirmation, known?.offer ?? null) };
}

async function markExisting(application: ApplicationRef, token: string, client: ApiClient): Promise<SentOutcome> {
  const result = await client.markSent(token, application.id);
  if (result.ok) return { status: 'done', application: result.data.application, followUpAt: result.data.followUpAt };
  switch (result.kind) {
    case 'stage':
      return { status: 'later', application: result.application };
    case 'unauthenticated':
      return { status: 'unauthenticated' };
    case 'insufficient_scope':
      return { status: 'error', key: 'errorScope' };
    case 'not_found':
      return { status: 'error', key: 'sentNotFound' };
    case 'network':
      return { status: 'error', key: 'errorNetwork' };
    case 'rate_limited':
      return { status: 'error', key: 'errorRateLimited' };
    default:
      return { status: 'error', key: 'errorServer' };
  }
}

/**
 * La persona ha pulsado "Marcarla como enviada". Una de la cuenta pasa a `enviada`; una nueva se guarda ya
 * como enviada con el puesto y la empresa que haya escrito. Si al guardarla resulta que ya estaba (mismo
 * enlace, o mismo puesto y empresa), se marca esa: es la misma candidatura y no se duplica.
 */
export async function confirmSent(
  candidate: SentCandidate,
  names: { title: string; company: string },
  token: string,
  client: ApiClient,
): Promise<SentOutcome> {
  if (candidate.kind === 'existing') return markExisting(candidate.application, token, client);

  const result = await client.saveOffer(token, { ...candidate.offer, title: names.title, company: names.company, sent: true });
  if (result.ok) return { status: 'done', application: result.data.application, followUpAt: result.data.followUpAt };
  switch (result.kind) {
    case 'duplicate':
      // El servidor decide: ya enviada no cambia nada; más allá, `later`.
      return markExisting(result.application, token, client);
    case 'unauthenticated':
      return { status: 'unauthenticated' };
    case 'invalid':
      return { status: 'error', key: 'invalidFields' };
    case 'insufficient_scope':
      return { status: 'error', key: 'errorScope' };
    case 'network':
      return { status: 'error', key: 'errorNetwork' };
    case 'rate_limited':
      return { status: 'error', key: 'errorRateLimited' };
    default:
      return { status: 'error', key: 'errorServer' };
  }
}
