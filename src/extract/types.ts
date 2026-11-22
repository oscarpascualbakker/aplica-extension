// Tipos de la extracción de ofertas (CV-504). Todo es serializable: el resultado viaja desde
// la página al panel a través de scripting.executeScript.

export type WorkMode = 'presencial' | 'hibrido' | 'remoto';

export const PORTAL_KEYS = [
  'linkedin',
  'infojobs',
  'indeed',
  'infoempleo',
  'tecnoempleo',
  'glassdoor',
  'workday',
  'greenhouse',
  'lever',
  'smartrecruiters',
  'workable',
  'teamtailor',
  'personio',
  'factorial',
] as const;

export type PortalKey = (typeof PORTAL_KEYS)[number] | 'other';

/** Límites del contrato de la API (CV-504): descripción 30000 caracteres, el resto 255. */
export const MAX_DESCRIPTION = 30_000;
export const MAX_FIELD = 255;

/** Campos que se pueden obtener de la página. Texto plano ya normalizado. */
export type OfferFields = {
  title: string;
  company: string;
  location: string;
  workMode: WorkMode | null;
  salary: string;
  description: string;
};

export type ExtractedOffer = OfferFields & {
  portal: PortalKey;
  /** La descripción vino del texto que la persona tenía seleccionado en la página. */
  descriptionFromSelection: boolean;
  /** Había más de MAX_DESCRIPTION caracteres y se ha recortado. */
  descriptionTruncated: boolean;
};
