// Vigilancia de los extractores (CV-539, D-253): la regla de "lectura correcta" y el envío.
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api';
import { extractOffer } from '../src/extract/extract';
import { extractionOk, reportExtraction } from '../src/extract/report';
import type { ExtractedOffer } from '../src/extract/types';
import { fixture, parseHtml, withoutJsonLd } from './helpers/dom';

const HOST = 'jobs.lever.co';

function read(html: string, selection = ''): ExtractedOffer {
  return extractOffer(parseHtml(html, `https://${HOST}/`), HOST, selection);
}

describe('extractionOk', () => {
  it('un fixture completo da ok', () => {
    expect(extractionOk(read(fixture('lever')))).toBe(true);
  });

  it('sin el nodo del puesto, ok=false (fallo forzado)', () => {
    const html = withoutJsonLd(fixture('lever')).replace(/<h2[^>]*>[\s\S]*?<\/h2>/, '');
    const offer = read(html);
    expect(offer.title).toBe('');
    expect(extractionOk(offer)).toBe(false);
  });

  it('sin descripción en la página, aunque haya selección, ok=false', () => {
    const html = withoutJsonLd(fixture('lever')).replace(/<div class="section[\s\S]*<\/body>/, '</body>');
    const offer = read(html, 'Texto seleccionado por la persona');
    expect(offer.descriptionFromSelection).toBe(true);
    expect(extractionOk(offer)).toBe(false);
  });
});

function fakeOffer(portal: ExtractedOffer['portal']): ExtractedOffer {
  return { title: 'a', company: 'b', location: '', workMode: null, salary: '', description: 'd', portal, descriptionFromSelection: false, descriptionTruncated: false };
}

describe('reportExtraction', () => {
  function setup(token: string | null) {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = createApiClient('https://api.test', fetchMock);
    return { fetchMock, deps: { getToken: () => Promise.resolve(token), client, version: () => '1.2.3' } };
  }

  it('envía exactamente portal, version y ok, con el token', async () => {
    const { fetchMock, deps } = setup('tok');
    await reportExtraction({ ...fakeOffer('lever'), description: '' }, deps);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/extraction-reports');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ portal: 'lever', version: '1.2.3', ok: false });
  });

  it('con portal other no envía nada', async () => {
    const { fetchMock, deps } = setup('tok');
    await reportExtraction(fakeOffer('other'), deps);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con un portal reconocido sin extractor propio (Workday, Workable) no envía nada', async () => {
    const { fetchMock, deps } = setup('tok');
    await reportExtraction(fakeOffer('workday'), deps);
    await reportExtraction(fakeOffer('workable'), deps);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin token no envía nada', async () => {
    const { fetchMock, deps } = setup(null);
    await reportExtraction(fakeOffer('lever'), deps);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un error de red, un 401 o un 404 no lanzan', async () => {
    for (const impl of [() => Promise.reject(new Error('red')), () => Promise.resolve(new Response('{}', { status: 401 })), () => Promise.resolve(new Response('', { status: 404 }))]) {
      const client = createApiClient('https://api.test', vi.fn<typeof fetch>(impl));
      await expect(reportExtraction(fakeOffer('lever'), { getToken: () => Promise.resolve('t'), client, version: () => '1' })).resolves.toBeUndefined();
    }
  });
});
