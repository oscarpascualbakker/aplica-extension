// Lectura de la página activa (CV-504). Sin host_permissions ni content scripts: solo
// activeTab + scripting.executeScript sobre la pestaña activa, después de que la persona pulse
// el icono. Nunca se pide permiso de host. Las dependencias entran por parámetro (pruebas).

import { PORTAL_KEYS, type ExtractedOffer, type PortalKey, type WorkMode } from '../extract/types';
import { offerUrl } from '../extract/url';

export type TabInfo = { id?: number; url?: string };

export type ReadDeps = {
  queryActiveTab(): Promise<TabInfo | undefined>;
  /** Inyecta extract.js en la pestaña y devuelve lo que devuelve el script. */
  runExtract(tabId: number): Promise<unknown>;
};

export type ReadOutcome =
  | { status: 'ok'; offer: ExtractedOffer & { url: string } }
  /** Falta el permiso: la persona debe pulsar el icono de Aplica en esta página. */
  | { status: 'no_access' }
  /** La pestaña no es una página web (chrome://, about:, nueva pestaña…). */
  | { status: 'unsupported' }
  | { status: 'failed' };

const WORK_MODES: readonly string[] = ['presencial', 'hibrido', 'remoto'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Valida lo que devuelve el script inyectado: solo se acepta el formato esperado. */
export function parseExtracted(value: unknown): ExtractedOffer | null {
  if (!isRecord(value)) return null;
  const { title, company, location, workMode, salary, description, portal, descriptionFromSelection, descriptionTruncated } =
    value;
  if (
    typeof title !== 'string' ||
    typeof company !== 'string' ||
    typeof location !== 'string' ||
    typeof salary !== 'string' ||
    typeof description !== 'string' ||
    typeof portal !== 'string' ||
    typeof descriptionFromSelection !== 'boolean' ||
    typeof descriptionTruncated !== 'boolean'
  ) {
    return null;
  }
  const knownPortal = portal === 'other' || (PORTAL_KEYS as readonly string[]).includes(portal);
  const mode = typeof workMode === 'string' && WORK_MODES.includes(workMode) ? (workMode as WorkMode) : null;
  return {
    title,
    company,
    location,
    workMode: mode,
    salary,
    description,
    portal: (knownPortal ? portal : 'other') as PortalKey,
    descriptionFromSelection,
    descriptionTruncated,
  };
}

export async function readPage(deps: ReadDeps): Promise<ReadOutcome> {
  let tab: TabInfo | undefined;
  try {
    tab = await deps.queryActiveTab();
  } catch {
    return { status: 'failed' };
  }
  // Sin activeTab concedido, el navegador no da la URL de la pestaña.
  if (tab?.id === undefined || tab.url === undefined) return { status: 'no_access' };
  if (!/^https?:\/\//i.test(tab.url)) return { status: 'unsupported' };

  let raw: unknown;
  try {
    raw = await deps.runExtract(tab.id);
  } catch {
    // executeScript falla sin permiso (otra oferta en la misma pestaña, panel abierto de otra forma).
    return { status: 'no_access' };
  }
  const offer = parseExtracted(raw);
  return offer ? { status: 'ok', offer: { ...offer, url: offerUrl(tab.url) } } : { status: 'failed' };
}
