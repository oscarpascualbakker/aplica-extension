// Extracción sobre fixtures HTML de cada portal (CV-504). Los fixtures conservan la estructura
// real de cada portal (etiquetas, clases, atributos y JSON-LD) con una oferta inventada.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractOffer } from '../src/extract/extract';
import type { ExtractedOffer, PortalKey } from '../src/extract/types';
import { fixture, parseHtml, withoutJsonLd } from './helpers/dom';

type Case = {
  file: string;
  host: string;
  portal: PortalKey;
  jsonLd: boolean;
  /** Lo que sale con la página completa. */
  full: Partial<ExtractedOffer>;
  /** Lo que sale solo con el extractor del portal (sin JSON-LD). */
  dom: Partial<ExtractedOffer>;
};

const TITLE = 'Desarrolladora backend';
const COMPANY = 'Empresa Ficticia S.L.';
const INTRO =
  'En Empresa Ficticia S.L. construimos herramientas de gestión para pequeños comercios. Buscamos una persona para el equipo de plataforma.';
const LIST = '- Diseñar y mantener APIs REST en PHP y Python.\n- Escribir pruebas automáticas & revisar código.\n- Colaborar con producto y diseño.';
const ABOUT = `Sobre Empresa Ficticia\n\n${INTRO}\n\nQué harás\n\n${LIST}\n\nQué ofrecemos\n\nJornada flexible y 25 días de vacaciones.`;

const CASES: Case[] = [
  {
    file: 'greenhouse',
    host: 'job-boards.greenhouse.io',
    portal: 'greenhouse',
    jsonLd: false,
    full: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo, Provincia Ficticia',
      description: ABOUT.replace(LIST, LIST.replace(/\n- /g, '\n\n- ')),
    },
    dom: {},
  },
  {
    file: 'lever',
    host: 'jobs.lever.co',
    portal: 'lever',
    jsonLd: true,
    full: { title: TITLE, company: COMPANY, location: 'Villanueva del Ejemplo', workMode: 'hibrido', description: ABOUT },
    dom: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo',
      workMode: 'hibrido',
      description: `Sobre Empresa Ficticia\n${INTRO}\n\nQué harás\n\n${LIST}\n\nJornada flexible y 25 días de vacaciones.`,
    },
  },
  {
    file: 'smartrecruiters',
    host: 'jobs.smartrecruiters.com',
    portal: 'smartrecruiters',
    jsonLd: false,
    full: { title: TITLE, company: COMPANY, location: 'Villanueva del Ejemplo, Spain', workMode: 'hibrido', description: ABOUT },
    dom: {},
  },
  {
    file: 'teamtailor',
    host: 'empresaficticia.teamtailor.com',
    portal: 'teamtailor',
    jsonLd: true,
    full: { title: TITLE, company: COMPANY, location: 'Villanueva del Ejemplo, Provincia Ficticia, ES', description: ABOUT },
    dom: { title: TITLE, company: COMPANY, location: '', description: ABOUT },
  },
  {
    file: 'personio',
    host: 'empresaficticia.jobs.personio.de',
    portal: 'personio',
    jsonLd: true,
    full: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo, Provincia Ficticia, ES; San Ejemplo de Arriba, Provincia Ficticia, ES',
      description: `SOBRE EL EQUIPO\n\n${INTRO}\n\nQUÉ HARÁS\n\n${LIST}\n\nQUÉ OFRECEMOS\n\nJornada flexible y 25 días de vacaciones.`,
    },
    dom: { title: TITLE, company: COMPANY, location: 'Villanueva del Ejemplo, San Ejemplo de Arriba' },
  },
  {
    file: 'factorial',
    host: 'careers.factorialhr.com',
    portal: 'factorial',
    jsonLd: true,
    full: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo, ES',
      description: ABOUT.replace(/^Sobre Empresa Ficticia\n\n/, ''),
    },
    dom: { title: TITLE, company: COMPANY, location: '', description: ABOUT.replace(/^Sobre Empresa Ficticia\n\n/, '') },
  },
  {
    file: 'tecnoempleo',
    host: 'www.tecnoempleo.com',
    portal: 'tecnoempleo',
    jsonLd: true,
    full: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo, Provincia Ficticia, ES',
      salary: '40.000 - 48.000 EUR / año',
      description: 'Buscamos una persona para el equipo de plataforma de Empresa Ficticia S.L.',
    },
    dom: {
      title: TITLE,
      company: COMPANY,
      location: 'Villanueva del Ejemplo - España',
      salary: '40.000 € - 48.000 € Bruto/año',
      description:
        'Buscamos una persona para el equipo de plataforma de Empresa Ficticia S.L.\n\nQUÉ HARÁS\n\nDiseñar y mantener APIs REST en PHP y Python.\n\nEscribir pruebas automáticas & revisar código.\n\nQUÉ OFRECEMOS\n\nJornada flexible y 25 días de vacaciones.',
    },
  },
  {
    file: 'infoempleo',
    host: 'www.infoempleo.com',
    portal: 'infoempleo',
    jsonLd: true,
    full: {
      title: TITLE,
      company: 'EMPRESA FICTICIA S.L.',
      location: 'Villanueva del Ejemplo, Provincia Ficticia, ES',
      salary: '38.000 € brutos anuales',
      description: `${INTRO}\n\nFunciones:\n\n- Diseñar y mantener APIs REST en PHP y Python.\n- Escribir pruebas automáticas & revisar código.\n\nJornada flexible y 25 días de vacaciones.`,
    },
    dom: {
      title: TITLE,
      company: 'EMPRESA FICTICIA S.L.',
      location: 'Villanueva del Ejemplo (Provincia Ficticia)',
      salary: '38.000 € brutos anuales',
      description: `Duración de la oferta: hasta el 31/12/2026.\n\nFunciones\n\n${INTRO} Diseñar y mantener APIs REST en PHP y Python. Escribir pruebas automáticas & revisar código. Jornada flexible y 25 días de vacaciones.`,
    },
  },
  {
    file: 'linkedin',
    host: 'www.linkedin.com',
    portal: 'linkedin',
    jsonLd: false,
    full: { title: TITLE, company: COMPANY, location: 'Villanueva del Ejemplo', description: ABOUT },
    dom: {},
  },
];

