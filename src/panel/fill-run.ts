// Orquestación del rellenado (CV-507): permiso de host, perfil, documentos de la candidatura, CV y
// script inyectado. Sin DOM del panel: las dependencias entran por parámetro (pruebas).
//
// El token nunca lanza nada ni gasta créditos (D-204): solo lee el perfil y los documentos y pide un
// enlace de descarga del CV, igual que el panel de documentos (CV-506). Nunca envía el formulario.

import type { ApiClient, ApplicationDocuments, ApplicationRef, DocumentFormat, ProfileData, ProfileResult } from '../api';
import { chooseFormat, CV_MIME } from '../fill/accept';
import { ATS_ORIGINS, atsFromUrl, isKnownAtsHost } from '../fill/ats';
import type { FillAnswer, FillFile, FillProfile, FillRequest, FillSummary } from '../fill/types';
import { parseScan, parseSummary, type FillPageDeps } from './fill-page';

/** Por qué falta el CV o las respuestas (el contacto se rellena igualmente). */
export type Missing = 'no_application' | 'not_ready' | 'no_scope' | 'documents_failed' | null;
/** Qué pasó con el CV antes de llegar a la página. */
export type CvStatus = 'sent' | 'unavailable' | 'download_failed' | 'format' | 'no_input';

export type FillInput = {
  pageUrl: string;
  application: ApplicationRef | null;
  /** ¿El token permite leer los documentos? (`documents.read`; true si el servidor no dice los alcances.) */
  hasDocumentsScope: boolean;
  askYouLabel: string;
  getToken(): Promise<string | null>;
};

export type FillOutcome =
  | { status: 'unsupported' | 'denied' | 'no_access' | 'failed' | 'unauthenticated' }
  | { status: 'profile_error'; error: Exclude<ProfileResult, { ok: true }> }
  | {
      status: 'done';
      summary: FillSummary;
      missing: Missing;
      cvStatus: CvStatus;
      /** ¿Hay respuestas redactadas por Aplica para las preguntas abiertas? */
      hasAnswers: boolean;
      /** La candidatura en la web, para generar lo que falte. */
      applicationUrl: string | null;
    };

/** El perfil de la API reducido a lo que se escribe en un formulario. */
export function toFillProfile(profile: ProfileData): FillProfile {
  const website = profile.websites.find((url) => !/linkedin\.com|github\.com/i.test(url)) ?? null;
  return {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.linkedin,
    github: profile.github,
    website,
    currentTitle: profile.currentRole?.title ?? null,
    currentCompany: profile.currentRole?.company ?? null,
    yearsExperience: profile.yearsExperience,
  };
}

/** Todas las preguntas de los conjuntos de respuestas, las del conjunto más reciente primero. */
export function toFillAnswers(docs: ApplicationDocuments): FillAnswer[] {
  return [...docs.questions]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .flatMap((set) => set.items.map((item) => ({ question: item.question, answer: item.type === 'redactar' ? item.answer : null, type: item.type })));
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Baja el CV (enlace de un solo uso; si ya no vale, uno nuevo una vez) y lo deja en base64. */
async function downloadCv(client: ApiClient, token: string, applicationId: string, format: DocumentFormat): Promise<FillFile | 'unauthenticated' | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const link = await client.requestDownload(token, applicationId, format);
    if (!link.ok) return link.kind === 'unauthenticated' ? 'unauthenticated' : null;
    const file = await client.downloadFile(link.data.url, format);
    if (file.ok) return { name: file.data.filename, type: CV_MIME[format], base64: await toBase64(file.data.blob) };
    if (file.kind === 'unauthenticated') return 'unauthenticated';
    if (file.kind !== 'gone') return null;
  }
  return null;
}

type Documents = { docs: ApplicationDocuments | null; missing: Missing; unauthenticated?: boolean };

