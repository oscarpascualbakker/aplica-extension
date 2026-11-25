// Selección, portales sin extractor y límites (CV-504).
import { describe, expect, it } from 'vitest';
import { extractOffer } from '../src/extract/extract';
import { portalFromHost, workModeFromLabel } from '../src/extract/portals';
import { MAX_DESCRIPTION, MAX_FIELD } from '../src/extract/types';
import { parseHtml } from './helpers/dom';

const EMPTY = '<html><head><title>Ofertas</title></head><body><h1>Algo</h1><p>Sin datos</p></body></html>';

describe('selección', () => {
  it('sin descripción en la página se usa el texto seleccionado', () => {
    const offer = extractOffer(parseHtml(EMPTY), 'ofertas.example.com', '  Buscamos una persona.\r\n\r\n\r\n\r\nSe ofrece jornada flexible.  ');
    expect(offer.description).toBe('Buscamos una persona.\n\nSe ofrece jornada flexible.');
    expect(offer).toMatchObject({ descriptionFromSelection: true, portal: 'other', title: '', company: '' });
  });

  it('sin descripción ni selección, descripción vacía (el panel pide seleccionar)', () => {
    const offer = extractOffer(parseHtml(EMPTY), 'ofertas.example.com', '   ');
    expect(offer).toMatchObject({ description: '', descriptionFromSelection: false });
  });

  it('con descripción estructurada, la selección se ignora', () => {
    const ld = '{"@type":"JobPosting","title":"Puesto","description":"<p>Texto del portal</p>"}';
    const html = `<html><head><script type="application/ld+json">${ld}</script></head></html>`;
    const offer = extractOffer(parseHtml(html), 'ofertas.example.com', 'otra cosa');
    expect(offer).toMatchObject({ description: 'Texto del portal', descriptionFromSelection: false });
  });

  it('el JSON-LD de un portal sin extractor propio basta (Workday, Workable, InfoJobs, Indeed, Glassdoor)', () => {
    const ld = '{"@type":"JobPosting","title":"Puesto","hiringOrganization":{"name":"Empresa Ficticia S.L."},"description":"Texto"}';
    const html = `<html><head><script type="application/ld+json">${ld}</script></head></html>`;
    for (const [host, portal] of [
      ['empresa.wd3.myworkdayjobs.com', 'workday'],
      ['apply.workable.com', 'workable'],
      ['www.infojobs.net', 'infojobs'],
      ['es.indeed.com', 'indeed'],
      ['www.glassdoor.es', 'glassdoor'],
    ] as const) {
      expect(extractOffer(parseHtml(html), host, '')).toMatchObject({ portal, title: 'Puesto', company: 'Empresa Ficticia S.L.', description: 'Texto' });
    }
  });
});

describe('Workable en el dominio propio de la empresa (CV-543)', () => {
  const TITLE = 'Desarrolladora backend';
  const COMPANY = 'Empresa Ficticia S.L.';
  const ld = JSON.stringify({ '@type': 'JobPosting', title: TITLE, hiringOrganization: { name: COMPANY }, description: '<p>Texto</p>' });
  const page = `<html><head><script type="application/ld+json">${ld}</script></head><body><div id="app"><div data-ui="careers-page-content"><h1 data-ui="job-title">${TITLE}</h1></div></div></body></html>`;

  it('el host no lo dice, la estructura de la página sí: portal workable', () => {
    const offer = extractOffer(parseHtml(page, 'https://careers.empresaficticia.example/_/j/ABC123/'), 'careers.empresaficticia.example', '');
    expect(offer).toMatchObject({ portal: 'workable', title: TITLE, company: COMPANY, description: 'Texto' });
  });

  it('sin la estructura de Workable, un dominio desconocido sigue siendo other', () => {
    const plain = page.replace('data-ui="careers-page-content"', 'class="x"');
    expect(extractOffer(parseHtml(plain), 'careers.empresaficticia.example', '').portal).toBe('other');
  });
});

describe('límites', () => {
  it('recorta la descripción a 30000 caracteres y lo indica', () => {
    const long = 'a'.repeat(MAX_DESCRIPTION + 500);
    const offer = extractOffer(parseHtml(EMPTY), 'x.example.com', long);
    expect(offer.description).toHaveLength(MAX_DESCRIPTION);
    expect(offer.descriptionTruncated).toBe(true);
  });

  it('exactamente 30000 no es recorte', () => {
    const offer = extractOffer(parseHtml(EMPTY), 'x.example.com', 'a'.repeat(MAX_DESCRIPTION));
    expect(offer.descriptionTruncated).toBe(false);
  });

  it('el resto de campos, a 255', () => {
    const long = 'b'.repeat(400);
    const ld = JSON.stringify({ '@type': 'JobPosting', title: long, description: 'x', hiringOrganization: { name: long } });
    const html = `<html><head><script type="application/ld+json">${ld}</script></head></html>`;
    const offer = extractOffer(parseHtml(html), 'x.example.com', '');
    expect(offer.title).toHaveLength(MAX_FIELD);
    expect(offer.company).toHaveLength(MAX_FIELD);
  });
});

describe('portalFromHost', () => {
  it.each([
    ['www.linkedin.com', 'linkedin'],
    ['es.linkedin.com', 'linkedin'],
    ['www.infojobs.net', 'infojobs'],
    ['es.indeed.com', 'indeed'],
    ['www.indeed.com', 'indeed'],
    ['www.infoempleo.com', 'infoempleo'],
    ['www.tecnoempleo.com', 'tecnoempleo'],
    ['www.glassdoor.com', 'glassdoor'],
    ['www.glassdoor.es', 'glassdoor'],
    ['www.glassdoor.co.uk', 'glassdoor'],
    ['acme.wd5.myworkdayjobs.com', 'workday'],
    ['boards.greenhouse.io', 'greenhouse'],
    ['job-boards.greenhouse.io', 'greenhouse'],
    ['jobs.lever.co', 'lever'],
    ['jobs.smartrecruiters.com', 'smartrecruiters'],
    ['apply.workable.com', 'workable'],
    ['acme.teamtailor.com', 'teamtailor'],
    ['acme.jobs.personio.de', 'personio'],
    ['acme.jobs.personio.com', 'personio'],
    ['careers.factorialhr.com', 'factorial'],
    ['careers.factorial.com', 'factorial'],
    ['example.com', 'other'],
    ['notlinkedin.com', 'other'],
    ['linkedin.com.example.org', 'other'],
  ])('%s es %s', (host, portal) => {
    expect(portalFromHost(host)).toBe(portal);
  });
});

describe('workModeFromLabel', () => {
  it('solo etiquetas claras', () => {
    expect(workModeFromLabel('On-site')).toBe('presencial');
    expect(workModeFromLabel('on_site')).toBe('presencial');
    expect(workModeFromLabel('Hybrid')).toBe('hibrido');
    expect(workModeFromLabel('Remote')).toBe('remoto');
    expect(workModeFromLabel('Remoto')).toBe('remoto');
    expect(workModeFromLabel('Madrid y alrededores, a veces remoto')).toBeNull();
    expect(workModeFromLabel('')).toBeNull();
  });
});
