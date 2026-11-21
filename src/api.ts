// Cliente de la API de la extensión (CV-503). Contrato: /api/ext/v1.
// Nunca lanza: devuelve un resultado tipado. No registra tokens ni cuerpos en consola.

export type BrowserInfo = { id: string; label: string; connected_at: string };
export type TokenResponse = { token: string; token_type: 'Bearer'; browser: BrowserInfo };
export type MeResponse = { email: string; locale: string; browser: BrowserInfo };
export type TokenRequest = { code: string; code_verifier: string; redirect_uri: string };

export type OfferPayload = {
  url: string;
  title: string;
  company: string;
  location: string;
  work_mode: string | null;
  salary: string;
  description: string;
  portal: string;
  force: boolean;
};

/** Candidatura de la cuenta tal como la devuelve la API. `url` es null si no es de Aplica. */
export type ApplicationRef = { id: string; title: string; company: string; stage: string; url: string | null };
export type MatchKind = 'url' | 'role_company';
export type MatchResponse = { match: MatchKind; application: ApplicationRef } | null;

export type ApiError =
  | { kind: 'invalid_grant' }
  | { kind: 'unauthenticated' }
  | { kind: 'insufficient_scope' }
  | { kind: 'rate_limited'; retryAfter: number | null }
  | { kind: 'network' }
  | { kind: 'server' };

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);

/** Lo que necesita la sesión (CV-503): la parte de autenticación del cliente. */
export type AuthApi = Pick<ApiClient, 'exchangeToken' | 'getMe' | 'revokeToken'>;

/** Guardar oferta (CV-504): además de los errores comunes, duplicado y campos inválidos. */
export type SaveResult =
  | { ok: true; data: { application: ApplicationRef } }
  | ({ ok: false } & (ApiError | { kind: 'duplicate'; match: MatchKind; application: ApplicationRef } | { kind: 'invalid'; fields: string[] }));

export type ApiClient = {
  exchangeToken(request: TokenRequest): Promise<ApiResult<TokenResponse>>;
  getMe(token: string): Promise<ApiResult<MeResponse>>;
  revokeToken(token: string): Promise<ApiResult<null>>;
  /** ¿Ya está esta oferta en la cuenta? (CV-504) */
  matchOffer(token: string, query: { url: string; title: string; company: string }): Promise<ApiResult<MatchResponse>>;
  /** Guarda la oferta como candidatura `guardada`, gratis (CV-504). */
  saveOffer(token: string, offer: OfferPayload): Promise<SaveResult>;
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

function parseApplication(value: unknown, apiBase: string): ApplicationRef | null {
  if (!isObject(value)) return null;
  const { id, title, company, stage, url } = value;
  const ref = typeof id === 'number' ? String(id) : id;
  if (typeof ref !== 'string' || ref === '' || typeof title !== 'string' || typeof company !== 'string') return null;
  // La URL viene del servidor y se abre en una pestaña: solo si es del propio Aplica.
  let safeUrl: string | null = null;
  if (typeof url === 'string') {
    try {
      safeUrl = new URL(url).origin === new URL(apiBase).origin ? url : null;
    } catch {
      safeUrl = null;
    }
  }
  return { id: ref, title, company, stage: typeof stage === 'string' ? stage : '', url: safeUrl };
}

function matchKind(value: unknown): MatchKind | null {
  return value === 'url' || value === 'role_company' ? value : null;
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
    if (response.status === 403 && errorCode(await readJson(response)) === 'insufficient_scope') {
      return { kind: 'insufficient_scope' };
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

    async matchOffer(token, query) {
      const params = new URLSearchParams({ url: query.url, title: query.title, company: query.company });
      const result = await request(`/offers/match?${params.toString()}`, { method: 'GET', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      const body = await readJson(response);
      const match = isObject(body) ? matchKind(body.match) : null;
      const application = isObject(body) ? parseApplication(body.application, apiBase) : null;
      // Sin coincidencia (o con un cuerpo que no se entiende) no hay nada que avisar.
      return { ok: true, data: match && application ? { match, application } : null };
    },

    async saveOffer(token, offer) {
      const result = await request('/offers', { method: 'POST', token, json: offer });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status === 201) {
        const body = await readJson(response);
        const application = isObject(body) ? parseApplication(body.application, apiBase) : null;
        return application ? { ok: true, data: { application } } : { ok: false, kind: 'server' };
      }
      if (response.status === 409) {
        const body = await readJson(response);
        const code = errorCode(body);
        const match = isObject(body) ? matchKind(body.match) : null;
        const application = isObject(body) ? parseApplication(body.application, apiBase) : null;
        const expected = code === 'duplicate' ? 'url' : code === 'possible_duplicate' ? 'role_company' : null;
        if (match && match === expected && application) return { ok: false, kind: 'duplicate', match, application };
        return { ok: false, kind: 'server' };
      }
      if (response.status === 422) {
        const body = await readJson(response);
        const fields = isObject(body) && Array.isArray(body.fields) ? body.fields : [];
        return { ok: false, kind: 'invalid', fields: fields.filter((f): f is string => typeof f === 'string') };
      }
      return { ok: false, ...(await failure(response)) };
    },
  };
}
