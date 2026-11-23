import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api';

const BROWSER = { id: 'b1', label: 'Chrome', connected_at: '2026-11-21T10:00:00Z' };
const REQUEST = { code: 'c', code_verifier: 'v', redirect_uri: 'https://x.chromiumapp.org/' };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function client(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  return { api: createApiClient('https://api.test', fetchMock), fetchMock };
}

describe('exchangeToken', () => {
  it('200: devuelve el token y envía el JSON esperado sin credenciales', async () => {
    const { api, fetchMock } = client(() =>
      Promise.resolve(json(200, { token: 't', token_type: 'Bearer', browser: BROWSER })),
    );
    const result = await api.exchangeToken(REQUEST);
    expect(result).toEqual({ ok: true, data: { token: 't', token_type: 'Bearer', browser: BROWSER } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/token');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('200 con cuerpo inválido: server', async () => {
    const { api } = client(() => Promise.resolve(json(200, { token: '' })));
    expect(await api.exchangeToken(REQUEST)).toEqual({ ok: false, kind: 'server' });
  });

  it('400 invalid_grant', async () => {
    const { api } = client(() => Promise.resolve(json(400, { error: 'invalid_grant' })));
    expect(await api.exchangeToken(REQUEST)).toEqual({ ok: false, kind: 'invalid_grant' });
  });

  it('429 con Retry-After', async () => {
    const { api } = client(() => Promise.resolve(json(429, {}, { 'Retry-After': '30' })));
    expect(await api.exchangeToken(REQUEST)).toEqual({ ok: false, kind: 'rate_limited', retryAfter: 30 });
  });

  it('error de red', async () => {
    const { api } = client(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await api.exchangeToken(REQUEST)).toEqual({ ok: false, kind: 'network' });
  });
});

describe('getMe', () => {
  it('200: envía Authorization Bearer y devuelve el perfil', async () => {
    const me = { email: 'ana@example.com', locale: 'es', browser: BROWSER };
    const { api, fetchMock } = client(() => Promise.resolve(json(200, me)));
    expect(await api.getMe('tok')).toEqual({ ok: true, data: me });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('401: unauthenticated', async () => {
    const { api } = client(() => Promise.resolve(json(401, { error: 'unauthenticated' })));
    expect(await api.getMe('tok')).toEqual({ ok: false, kind: 'unauthenticated' });
  });

  it('429 sin Retry-After', async () => {
    const { api } = client(() => Promise.resolve(json(429, {})));
    expect(await api.getMe('tok')).toEqual({ ok: false, kind: 'rate_limited', retryAfter: null });
  });

  it('error de red', async () => {
    const { api } = client(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await api.getMe('tok')).toEqual({ ok: false, kind: 'network' });
  });

  it('500: server', async () => {
    const { api } = client(() => Promise.resolve(json(500, {})));
    expect(await api.getMe('tok')).toEqual({ ok: false, kind: 'server' });
  });
});

describe('revokeToken', () => {
  it('204: ok', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await api.revokeToken('tok')).toEqual({ ok: true, data: null });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('401: unauthenticated', async () => {
    const { api } = client(() => Promise.resolve(json(401, { error: 'unauthenticated' })));
    expect(await api.revokeToken('tok')).toEqual({ ok: false, kind: 'unauthenticated' });
  });
});

const APPLICATION = { id: 'a1', title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', stage: 'saved', url: 'https://api.test/app/candidaturas/a1', ready: false };
const OFFER = {
  url: 'https://jobs.example.com/o/1',
  title: 'Desarrolladora backend',
  company: 'Empresa Ficticia S.L.',
  location: 'Villanueva del Ejemplo',
  work_mode: 'hibrido',
  salary: '',
  description: 'Texto',
  portal: 'other',
  force: false,
};

describe('matchOffer (CV-504)', () => {
  it('GET con url, title y company codificados y el token', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(200, { match: 'url', application: APPLICATION })));
    const result = await api.matchOffer('tok', { url: OFFER.url, title: 'A & B', company: 'Ñ' });
    expect(result).toEqual({ ok: true, data: { match: 'url', application: APPLICATION } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/ext/v1/offers/match');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ url: OFFER.url, title: 'A & B', company: 'Ñ' });
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('role_company', async () => {
    const { api } = client(() => Promise.resolve(json(200, { match: 'role_company', application: APPLICATION })));
    expect(await api.matchOffer('tok', OFFER)).toEqual({ ok: true, data: { match: 'role_company', application: APPLICATION } });
  });

  it('sin coincidencia: data null', async () => {
    for (const body of [{ match: null }, { match: 'none' }, {}, { match: 'url' }]) {
      const { api } = client(() => Promise.resolve(json(200, body)));
      expect(await api.matchOffer('tok', OFFER)).toEqual({ ok: true, data: null });
    }
  });

  it('la URL de la candidatura solo vale si es del propio Aplica', async () => {
    const foreign = { ...APPLICATION, url: 'https://evil.example/app/1' };
    const { api } = client(() => Promise.resolve(json(200, { match: 'url', application: foreign })));
    const result = await api.matchOffer('tok', OFFER);
    expect(result).toEqual({ ok: true, data: { match: 'url', application: { ...APPLICATION, url: null } } });
  });

  it('401 y red', async () => {
    expect(await client(() => Promise.resolve(json(401, {}))).api.matchOffer('tok', OFFER)).toEqual({ ok: false, kind: 'unauthenticated' });
    expect(await client(() => Promise.reject(new TypeError('x'))).api.matchOffer('tok', OFFER)).toEqual({ ok: false, kind: 'network' });
  });
});

describe('saveOffer (CV-504)', () => {
  it('201: envía el JSON del contrato con el token y devuelve la candidatura', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(201, { application: APPLICATION })));
    expect(await api.saveOffer('tok', OFFER)).toEqual({ ok: true, data: { application: APPLICATION } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/offers');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual(OFFER);
  });

  it('201 con cuerpo que no se entiende: server', async () => {
    expect(await client(() => Promise.resolve(json(201, {}))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'server' });
  });

  it('409 duplicate (url)', async () => {
    const { api } = client(() => Promise.resolve(json(409, { error: 'duplicate', match: 'url', application: APPLICATION })));
    expect(await api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'duplicate', match: 'url', application: APPLICATION });
  });

  it('409 possible_duplicate (role_company)', async () => {
    const { api } = client(() => Promise.resolve(json(409, { error: 'possible_duplicate', match: 'role_company', application: APPLICATION })));
    expect(await api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'duplicate', match: 'role_company', application: APPLICATION });
  });

  it('409 incoherente: server', async () => {
    const { api } = client(() => Promise.resolve(json(409, { error: 'duplicate', match: 'role_company', application: APPLICATION })));
    expect(await api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'server' });
  });

  it('422: los campos inválidos', async () => {
    const { api } = client(() => Promise.resolve(json(422, { error: 'invalid', fields: ['title', 'description', 7] })));
    expect(await api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'invalid', fields: ['title', 'description'] });
  });

  it('401, 403, 429, red y 500', async () => {
    expect(await client(() => Promise.resolve(json(401, { error: 'unauthenticated' }))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'unauthenticated' });
    expect(await client(() => Promise.resolve(json(403, { error: 'insufficient_scope' }))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'insufficient_scope' });
    expect(await client(() => Promise.resolve(json(429, {}, { 'Retry-After': '10' }))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'rate_limited', retryAfter: 10 });
    expect(await client(() => Promise.reject(new TypeError('x'))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'network' });
    expect(await client(() => Promise.resolve(json(500, {}))).api.saveOffer('tok', OFFER)).toEqual({ ok: false, kind: 'server' });
  });
});

describe('encaje exprés (CV-505)', () => {
  const FIT = {
    verdict: 'apply_with_caveats',
    verdict_reason: 'Encaja en lo técnico; falta confirmar el inglés.',
    requirements: [
      { requirement: 'PHP y Laravel', status: 'covered', evidence_ids: ['EV-01'], note: '' },
      { requirement: 'Inglés alto', status: 'to_confirm', evidence_ids: [], note: 'No aparece en tu perfil.' },
      { requirement: 'Kubernetes', status: 'missing', evidence_ids: [], note: '' },
    ],
    created_at: '2026-11-22T10:00:00+01:00',
    url: 'https://api.test/app/candidaturas/a1#encaje-expres',
  };
  const PARSED = {
    verdict: 'apply_with_caveats',
    verdictReason: 'Encaja en lo técnico; falta confirmar el inglés.',
    requirements: [
      { requirement: 'PHP y Laravel', status: 'covered', note: '' },
      { requirement: 'Inglés alto', status: 'to_confirm', note: 'No aparece en tu perfil.' },
      { requirement: 'Kubernetes', status: 'missing', note: '' },
    ],
    createdAt: '2026-11-22T10:00:00+01:00',
    url: 'https://api.test/app/candidaturas/a1#encaje-expres',
  };

  it('GET: la última lectura, las gratis que quedan y el precio', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(200, { quick_fit: FIT, free_left: 2, price: 1 })));
    expect(await api.getQuickFit('tok', 'a1')).toEqual({ ok: true, data: { quickFit: PARSED, freeLeft: 2, price: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/offers/a1/quick-fit');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('GET sin lectura y GET 404 (apagada)', async () => {
    expect(await client(() => Promise.resolve(json(200, { quick_fit: null, free_left: 3, price: 1 }))).api.getQuickFit('tok', 'a1')).toEqual({
      ok: true,
      data: { quickFit: null, freeLeft: 3, price: 1 },
    });
    expect(await client(() => Promise.resolve(json(404, { error: 'not_found' }))).api.getQuickFit('tok', 'a1')).toEqual({ ok: false, kind: 'not_found' });
  });

  it('POST 200: la lectura nueva; un veredicto o un estado desconocidos no se enseñan a medias', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(200, { quick_fit: FIT, free_left: 1 })));
    expect(await api.runQuickFit('tok', 'a1')).toEqual({ ok: true, data: { quickFit: PARSED, freeLeft: 1 } });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('POST');

    const badVerdict = { ...FIT, verdict: 'maybe' };
    expect(await client(() => Promise.resolve(json(200, { quick_fit: badVerdict, free_left: 1 }))).api.runQuickFit('tok', 'a1')).toEqual({ ok: false, kind: 'server' });
    const badStatus = { ...FIT, requirements: [{ requirement: 'X', status: 'partial', note: '' }] };
    expect(await client(() => Promise.resolve(json(200, { quick_fit: badStatus, free_left: 1 }))).api.runQuickFit('tok', 'a1')).toEqual({ ok: false, kind: 'server' });
  });

  it('una URL de otro origen no se abre', async () => {
    const other = { ...FIT, url: 'https://evil.test/x' };
    const result = await client(() => Promise.resolve(json(200, { quick_fit: other, free_left: 1 }))).api.runQuickFit('tok', 'a1');
    expect(result.ok && result.data.quickFit.url).toBeNull();
    const credits = await client(() => Promise.resolve(json(402, { error: 'credits_required', price: 1, url: 'https://evil.test/x' }))).api.runQuickFit('tok', 'a1');
    expect(credits).toEqual({ ok: false, kind: 'credits_required', price: 1, url: null });
  });

  it('POST: cada error con su motivo', async () => {
    const run = (status: number, body: unknown) => client(() => Promise.resolve(json(status, body))).api.runQuickFit('tok', 'a1');
    expect(await run(402, { error: 'credits_required', price: 2, url: 'https://api.test/app/candidaturas/a1#encaje-expres' })).toEqual({
      ok: false,
      kind: 'credits_required',
      price: 2,
      url: 'https://api.test/app/candidaturas/a1#encaje-expres',
    });
    expect(await run(409, { error: 'report_exists', url: 'https://api.test/app/candidaturas/a1' })).toEqual({ ok: false, kind: 'report_exists', url: 'https://api.test/app/candidaturas/a1' });
    expect(await run(409, { error: 'running' })).toEqual({ ok: false, kind: 'running' });
    expect(await run(422, { error: 'no_posting' })).toEqual({ ok: false, kind: 'no_posting' });
    expect(await run(422, { error: 'no_profile' })).toEqual({ ok: false, kind: 'no_profile' });
    expect(await run(503, { error: 'unavailable' })).toEqual({ ok: false, kind: 'unavailable' });
    expect(await run(502, { error: 'failed', code: 'refused' })).toEqual({ ok: false, kind: 'failed', code: 'refused' });
    expect(await run(403, { error: 'insufficient_scope' })).toEqual({ ok: false, kind: 'insufficient_scope' });
    expect(await run(401, { error: 'unauthenticated' })).toEqual({ ok: false, kind: 'unauthenticated' });
    expect(await run(404, { error: 'not_found' })).toEqual({ ok: false, kind: 'not_found' });
    expect(await run(500, {})).toEqual({ ok: false, kind: 'server' });
  });
});