async function loadDocuments(client: ApiClient, token: string, input: FillInput): Promise<Documents> {
  const { application } = input;
  if (!application) return { docs: null, missing: 'no_application' };
  if (!application.ready) return { docs: null, missing: 'not_ready' };
  if (!input.hasDocumentsScope) return { docs: null, missing: 'no_scope' };
  const result = await client.getDocuments(token, application.id);
  if (result.ok) return { docs: result.data, missing: null };
  if (result.kind === 'unauthenticated') return { docs: null, missing: null, unauthenticated: true };
  if (result.kind === 'insufficient_scope') return { docs: null, missing: 'no_scope' };
  if (result.kind === 'not_ready') return { docs: null, missing: 'not_ready' };
  return { docs: null, missing: 'documents_failed' };
}

/**
 * Rellena la pestaña activa. Lo primero es pedir el permiso de host: tiene que ocurrir dentro del
 * gesto de la persona (el clic), así que no hay ningún `await` por delante.
 */
export async function runFill(input: FillInput, client: ApiClient, deps: FillPageDeps): Promise<FillOutcome> {
  const ats = atsFromUrl(input.pageUrl);
  if (!ats) return { status: 'unsupported' };
  // Workable en el dominio propio de la empresa (CV-543) no tiene permiso opcional que pedir: el manifiesto
  // no puede listar dominios que no conoce. Ahí solo vale el acceso que da el icono (activeTab) y, si falta,
  // el script falla y el panel lo explica (`no_access`).
  if (isKnownAtsHost(input.pageUrl)) {
    let granted: boolean;
    try {
      granted = await deps.requestHostPermission([...ATS_ORIGINS[ats]]);
    } catch {
      granted = false;
    }
    if (!granted) return { status: 'denied' };
  }

  let tabId: number;
  try {
    const tab = await deps.queryActiveTab();
    if (tab?.id === undefined || tab.url === undefined) return { status: 'no_access' };
    if (atsFromUrl(tab.url) !== ats) return { status: 'unsupported' };
    tabId = tab.id;
  } catch {
    return { status: 'failed' };
  }

  const token = await input.getToken();
  if (!token) return { status: 'unauthenticated' };
  const profile = await client.getProfile(token);
  if (!profile.ok) return profile.kind === 'unauthenticated' ? { status: 'unauthenticated' } : { status: 'profile_error', error: profile };

  let scan;
  try {
    scan = parseScan(await deps.scan(tabId, ats));
  } catch {
    return { status: 'no_access' };
  }
  if (!scan) return { status: 'failed' };

  const { docs, missing, unauthenticated } = await loadDocuments(client, token, input);
  if (unauthenticated) return { status: 'unauthenticated' };

  let cv: FillFile | null = null;
  let cvStatus: CvStatus = 'unavailable';
  if (docs && !scan.hasFileInput) {
    cvStatus = 'no_input';
  } else if (docs) {
    const format = chooseFormat(scan.accept, docs.cv);
    if (!format) {
      cvStatus = docs.cv.docx || docs.cv.pdf ? 'format' : 'unavailable';
    } else {
      const downloaded = await downloadCv(client, token, input.application?.id ?? '', format);
      if (downloaded === 'unauthenticated') return { status: 'unauthenticated' };
      cv = downloaded;
      cvStatus = downloaded ? 'sent' : 'download_failed';
    }
  }

  const answers = docs ? toFillAnswers(docs) : [];
  const request: FillRequest = { ats, profile: toFillProfile(profile.data), answers, cv, askYouLabel: input.askYouLabel };
  let summary: FillSummary | null;
  try {
    summary = parseSummary(await deps.fill(tabId, request));
  } catch {
    return { status: 'no_access' };
  }
  if (!summary) return { status: 'failed' };
  return {
    status: 'done',
    summary,
    missing,
    cvStatus,
    hasAnswers: answers.some((a) => a.type === 'redactar' && a.answer),
    applicationUrl: docs?.url ?? input.application?.url ?? null,
  };
}
