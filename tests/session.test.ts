import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiResult, MeResponse, TokenResponse } from '../src/api';
import { createSession, type SessionDeps } from '../src/session';
import type { TokenStore } from '../src/token-store';

function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

const REDIRECT = 'https://abc.chromiumapp.org/';
const BROWSER = { id: 'b1', label: 'Chrome', connected_at: '2026-11-21T10:00:00Z' };

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    get: () => Promise.resolve(store.value),
    set: (token: string) => {
      store.value = token;
      return Promise.resolve();
    },
    clear: () => {
      store.value = null;
      return Promise.resolve();
    },
  };
  return store;
}

function setup(overrides: { api?: Partial<ApiClient>; launch?: SessionDeps['launchWebAuthFlow']; token?: string | null } = {}) {
  const tokenStore = memoryStore(overrides.token ?? null);
  const api: ApiClient = {
    exchangeToken: vi.fn((): Promise<ApiResult<TokenResponse>> =>
      Promise.resolve({ ok: true, data: { token: 'secret', token_type: 'Bearer', browser: BROWSER } })),
    getMe: vi.fn((): Promise<ApiResult<MeResponse>> =>
      Promise.resolve({ ok: true, data: { email: 'ana@example.com', locale: 'es', browser: BROWSER } })),
    revokeToken: vi.fn((): Promise<ApiResult<null>> => Promise.resolve({ ok: true, data: null })),
    ...overrides.api,
  };
  const launched: string[] = [];
  const launch =
    overrides.launch ??
    ((url: string) => {
      launched.push(url);
      const state = stateOf(url);
      return Promise.resolve(`${REDIRECT}?code=abc&state=${state}`);
    });
  const session = createSession({
    api,
    tokenStore,
    apiBase: 'https://api.test',
    browser: 'firefox',
    redirectUrl: REDIRECT,
    launchWebAuthFlow: launch,
  });
  return { session, api, tokenStore, launched };
}

describe('connect', () => {
  it('construye la URL del contrato, canjea el código y guarda el token', async () => {
    const { session, api, tokenStore, launched } = setup();
    expect(await session.connect()).toEqual({ status: 'connected' });

    const url = new URL(launched[0] as string);
    expect(url.origin + url.pathname).toBe('https://api.test/app/extension/conectar');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('browser')).toBe('firefox');

    const sent = vi.mocked(api.exchangeToken).mock.calls[0]?.[0];
    expect(sent?.code).toBe('abc');
    expect(sent?.redirect_uri).toBe(REDIRECT);
    expect(sent?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenStore.value).toBe('secret');
  });

  it('aborta si el state no coincide, sin canjear', async () => {
    const { session, api, tokenStore } = setup({
      launch: () => Promise.resolve(`${REDIRECT}?code=abc&state=otro`),
    });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'invalid' });
    expect(api.exchangeToken).not.toHaveBeenCalled();
    expect(tokenStore.value).toBeNull();
  });

  it('aborta si falta el state', async () => {
    const { session, api } = setup({ launch: () => Promise.resolve(`${REDIRECT}?code=abc`) });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'invalid' });
    expect(api.exchangeToken).not.toHaveBeenCalled();
  });

  it('access_denied con state correcto: denied', async () => {
    const { session, api } = setup({
      launch: (url) => Promise.resolve(`${REDIRECT}?error=access_denied&state=${stateOf(url)}`),
    });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'denied' });
    expect(api.exchangeToken).not.toHaveBeenCalled();
  });

  it('invalid_request con state correcto: invalid', async () => {
    const { session } = setup({
      launch: (url) => Promise.resolve(`${REDIRECT}?error=invalid_request&state=${stateOf(url)}`),
    });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'invalid' });
  });

  it('el flujo cancelado o rechazado: cancelled', async () => {
    const { session } = setup({ launch: () => Promise.reject(new Error('The user did not approve access.')) });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'cancelled' });
  });

  it('invalid_grant en el canje: invalid y sin token', async () => {
    const { session, tokenStore } = setup({
      api: { exchangeToken: () => Promise.resolve({ ok: false, kind: 'invalid_grant' }) },
    });
    expect(await session.connect()).toEqual({ status: 'failed', reason: 'invalid' });
    expect(tokenStore.value).toBeNull();
  });

  it('red y 429 en el canje se propagan', async () => {
    const net = setup({ api: { exchangeToken: () => Promise.resolve({ ok: false, kind: 'network' }) } });
    expect(await net.session.connect()).toEqual({ status: 'failed', reason: 'network' });
    const limited = setup({
      api: { exchangeToken: () => Promise.resolve({ ok: false, kind: 'rate_limited', retryAfter: null }) },
    });
    expect(await limited.session.connect()).toEqual({ status: 'failed', reason: 'rate_limited' });
  });
});

describe('refresh', () => {
  it('sin token: disconnected, sin llamar a la API', async () => {
    const { session, api } = setup();
    expect(await session.refresh()).toEqual({ status: 'disconnected' });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('con token válido: connected con el email', async () => {
    const { session } = setup({ token: 'tok' });
    const outcome = await session.refresh();
    expect(outcome.status === 'connected' && outcome.me.email).toBe('ana@example.com');
  });

  it('401: borra el token y avisa de revocación', async () => {
    const { session, tokenStore } = setup({
      token: 'tok',
      api: { getMe: () => Promise.resolve({ ok: false, kind: 'unauthenticated' }) },
    });
    expect(await session.refresh()).toEqual({ status: 'revoked' });
    expect(tokenStore.value).toBeNull();
  });

  it('red y 429: error y el token se conserva', async () => {
    const net = setup({ token: 'tok', api: { getMe: () => Promise.resolve({ ok: false, kind: 'network' }) } });
    expect(await net.session.refresh()).toEqual({ status: 'error', reason: 'network' });
    expect(net.tokenStore.value).toBe('tok');
    const limited = setup({
      token: 'tok',
      api: { getMe: () => Promise.resolve({ ok: false, kind: 'rate_limited', retryAfter: 5 }) },
    });
    expect(await limited.session.refresh()).toEqual({ status: 'error', reason: 'rate_limited' });
    expect(limited.tokenStore.value).toBe('tok');
  });
});

describe('disconnect', () => {
  it('204: borra el token local', async () => {
    const { session, tokenStore, api } = setup({ token: 'tok' });
    expect(await session.disconnect()).toEqual({ status: 'disconnected' });
    expect(api.revokeToken).toHaveBeenCalledWith('tok');
    expect(tokenStore.value).toBeNull();
  });

  it('401 (ya revocado): también lo borra', async () => {
    const { session, tokenStore } = setup({
      token: 'tok',
      api: { revokeToken: () => Promise.resolve({ ok: false, kind: 'unauthenticated' }) },
    });
    expect(await session.disconnect()).toEqual({ status: 'disconnected' });
    expect(tokenStore.value).toBeNull();
  });

  it('error de red: conserva el token y avisa', async () => {
    const { session, tokenStore } = setup({
      token: 'tok',
      api: { revokeToken: () => Promise.resolve({ ok: false, kind: 'network' }) },
    });
    expect(await session.disconnect()).toEqual({ status: 'error', reason: 'network' });
    expect(tokenStore.value).toBe('tok');
  });
});
