// Cliente de la API de la extensión (CV-503). Contrato: /api/ext/v1.
// Nunca lanza: devuelve un resultado tipado. No registra tokens ni cuerpos en consola.

export type BrowserInfo = { id: string; label: string; connected_at: string };
export type TokenResponse = { token: string; token_type: 'Bearer'; browser: BrowserInfo };
export type MeResponse = { email: string; locale: string; browser: BrowserInfo };
export type TokenRequest = { code: string; code_verifier: string; redirect_uri: string };

export type ApiError =
  | { kind: 'invalid_grant' }
  | { kind: 'unauthenticated' }
  | { kind: 'rate_limited'; retryAfter: number | null }
  | { kind: 'network' }
  | { kind: 'server' };

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);

export type ApiClient = {
  exchangeToken(request: TokenRequest): Promise<ApiResult<TokenResponse>>;
  getMe(token: string): Promise<ApiResult<MeResponse>>;
  revokeToken(token: string): Promise<ApiResult<null>>;
};

const TIMEOUT_MS = 15_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseBrowser(value: unknown): BrowserInfo | null {
  if (!isObject(value)) return null;
  const { id, label, connected_at } = value;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof connected_at !== 'string') {
    return null;
  }
  return { id, label, connected_at };
}

function parseToken(body: unknown): TokenResponse | null {
  if (!isObject(body) || typeof body.token !== 'string' || body.token === '') return null;
  const browser = parseBrowser(body.browser);
  if (body.token_type !== 'Bearer' || !browser) return null;
  return { token: body.token, token_type: 'Bearer', browser };
}

function parseMe(body: unknown): MeResponse | null {
  if (!isObject(body) || typeof body.email !== 'string' || typeof body.locale !== 'string') {
    return null;
  }
  const browser = parseBrowser(body.browser);
  return browser ? { email: body.email, locale: body.locale, browser } : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCode(body: unknown): string | null {
  return isObject(body) && typeof body.error === 'string' ? body.error : null;
}

export function createApiClient(apiBase: string, fetchImpl: typeof fetch = fetch): ApiClient {
  const base = `${apiBase}/api/ext/v1`;

  async function request(
    path: string,
    init: { method: string; token?: string; json?: unknown },
  ): Promise<{ response: Response } | { error: ApiError }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { response };
    } catch {
      return { error: { kind: 'network' } };
    }
  }

  // Errores comunes a todas las llamadas.
  async function failure(response: Response): Promise<ApiError> {
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      return { kind: 'rate_limited', retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
    }
    if (response.status === 400 && errorCode(await readJson(response)) === 'invalid_grant') {
      return { kind: 'invalid_grant' };
    }
    return { kind: 'server' };
  }

  return {
    async exchangeToken(body) {
      const result = await request('/token', { method: 'POST', json: body });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      const data = parseToken(await readJson(response));
      return data ? { ok: true, data } : { ok: false, kind: 'server' };
    },

    async getMe(token) {
      const result = await request('/me', { method: 'GET', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      const data = parseMe(await readJson(response));
      return data ? { ok: true, data } : { ok: false, kind: 'server' };
    },

    async revokeToken(token) {
      const result = await request('/token', { method: 'DELETE', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 204) return { ok: false, ...(await failure(response)) };
      return { ok: true, data: null };
    },
  };
}
