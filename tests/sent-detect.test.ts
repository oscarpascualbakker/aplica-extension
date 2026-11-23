// Detección de la página de confirmación de los siete ATS (CV-508, D-220). Criterio de aceptación: en las
// fixtures de confirmación de cada ATS el aviso aparece; en las páginas normales (las ofertas de CV-504 y los
// formularios de CV-507), no. Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATS_KEYS, type AtsKey } from '../src/fill/types';
import { detectConfirmation, headlineConfirms, offerUrlFromConfirmation } from '../src/sent/detect';
import { fixture, parseHtml } from './helpers/dom';
import { FORM_URLS, formHtml } from './helpers/fill';

/** La URL de la página de confirmación de cada ATS y el enlace de la oferta que debe salir de ella. */
const CONFIRMATIONS: Record<AtsKey, { url: string; offerUrl: string; title: string; company: string }> = {
  greenhouse: {
    url: 'https://job-boards.greenhouse.io/empresaficticia/jobs/1234567/confirmation',
    offerUrl: 'https://job-boards.greenhouse.io/empresaficticia/jobs/1234567',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  lever: {
    url: 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001/thanks',
    offerUrl: 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  workday: {
    url: 'https://empresaficticia.wd3.myworkdayjobs.com/es/Careers/job/Madrid/Desarrolladora-backend_R-1/apply/applyManually',
    offerUrl: 'https://empresaficticia.wd3.myworkdayjobs.com/es/Careers/job/Madrid/Desarrolladora-backend_R-1',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  workable: {
    url: 'https://apply.workable.com/empresaficticia/j/ABC123/apply/',
    offerUrl: 'https://apply.workable.com/empresaficticia/j/ABC123/',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  smartrecruiters: {
    url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/EmpresaFicticia/publication/1/confirmation',
    offerUrl: 'https://jobs.smartrecruiters.com/oneclick-ui/company/EmpresaFicticia/publication/1',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  teamtailor: {
    url: 'https://empresaficticia.teamtailor.com/jobs/1234567-desarrolladora-backend/applications/thank-you',
    offerUrl: 'https://empresaficticia.teamtailor.com/jobs/1234567-desarrolladora-backend',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
  personio: {
    url: 'https://empresaficticia.jobs.personio.de/job/1234567?language=es&display=es',
    offerUrl: 'https://empresaficticia.jobs.personio.de/job/1234567',
    title: 'Desarrolladora backend',
    company: 'Empresa Ficticia S.L.',
  },
};

/** Las ofertas de CV-504 que son de alguno de los siete ATS, con una URL de oferta de ese ATS. */
const OFFER_PAGES: [string, string][] = [
  ['greenhouse', 'https://job-boards.greenhouse.io/empresaficticia/jobs/1234567'],
  ['lever', 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001'],
  ['smartrecruiters', 'https://jobs.smartrecruiters.com/EmpresaFicticia/1-desarrolladora-backend'],
  ['teamtailor', 'https://empresaficticia.teamtailor.com/jobs/1234567-desarrolladora-backend'],
  ['personio', 'https://empresaficticia.jobs.personio.de/job/1234567'],
];

const confirmationHtml = (ats: AtsKey): string => readFileSync(`tests/fixtures/sent/${ats}.html`, 'utf8');

describe('página de confirmación de cada ATS', () => {
  it.each(ATS_KEYS)('%s: la detecta, con el enlace de la oferta, el puesto y la empresa', (ats) => {
    const expected = CONFIRMATIONS[ats];
    const found = detectConfirmation(parseHtml(confirmationHtml(ats), expected.url), expected.url);
    expect(found).toEqual({ ats, offerUrl: expected.offerUrl, title: expected.title, company: expected.company });
  });

  it.each(ATS_KEYS)('%s: el formulario de candidatura no es la confirmación', (ats) => {
    const url = FORM_URLS[ats];
    expect(detectConfirmation(parseHtml(formHtml(ats), url), url)).toBeNull();
  });

  it.each(OFFER_PAGES)('%s: la página de la oferta no es la confirmación', (name, url) => {
    expect(detectConfirmation(parseHtml(fixture(name), url), url)).toBeNull();
  });

  it('fuera de los siete ATS no detecta nada, aunque la página dé las gracias', () => {
    const url = 'https://empresa-ficticia.example/empleo/gracias';
    expect(detectConfirmation(parseHtml('<h1>Gracias por tu candidatura</h1>', url), url)).toBeNull();
  });

  it('una página de un ATS sin regla ni titular de confirmación no es la confirmación', () => {
    const url = 'https://jobs.lever.co/empresaficticia';
    expect(detectConfirmation(parseHtml('<h1>Empresa Ficticia S.L.</h1><p>Ofertas abiertas</p>', url), url)).toBeNull();
  });

  it('la ruta de confirmación no basta si la página aún tiene el formulario', () => {
    const { url } = CONFIRMATIONS.greenhouse;
    const html = '<h1>Thank you for applying.</h1><form><input type="email" name="email"/></form>';
    expect(detectConfirmation(parseHtml(html, url), url)).toBeNull();
  });

  it('sin puesto ni empresa en la página, los deja vacíos', () => {
    const url = 'https://apply.workable.com/empresaficticia/j/ABC123/apply/';
    const found = detectConfirmation(parseHtml('<h2>Application submitted</h2>', url), url);
    expect(found).toEqual({ ats: 'workable', offerUrl: 'https://apply.workable.com/empresaficticia/j/ABC123/', title: '', company: '' });
  });
});

describe('titular de confirmación', () => {
  const doc = (html: string): Document => parseHtml(html, 'https://jobs.lever.co/x');

  it.each([
    '<h1>¡Gracias por tu candidatura!</h1>',
    '<h2>HEMOS RECIBIDO TU SOLICITUD</h2>',
    '<h3>Solicitud enviada</h3>',
    '<div role="alert">Application submitted</div>',
    '<div role="status">We’ve received your application.</div>',
    '<h1>Thanks for applying</h1>',
  ])('reconoce %s', (html) => {
    expect(headlineConfirms(doc(html))).toBe(true);
  });

  it.each([
    // "Gracias por tu interés" sale en las propias ofertas.
    '<h2>Thank you for your interest in Empresa Ficticia S.L.</h2>',
    // Las frases solo cuentan en titulares, no en el texto de la oferta.
    '<p>Thank you for applying. We review every application.</p>',
    // Un bloque largo con rol de titular es texto, no un aviso.
    `<div role="status">${'Texto de la oferta. '.repeat(15)}Gracias por tu candidatura.</div>`,
  ])('no reconoce %s', (html) => {
    expect(headlineConfirms(doc(html))).toBe(false);
  });
});

describe('enlace de la oferta a partir de la confirmación', () => {
  it('quita la consulta y el fragmento', () => {
    expect(offerUrlFromConfirmation('lever', 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001/thanks?lever-source=x#top')).toBe(
      'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001',
    );
  });

  it('Workday: corta en /apply aunque no haya más ruta', () => {
    expect(offerUrlFromConfirmation('workday', 'https://empresaficticia.wd3.myworkdayjobs.com/Careers/job/Madrid/X_R-1/apply')).toBe(
      'https://empresaficticia.wd3.myworkdayjobs.com/Careers/job/Madrid/X_R-1',
    );
  });
});
