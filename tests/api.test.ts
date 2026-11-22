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

const APPLICATION = { id: 'a1', title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', stage: 'saved', url: 'https://api.test/app/candidaturas/a1' };
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
