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
