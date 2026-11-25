// Extracción de la oferta de la página (CV-504). Orden: JSON-LD, extractor del portal y, si no
// hay descripción, el texto que la persona tenía seleccionado. Función pura sobre un Document
// para poder probarla con fixtures; la carga en la página la hace inject.ts.

import { atsFromDocument } from '../fill/ats';
import { parseJsonLd } from './jsonld';
import { EXTRACTORS, portalFromHost } from './portals';
import { clip, inlineText } from './text';
import { MAX_DESCRIPTION, MAX_FIELD, type ExtractedOffer, type OfferFields } from './types';

const TEXT_FIELDS = ['title', 'company', 'location', 'salary'] as const;

export function extractOffer(doc: Document, hostname: string, selection: string): ExtractedOffer {
  // Workable en el dominio propio de la empresa (CV-543): el host no lo dice, la estructura de la página sí.
  const byHost = portalFromHost(hostname);
  const portal = byHost === 'other' && atsFromDocument(doc) === 'workable' ? 'workable' : byHost;
  const fromLd = parseJsonLd(doc);
  const fields: OfferFields = {
    title: fromLd?.title ?? '',
    company: fromLd?.company ?? '',
    location: fromLd?.location ?? '',
    workMode: fromLd?.workMode ?? null,
    salary: fromLd?.salary ?? '',
    description: fromLd?.description ?? '',
  };

  // El extractor del portal completa lo que el JSON-LD no trae.
  const extractor = EXTRACTORS[portal];
  if (extractor) {
    const extra = extractor(doc);
    for (const key of TEXT_FIELDS) if (!fields[key]) fields[key] = extra[key] ?? '';
    if (!fields.description) fields.description = extra.description ?? '';
    fields.workMode ??= extra.workMode ?? null;
  }

  // Sin descripción, el texto seleccionado por la persona.
  let descriptionFromSelection = false;
  if (!fields.description && selection.trim()) {
    fields.description = selection.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    descriptionFromSelection = true;
  }

  const descriptionTruncated = fields.description.length > MAX_DESCRIPTION;
  return {
    ...fields,
    title: clip(inlineText(fields.title), MAX_FIELD),
    company: clip(inlineText(fields.company), MAX_FIELD),
    location: clip(inlineText(fields.location), MAX_FIELD),
    salary: clip(inlineText(fields.salary), MAX_FIELD),
    description: clip(fields.description, MAX_DESCRIPTION),
    portal,
    descriptionFromSelection,
    descriptionTruncated,
  };
}