describe('documentos de una candidatura (CV-506, D-217)', () => {
  const DOCS = {
    lang: 'es',
    cv: { docx: true, pdf: false },
    letter: 'Carta de prueba.',
    message: 'Mensaje de prueba.',
    questions: [
      {
        generated_at: '2026-11-22T10:00:00+01:00',
        truncated: true,
        items: [
          { question: '¿Por qué esta empresa?', type: 'redactar', answer: 'Porque sí.', note: null },
          { question: 'Pretensión salarial', type: 'contesta_tu', answer: null, note: 'Elige tú la cifra.' },
        ],
      },
    ],
    url: 'https://api.test/app/candidaturas/a1',
  };
  const PARSED = {
    lang: 'es',
    cv: { docx: true, pdf: false },
    letter: 'Carta de prueba.',
    message: 'Mensaje de prueba.',
    questions: [
      {
        generatedAt: '2026-11-22T10:00:00+01:00',
        truncated: true,
        items: [
          { question: '¿Por qué esta empresa?', type: 'redactar', answer: 'Porque sí.', note: null },
          { question: 'Pretensión salarial', type: 'contesta_tu', answer: null, note: 'Elige tú la cifra.' },
        ],
      },
    ],
    url: 'https://api.test/app/candidaturas/a1',
  };

  it('/me: scopes opcional (un servidor viejo no lo envía)', async () => {
    const me = { email: 'ana@example.com', locale: 'es', browser: BROWSER };
    expect(await client(() => Promise.resolve(json(200, { ...me, scopes: ['tracker.read', 7] }))).api.getMe('tok')).toEqual({
      ok: true,
      data: { ...me, scopes: ['tracker.read'] },
    });
    const old = await client(() => Promise.resolve(json(200, me))).api.getMe('tok');
    expect(old.ok && old.data.scopes).toBeUndefined();
  });

  it('ready solo es true si la API lo dice con true', async () => {
    const query = { url: 'u', title: 't', company: 'c' };
    const ready = { match: 'url', application: { ...APPLICATION, ready: true } };
    const result = await client(() => Promise.resolve(json(200, ready))).api.matchOffer('tok', query);
    expect(result.ok && result.data?.application.ready).toBe(true);
    const odd = { match: 'url', application: { ...APPLICATION, ready: 'yes' } };
    const other = await client(() => Promise.resolve(json(200, odd))).api.matchOffer('tok', query);
    expect(other.ok && other.data?.application.ready).toBe(false);
  });

  it('GET documents: parsea y envía el token', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(200, { documents: DOCS })));
    expect(await api.getDocuments('tok', 'a1')).toEqual({ ok: true, data: PARSED });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/offers/a1/documents');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('GET documents: textos vacíos son null, la URL de otro origen no vale, un cuerpo raro es server', async () => {
    const odd = { ...DOCS, letter: '  ', message: null, questions: [], url: 'https://evil.test/x' };
    const result = await client(() => Promise.resolve(json(200, { documents: odd }))).api.getDocuments('tok', 'a1');
    expect(result.ok && [result.data.letter, result.data.message, result.data.questions, result.data.url]).toEqual([null, null, [], null]);
    expect(await client(() => Promise.resolve(json(200, { documents: { lang: 'es' } }))).api.getDocuments('tok', 'a1')).toEqual({ ok: false, kind: 'server' });
  });

  it('GET documents: cada error con su motivo', async () => {
    const run = (status: number, body: unknown) => client(() => Promise.resolve(json(status, body))).api.getDocuments('tok', 'a1');
    expect(await run(409, { error: 'not_ready' })).toEqual({ ok: false, kind: 'not_ready' });
    expect(await run(409, { error: 'otra' })).toEqual({ ok: false, kind: 'server' });
    expect(await run(403, { error: 'insufficient_scope' })).toEqual({ ok: false, kind: 'insufficient_scope' });
    expect(await run(404, { error: 'not_found' })).toEqual({ ok: false, kind: 'not_found' });
    expect(await run(401, {})).toEqual({ ok: false, kind: 'unauthenticated' });
    expect(await run(500, {})).toEqual({ ok: false, kind: 'server' });
  });

  it('POST downloads: envía el formato y solo acepta un enlace del propio Aplica', async () => {
    const link = { url: 'https://api.test/api/ext/v1/downloads/s3cret', expires_at: '2026-11-23T10:05:00Z' };
    const { api, fetchMock } = client(() => Promise.resolve(json(201, link)));
    expect(await api.requestDownload('tok', 'a1', 'pdf')).toEqual({ ok: true, data: { url: link.url, expiresAt: link.expires_at } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/offers/a1/downloads');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ format: 'pdf' });
    const evil = await client(() => Promise.resolve(json(201, { ...link, url: 'https://evil.test/f' }))).api.requestDownload('tok', 'a1', 'docx');
    expect(evil).toEqual({ ok: false, kind: 'server' });
  });

  it('POST downloads: errores', async () => {
    const run = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      client(() => Promise.resolve(json(status, body, headers))).api.requestDownload('tok', 'a1', 'docx');
    expect(await run(403, { error: 'insufficient_scope' })).toEqual({ ok: false, kind: 'insufficient_scope' });
    expect(await run(404, { error: 'not_found' })).toEqual({ ok: false, kind: 'not_found' });
    expect(await run(409, { error: 'not_ready' })).toEqual({ ok: false, kind: 'not_ready' });
    expect(await run(429, {}, { 'Retry-After': '10' })).toEqual({ ok: false, kind: 'rate_limited', retryAfter: 10 });
  });

  it('downloadFile: sin Authorization, con el nombre de Content-Disposition', async () => {
    const { api, fetchMock } = client(() =>
      Promise.resolve(new Response('contenido', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="CV Ana.docx"' } })),
    );
    const result = await api.downloadFile('https://api.test/api/ext/v1/downloads/s3cret', 'docx');
    expect(result.ok && result.data.filename).toBe('CV Ana.docx');
    expect(result.ok && (await result.data.blob.text())).toBe('contenido');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/downloads/s3cret');
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('downloadFile: filename* gana, se limpia y hay nombre por defecto', async () => {
    const name = async (header: string | null, format: 'docx' | 'pdf' = 'docx') => {
      const headers: Record<string, string> = header === null ? {} : { 'Content-Disposition': header };
      const r = await client(() => Promise.resolve(new Response('x', { status: 200, headers }))).api.downloadFile('https://api.test/d/1', format);
      return r.ok ? r.data.filename : null;
    };
    expect(await name(`attachment; filename="viejo.docx"; filename*=UTF-8''CV%20Mar%C3%ADa.docx`)).toBe('CV María.docx');
    expect(await name('attachment; filename=cv.pdf')).toBe('cv.pdf');
    expect(await name('attachment; filename="../../etc/passwd"')).toBe('_.._etc_passwd');
    expect(await name(null)).toBe('CV.docx');
    expect(await name('attachment', 'pdf')).toBe('CV.pdf');
    expect(await name(`attachment; filename*=UTF-8''%E0%A4%A`)).toBe('CV.docx');
  });

  it('downloadFile: otro origen no se pide; 410, 404 y red', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(new Response('x')));
    expect(await api.downloadFile('https://evil.test/f', 'docx')).toEqual({ ok: false, kind: 'server' });
    expect(fetchMock).not.toHaveBeenCalled();
    const run = (status: number) => client(() => Promise.resolve(json(status, { error: 'gone' }))).api.downloadFile('https://api.test/d/1', 'docx');
    expect(await run(410)).toEqual({ ok: false, kind: 'gone' });
    expect(await run(404)).toEqual({ ok: false, kind: 'not_found' });
    expect(await run(500)).toEqual({ ok: false, kind: 'server' });
    expect(await client(() => Promise.reject(new TypeError('x'))).api.downloadFile('https://api.test/d/1', 'pdf')).toEqual({ ok: false, kind: 'network' });
  });
});

describe('perfil para rellenar formularios (CV-507)', () => {
  const PROFILE_BODY = {
    profile: {
      lang: 'es',
      name: ' Ana Ejemplo Prueba ',
      email: 'ana@example.com',
      phone: null,
      location: 'Villanueva del Ejemplo',
      linkedin: 'https://www.linkedin.com/in/ana-ejemplo',
      github: '',
      websites: ['https://ana-ejemplo.example', '', 4],
      current_role: { title: 'Desarrolladora backend', company: null },
      years_experience: 6,
      education: ['Grado en Informática'],
      languages: ['Español', 'Inglés'],
    },
  };

  it('200: pide GET /profile con Bearer y devuelve el perfil con los textos limpios', async () => {
    const { api, fetchMock } = client(() => Promise.resolve(json(200, PROFILE_BODY)));
    const result = await api.getProfile('tok');
    expect(result).toEqual({
      ok: true,
      data: {
        lang: 'es',
        name: 'Ana Ejemplo Prueba',
        email: 'ana@example.com',
        phone: null,
        location: 'Villanueva del Ejemplo',
        linkedin: 'https://www.linkedin.com/in/ana-ejemplo',
        github: null,
        websites: ['https://ana-ejemplo.example'],
        currentRole: { title: 'Desarrolladora backend', company: null },
        yearsExperience: 6,
        education: ['Grado en Informática'],
        languages: ['Español', 'Inglés'],
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/ext/v1/profile');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('un perfil sin puesto ni años deja null, y un idioma desconocido pasa a español', async () => {
    const body = { profile: { lang: 'fr', name: null, websites: [], current_role: null, years_experience: 2.5, education: [], languages: [] } };
    const result = await client(() => Promise.resolve(json(200, body))).api.getProfile('tok');
    expect(result).toMatchObject({ ok: true, data: { lang: 'es', currentRole: null, yearsExperience: null, name: null } });
  });

  it('409 no_profile es que falta el perfil; otro 409 o un cuerpo raro, error del servidor', async () => {
    const run = (status: number, body: unknown) => client(() => Promise.resolve(json(status, body))).api.getProfile('tok');
    expect(await run(409, { error: 'no_profile' })).toEqual({ ok: false, kind: 'no_profile' });
    expect(await run(409, { error: 'otra' })).toEqual({ ok: false, kind: 'server' });
    expect(await run(200, { profile: 'x' })).toEqual({ ok: false, kind: 'server' });
    expect(await run(200, {})).toEqual({ ok: false, kind: 'server' });
  });

  it('401, 403 insufficient_scope, 429 y la red se tratan como en el resto de llamadas', async () => {
    const run = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      client(() => Promise.resolve(json(status, body, headers))).api.getProfile('tok');
    expect(await run(401, {})).toEqual({ ok: false, kind: 'unauthenticated' });
    expect(await run(403, { error: 'insufficient_scope' })).toEqual({ ok: false, kind: 'insufficient_scope' });
    expect(await run(429, {}, { 'Retry-After': '30' })).toEqual({ ok: false, kind: 'rate_limited', retryAfter: 30 });
    expect(await client(() => Promise.reject(new TypeError('x'))).api.getProfile('tok')).toEqual({ ok: false, kind: 'network' });
  });
});
