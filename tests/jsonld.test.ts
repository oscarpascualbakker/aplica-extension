import { describe, expect, it } from 'vitest';
import { parseJsonLd } from '../src/extract/jsonld';
import { parseHtml } from './helpers/dom';

function page(...blocks: string[]): Document {
  const scripts = blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join('');
  return parseHtml(`<html lang="es"><head>${scripts}</head><body></body></html>`);
}

const POSTING = {
  '@type': 'JobPosting',
  title: 'Desarrolladora backend',
  hiringOrganization: { '@type': 'Organization', name: 'Empresa Ficticia S.L.' },
  description: '<p>Primer párrafo &amp; más.</p><ul><li>Uno</li><li>Dos</li></ul>',
};

describe('parseJsonLd', () => {
  it('lee un JobPosting simple', () => {
    const offer = parseJsonLd(page(JSON.stringify({ '@context': 'https://schema.org', ...POSTING, url: 'https://example.com/o/1' })));
    expect(offer).toMatchObject({
      title: 'Desarrolladora backend',
      company: 'Empresa Ficticia S.L.',
      description: 'Primer párrafo & más.\n\n- Uno\n- Dos',
      url: 'https://example.com/o/1',
      workMode: null,
    });
  });

  it('encuentra el JobPosting dentro de @graph', () => {
    const graph = { '@graph': [{ '@type': 'WebSite', name: 'Portal' }, POSTING] };
    expect(parseJsonLd(page(JSON.stringify(graph)))?.title).toBe('Desarrolladora backend');
  });

  it('acepta un array de nodos y @type como array', () => {
    const list = [{ '@type': 'BreadcrumbList' }, { ...POSTING, '@type': ['Thing', 'JobPosting'] }];
    expect(parseJsonLd(page(JSON.stringify(list)))?.company).toBe('Empresa Ficticia S.L.');
  });

  it('ignora el bloque malformado y sigue con el siguiente', () => {
    const offer = parseJsonLd(page('{ esto no es JSON', JSON.stringify(POSTING)));
    expect(offer?.title).toBe('Desarrolladora backend');
  });

  it('sin JobPosting devuelve null', () => {
    expect(parseJsonLd(page(JSON.stringify({ '@type': 'Organization', name: 'x' })))).toBeNull();
    expect(parseJsonLd(page('{ roto'))).toBeNull();
    expect(parseJsonLd(parseHtml('<html><body></body></html>'))).toBeNull();
  });

  it('decodifica entidades en los campos de una línea', () => {
    const offer = parseJsonLd(page(JSON.stringify({ ...POSTING, title: 'Ventas &amp; Marketing', hiringOrganization: 'Ficticia &amp; Co' })));
    expect(offer).toMatchObject({ title: 'Ventas & Marketing', company: 'Ficticia & Co' });
  });

  describe('ubicación', () => {
    it('une localidad, región y país sin repetir', () => {
      const posting = {
        ...POSTING,
        jobLocation: { address: { addressLocality: 'Madrid', addressRegion: 'Madrid', addressCountry: 'ES' } },
      };
      expect(parseJsonLd(page(JSON.stringify(posting)))?.location).toBe('Madrid, ES');
    });

    it('varias sedes y país como objeto', () => {
      const posting = {
        ...POSTING,
        jobLocation: [
          { address: { addressLocality: 'Villanueva', addressCountry: { name: 'España' } } },
          { address: { addressLocality: 'San Ejemplo', addressRegion: 'Provincia Ficticia' } },
        ],
      };
      expect(parseJsonLd(page(JSON.stringify(posting)))?.location).toBe('Villanueva, España; San Ejemplo, Provincia Ficticia');
    });

    it('dirección como texto', () => {
      const posting = { ...POSTING, jobLocation: { address: 'Calle Inventada 1, Villanueva' } };
      expect(parseJsonLd(page(JSON.stringify(posting)))?.location).toBe('Calle Inventada 1, Villanueva');
    });
  });

  describe('modalidad', () => {
    it('TELECOMMUTE es remoto', () => {
      const offer = parseJsonLd(page(JSON.stringify({ ...POSTING, jobLocationType: 'TELECOMMUTE' })));
      expect(offer?.workMode).toBe('remoto');
    });

    it('applicantLocationRequirements es remoto', () => {
      const posting = { ...POSTING, applicantLocationRequirements: { '@type': 'Country', name: 'ES' } };
      expect(parseJsonLd(page(JSON.stringify(posting)))?.workMode).toBe('remoto');
    });

    it('nunca se deduce del texto libre', () => {
      const posting = { ...POSTING, description: '<p>Trabajo 100% remoto, o híbrido, o presencial</p>' };
      expect(parseJsonLd(page(JSON.stringify(posting)))?.workMode).toBeNull();
    });
  });

  describe('salario', () => {
    const salary = (baseSalary: unknown, lang = 'es'): string | undefined => {
      const html = `<html lang="${lang}"><head><script type="application/ld+json">${JSON.stringify({ ...POSTING, baseSalary })}</script></head></html>`;
      return parseJsonLd(parseHtml(html))?.salary;
    };

    it('rango con moneda y unidad', () => {
      const range = { currency: 'EUR', value: { minValue: 40000, maxValue: 48000, unitText: 'YEAR' } };
      expect(salary(range)).toBe('40.000 - 48.000 EUR / año');
    });

    it('valor único', () => {
      expect(salary({ currency: 'EUR', value: { value: 2500, unitText: 'MONTH' } })).toBe('2500 EUR / mes');
    });

    it('en inglés, formato y unidad británicos', () => {
      expect(salary({ currency: 'GBP', value: { minValue: 30000, maxValue: 35000, unitText: 'YEAR' } }, 'en-GB')).toBe(
        '30,000 - 35,000 GBP / year',
      );
    });

    it('valor numérico directo y sin unidad', () => {
      expect(salary({ currency: 'EUR', value: 30000 })).toBe('30.000 EUR');
    });

    it('sin cifras no hay salario', () => {
      expect(salary({ currency: 'EUR', value: { unitText: 'YEAR' } })).toBe('');
    });
  });
});
