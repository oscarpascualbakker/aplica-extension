// Vigilancia de los extractores (CV-539, D-253, D-204). Cada lectura de una oferta en un portal con
// extractor propio manda a la API un solo dato: si el extractor sacó lo esencial. Nada del contenido
// de la oferta, ni la URL ni el host: solo portal, versión y resultado.

import type { ApiClient } from '../api';
import { EXTRACTORS } from './portals';
import type { ExtractedOffer } from './types';

/**
 * Lectura correcta: puesto, empresa y descripción salieron de la página, sin recurrir al texto
 * seleccionado (que oculta que el extractor del portal ha dejado de funcionar).
 */
export function extractionOk(offer: Pick<ExtractedOffer, 'title' | 'company' | 'description' | 'descriptionFromSelection'>): boolean {
  return !(!offer.title || !offer.company || !offer.description || offer.descriptionFromSelection);
}

export type ReportDeps = {
  getToken(): Promise<string | null | undefined>;
  client: Pick<ApiClient, 'reportExtraction'>;
  version(): string;
};

/**
 * Dispara y olvida: solo con navegador conectado y portal con extractor propio (Workday y Workable se
 * reconocen pero solo usan JSON-LD, no se vigilan). Nunca lanza ni espera al panel.
 */
export async function reportExtraction(offer: ExtractedOffer, deps: ReportDeps): Promise<void> {
  if (offer.portal === 'other' || !EXTRACTORS[offer.portal]) return;
  try {
    const token = await deps.getToken();
    if (!token) return;
    await deps.client.reportExtraction(token, { portal: offer.portal, version: deps.version(), ok: extractionOk(offer) });
  } catch {
    // Silencio: red, 401, 429 o ruta inexistente no importan al usuario.
  }
}