describe.each(CASES)('fixture $file', (c) => {
  it('saca puesto, empresa y descripción de la página completa', () => {
    const offer = extractOffer(parseHtml(fixture(c.file), `https://${c.host}/`), c.host, '');
    expect(offer).toMatchObject({ ...c.full, portal: c.portal, descriptionFromSelection: false, descriptionTruncated: false });
    expect(offer.title).not.toBe('');
    expect(offer.company).not.toBe('');
    expect(offer.description).not.toBe('');
  });

  it('el extractor del portal también saca puesto, empresa y descripción sin JSON-LD', () => {
    const html = c.jsonLd ? withoutJsonLd(fixture(c.file)) : fixture(c.file);
    const offer = extractOffer(parseHtml(html, `https://${c.host}/`), c.host, '');
    expect(offer).toMatchObject({ ...c.full, ...c.dom });
    expect(offer.title).not.toBe('');
    expect(offer.company).not.toBe('');
    expect(offer.description).not.toBe('');
  });
});

describe('fixtures', () => {
  it('cada portal con extractor propio tiene su fixture', () => {
    const files = readdirSync('tests/fixtures')
      .map((f) => f.replace(/\.html$/, ''))
      .sort();
    expect(files).toEqual(CASES.map((c) => c.file).sort());
  });

  it('solo llevan datos ficticios: nada de las páginas reales de las que se tomó la estructura', () => {
    const real = /palantir|anthropic|ottonova|elevator|infinitum|crit\b|servicenow|cloudflare|hugging|stripe|spotify|salesforce/i;
    for (const file of readdirSync('tests/fixtures')) {
      const html = readFileSync(`tests/fixtures/${file}`, 'utf8');
      expect(real.test(html), file).toBe(false);
      expect(html, file).not.toMatch(/[—–]/);
    }
  });
});
