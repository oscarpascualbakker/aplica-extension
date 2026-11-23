// Cliente de la API de la extensión (CV-503). Contrato: /api/ext/v1.
// Nunca lanza: devuelve un resultado tipado. No registra tokens ni cuerpos en consola.

export type BrowserInfo = { id: string; label: string; connected_at: string };
export type TokenResponse = { token: string; token_type: 'Bearer'; browser: BrowserInfo };
/** `scopes` es opcional: un servidor anterior a CV-506 no lo envía (D-217). */
export type MeResponse = { email: string; locale: string; browser: BrowserInfo; scopes?: string[] };
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
  /** CV-508, D-220: guardarla ya como `enviada` (la página del ATS confirmó el envío y la persona pulsó). */
  sent?: boolean;
};

/**
 * Candidatura de la cuenta tal como la devuelve la API. `url` es null si no es de Aplica. `ready` es
 * true si ya tiene los documentos preparados (CV-506, D-217).
 */
export type ApplicationRef = { id: string; title: string; company: string; stage: string; url: string | null; ready: boolean };
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
  | { ok: true; data: { application: ApplicationRef; followUpAt: string | null } }
  | ({ ok: false } & (ApiError | { kind: 'duplicate'; match: MatchKind; application: ApplicationRef } | { kind: 'invalid'; fields: string[] }));

/** Etapas desde las que el panel propone marcar como enviada (CV-508): las anteriores al envío. */
export const STAGES_BEFORE_SENT: readonly string[] = ['guardada', 'preparada'];
/**
 * Marcar como enviada (CV-508, D-220). `followUpAt` es la fecha de seguimiento (YYYY-MM-DD) que Aplica propone
 * a los 7 días (D-214), o null. `changed` es false si ya estaba enviada. `stage`: ya está en una etapa
 * posterior y no se cambia.
 */
export type SentResult =
  | { ok: true; data: { application: ApplicationRef; followUpAt: string | null; changed: boolean } }
  | ({ ok: false } & (ApiError | { kind: 'stage'; application: ApplicationRef } | { kind: 'not_found' }));

/** Encaje exprés (CV-505): los mismos códigos de veredicto que el informe completo. */
export type QuickFitVerdict = 'apply' | 'apply_with_caveats' | 'do_not_apply';
export type QuickFitStatus = 'covered' | 'to_confirm' | 'missing';
export type QuickFitRequirement = { requirement: string; status: QuickFitStatus; note: string };
export type QuickFit = {
  verdict: QuickFitVerdict;
  verdictReason: string;
  requirements: QuickFitRequirement[];
  createdAt: string;
  /** La candidatura en la web, en el bloque del encaje exprés. Null si no es de Aplica. */
  url: string | null;
};
export type QuickFitState = { quickFit: QuickFit | null; freeLeft: number; price: number };

/** Por qué no se ha podido hacer una lectura exprés. Ninguno de estos casos gasta lectura ni créditos. */
export type QuickFitError =
  | { kind: 'credits_required'; price: number; url: string | null }
  | { kind: 'report_exists'; url: string | null }
  | { kind: 'running' }
  | { kind: 'no_posting' }
  | { kind: 'no_profile' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; code: string }
  | { kind: 'not_found' };

export type QuickFitResult =
  | { ok: true; data: { quickFit: QuickFit; freeLeft: number } }
  | ({ ok: false } & (ApiError | QuickFitError));

/** Documentos de una candidatura preparada (CV-506, D-217). Los textos son tal cual, para copiar. */
export type DocumentQuestionType = 'redactar' | 'contesta_tu';
export type DocumentQuestionItem = { question: string; type: DocumentQuestionType; answer: string | null; note: string | null };
export type DocumentQuestionSet = { generatedAt: string; truncated: boolean; items: DocumentQuestionItem[] };
export type DocumentFormat = 'docx' | 'pdf';
export type ApplicationDocuments = {
  lang: string;
  cv: { docx: boolean; pdf: boolean };
  letter: string | null;
  message: string | null;
  questions: DocumentQuestionSet[];
  /** La candidatura en la web. Null si no es de Aplica. */
  url: string | null;
};
/** `not_ready`: la candidatura aún no tiene documentos. `not_found`: no existe (o ese formato no está). */
export type DocumentsError = { kind: 'not_ready' } | { kind: 'not_found' };
export type DocumentsResult = { ok: true; data: ApplicationDocuments } | ({ ok: false } & (ApiError | DocumentsError));
export type DownloadLinkResult =
  | { ok: true; data: { url: string; expiresAt: string } }
  | ({ ok: false } & (ApiError | DocumentsError));
/** El enlace es de un solo uso y caduca a los 5 minutos: `gone` es que ya no vale. */
export type DownloadFileResult =
  | { ok: true; data: { blob: Blob; filename: string } }
  | ({ ok: false } & (ApiError | { kind: 'gone' } | { kind: 'not_found' }));

/** Datos del perfil para rellenar formularios (CV-507, alcance `profile.read`). Cada texto puede faltar. */
export type ProfileData = {
  lang: 'es' | 'en';
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  websites: string[];
  currentRole: { title: string | null; company: string | null } | null;
  yearsExperience: number | null;
  education: string[];
  languages: string[];
};
/** `no_profile`: la cuenta aún no tiene perfil (409). */
export type ProfileResult = { ok: true; data: ProfileData } | ({ ok: false } & (ApiError | { kind: 'no_profile' }));

export type ApiClient = {
  exchangeToken(request: TokenRequest): Promise<ApiResult<TokenResponse>>;
  getMe(token: string): Promise<ApiResult<MeResponse>>;
  revokeToken(token: string): Promise<ApiResult<null>>;
  /** ¿Ya está esta oferta en la cuenta? (CV-504) */
  matchOffer(token: string, query: { url: string; title: string; company: string }): Promise<ApiResult<MatchResponse>>;
  /** Guarda la oferta como candidatura `guardada` (o `enviada`, con `sent`, CV-508), gratis (CV-504). */
  saveOffer(token: string, offer: OfferPayload): Promise<SaveResult>;
  /** Marca como enviada una candidatura de la cuenta (CV-508, alcance `offers.save`). Nunca la retrasa. */
  markSent(token: string, applicationId: string): Promise<SentResult>;
  /** La última lectura exprés de una candidatura y las gratis que quedan hoy (CV-505). `not_found` si está apagada. */
  getQuickFit(token: string, applicationId: string): Promise<ApiResult<QuickFitState> | { ok: false; kind: 'not_found' }>;
  /** Una lectura exprés nueva, solo gratuita: el token no gasta créditos (D-204). */
  runQuickFit(token: string, applicationId: string): Promise<QuickFitResult>;
  /** Los documentos de una candidatura preparada (CV-506, alcance `documents.read`). */
  getDocuments(token: string, applicationId: string): Promise<DocumentsResult>;
  /** Pide un enlace de descarga del CV, de un solo uso (CV-506). El token no gasta créditos (D-204). */
  requestDownload(token: string, applicationId: string, format: DocumentFormat): Promise<DownloadLinkResult>;
  /** Baja el fichero del enlace, sin Authorization: el secreto va en la URL (CV-506, D-217). */
  downloadFile(url: string, format: DocumentFormat): Promise<DownloadFileResult>;
  /** Los datos del perfil para rellenar formularios (CV-507, alcance `profile.read`). El panel no los guarda. */
  getProfile(token: string): Promise<ProfileResult>;
};

const TIMEOUT_MS = 15_000;
// Bajar un DOCX o un PDF puede tardar más que una consulta.
const DOWNLOAD_TIMEOUT_MS = 60_000;
// La lectura exprés es síncrona: la IA tarda unos segundos, y un reintento del servidor, otros tantos.
const QUICK_FIT_TIMEOUT_MS = 90_000;

const VERDICTS: readonly string[] = ['apply', 'apply_with_caveats', 'do_not_apply'];
const STATUSES: readonly string[] = ['covered', 'to_confirm', 'missing'];

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
  if (!browser) return null;
  const me: MeResponse = { email: body.email, locale: body.locale, browser };
  if (Array.isArray(body.scopes)) me.scopes = body.scopes.filter((s): s is string => typeof s === 'string');
  return me;
}

/** La URL viene del servidor y se abre en una pestaña: solo si es del propio Aplica. */
function sameOrigin(url: unknown, apiBase: string): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).origin === new URL(apiBase).origin ? url : null;
  } catch {
    return null;
  }
}

function parseApplication(value: unknown, apiBase: string): ApplicationRef | null {
  if (!isObject(value)) return null;
  const { id, title, company, stage, url } = value;
  const ref = typeof id === 'number' ? String(id) : id;
  if (typeof ref !== 'string' || ref === '' || typeof title !== 'string' || typeof company !== 'string') return null;
  return {
    id: ref,
    title,
    company,
    stage: typeof stage === 'string' ? stage : '',
    url: sameOrigin(url, apiBase),
    ready: value.ready === true,
  };
}

function parseRequirement(value: unknown): QuickFitRequirement | null {
  if (!isObject(value)) return null;
  const { requirement, status, note } = value;
  if (typeof requirement !== 'string' || typeof status !== 'string' || !STATUSES.includes(status)) return null;
  return { requirement, status: status as QuickFitStatus, note: typeof note === 'string' ? note : '' };
}

/** Una lectura exprés que no se entiende entera no se enseña a medias. */
function parseQuickFit(value: unknown, apiBase: string): QuickFit | null {
  if (!isObject(value)) return null;
  const { verdict, verdict_reason, requirements, created_at, url } = value;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict) || typeof verdict_reason !== 'string') return null;
  if (!Array.isArray(requirements) || requirements.length === 0) return null;
  const parsed = requirements.map(parseRequirement);
  if (parsed.some((r) => r === null)) return null;
  return {
    verdict: verdict as QuickFitVerdict,
    verdictReason: verdict_reason,
    requirements: parsed as QuickFitRequirement[],
    createdAt: typeof created_at === 'string' ? created_at : '',
    url: sameOrigin(url, apiBase),
  };
}

/** Una fecha `YYYY-MM-DD` del servidor (CV-508); cualquier otra cosa, null. */
function dateOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseQuestionItem(value: unknown): DocumentQuestionItem | null {
  if (!isObject(value)) return null;
  const { question, type, answer, note } = value;
  if (typeof question !== 'string' || (type !== 'redactar' && type !== 'contesta_tu')) return null;
  return { question, type, answer: nonEmptyText(answer), note: nonEmptyText(note) };
}

function parseQuestionSet(value: unknown): DocumentQuestionSet | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseQuestionItem).filter((i): i is DocumentQuestionItem => i !== null);
  return {
    generatedAt: typeof value.generated_at === 'string' ? value.generated_at : '',
    truncated: value.truncated === true,
    items,
  };
}

/** Documentos que no se entienden enteros no se enseñan a medias (CV-506). */
function parseDocuments(value: unknown, apiBase: string): ApplicationDocuments | null {
  if (!isObject(value) || !isObject(value.cv)) return null;
  const questions = Array.isArray(value.questions) ? value.questions.map(parseQuestionSet) : [];
  return {
    lang: typeof value.lang === 'string' ? value.lang : '',
    cv: { docx: value.cv.docx === true, pdf: value.cv.pdf === true },
    letter: nonEmptyText(value.letter),
    message: nonEmptyText(value.message),
    questions: questions.filter((q): q is DocumentQuestionSet => q !== null && q.items.length > 0),
    url: sameOrigin(value.url, apiBase),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOrNull).filter((v): v is string => v !== null) : [];
}

/** Perfil que no tiene la forma esperada: no se usa (CV-507). */
function parseProfile(value: unknown): ProfileData | null {
  if (!isObject(value)) return null;
  const role = isObject(value.current_role) ? { title: textOrNull(value.current_role.title), company: textOrNull(value.current_role.company) } : null;
  const years = value.years_experience;
  return {
    lang: value.lang === 'en' ? 'en' : 'es',
    name: textOrNull(value.name),
    email: textOrNull(value.email),
    phone: textOrNull(value.phone),
    location: textOrNull(value.location),
    linkedin: textOrNull(value.linkedin),
    github: textOrNull(value.github),
    websites: textList(value.websites),
    currentRole: role,
    yearsExperience: typeof years === 'number' && Number.isInteger(years) && years >= 0 ? years : null,
    education: textList(value.education),
    languages: textList(value.languages),
  };
}

/** Nombre del fichero de `Content-Disposition` (`filename*` antes que `filename`), sin rutas ni caracteres raros. */
export function filenameFrom(header: string | null, fallback: string): string {
  let name: string | null = null;
  if (header) {
    const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
    if (encoded?.[1]) {
      try {
        name = decodeURIComponent(encoded[1].trim());
      } catch {
        name = null;
      }
    }
    if (!name) {
      const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
      name = (plain?.[1] ?? plain?.[2] ?? '').trim() || null;
    }
  }
  // Los caracteres de control se quitan a propósito del nombre del fichero.
  const clean = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return clean === '' ? fallback : clean;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
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
    init: { method: string; token?: string; json?: unknown; timeoutMs?: number },
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
        signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
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

  async function documentsFailure(response: Response): Promise<{ ok: false } & (ApiError | DocumentsError)> {
    if (response.status === 404) return { ok: false, kind: 'not_found' };
    if (response.status === 409) {
      return errorCode(await readJson(response)) === 'not_ready' ? { ok: false, kind: 'not_ready' } : { ok: false, kind: 'server' };
    }
    return { ok: false, ...(await failure(response)) };
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
        const followUpAt = isObject(body) && isObject(body.application) ? dateOrNull(body.application.follow_up_at) : null;
        return application ? { ok: true, data: { application, followUpAt } } : { ok: false, kind: 'server' };
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

    async markSent(token, applicationId) {
      const result = await request(`/offers/${encodeURIComponent(applicationId)}/sent`, { method: 'POST', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status === 200) {
        const body = await readJson(response);
        const application = isObject(body) ? parseApplication(body.application, apiBase) : null;
        if (!application || !isObject(body) || !isObject(body.application)) return { ok: false, kind: 'server' };
        return { ok: true, data: { application, followUpAt: dateOrNull(body.application.follow_up_at), changed: body.changed === true } };
      }
      if (response.status === 404) return { ok: false, kind: 'not_found' };
      if (response.status === 409) {
        const body = await readJson(response);
        const application = isObject(body) ? parseApplication(body.application, apiBase) : null;
        return errorCode(body) === 'stage' && application ? { ok: false, kind: 'stage', application } : { ok: false, kind: 'server' };
      }
      return { ok: false, ...(await failure(response)) };
    },

    async getQuickFit(token, applicationId) {
      const result = await request(`/offers/${encodeURIComponent(applicationId)}/quick-fit`, { method: 'GET', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      // Con la funcionalidad apagada (o una candidatura que ya no existe), el panel no enseña el bloque.
      if (response.status === 404) return { ok: false, kind: 'not_found' };
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      const body = await readJson(response);
      if (!isObject(body)) return { ok: false, kind: 'server' };
      return {
        ok: true,
        data: { quickFit: parseQuickFit(body.quick_fit, apiBase), freeLeft: count(body.free_left), price: count(body.price) },
      };
    },

    async runQuickFit(token, applicationId) {
      const result = await request(`/offers/${encodeURIComponent(applicationId)}/quick-fit`, {
        method: 'POST',
        token,
        timeoutMs: QUICK_FIT_TIMEOUT_MS,
      });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      // Los comunes (401, 429) no necesitan el cuerpo; el resto se decide con él, leído una sola vez.
      if (response.status === 401 || response.status === 429) return { ok: false, ...(await failure(response)) };
      const body = await readJson(response);
      if (response.status === 200) {
        const quickFit = isObject(body) ? parseQuickFit(body.quick_fit, apiBase) : null;
        return quickFit && isObject(body)
          ? { ok: true, data: { quickFit, freeLeft: count(body.free_left) } }
          : { ok: false, kind: 'server' };
      }
      if (response.status === 404) return { ok: false, kind: 'not_found' };
      const code = errorCode(body);
      const url = isObject(body) ? sameOrigin(body.url, apiBase) : null;
      if (response.status === 402 && code === 'credits_required') {
        return { ok: false, kind: 'credits_required', price: isObject(body) ? count(body.price) : 0, url };
      }
      if (response.status === 409 && code === 'report_exists') return { ok: false, kind: 'report_exists', url };
      if (response.status === 409 && code === 'running') return { ok: false, kind: 'running' };
      if (response.status === 422 && (code === 'no_posting' || code === 'no_profile')) return { ok: false, kind: code };
      if (response.status === 503 && code === 'unavailable') return { ok: false, kind: 'unavailable' };
      if (response.status === 502 && code === 'failed') {
        const reason = isObject(body) && typeof body.code === 'string' ? body.code : 'internal';
        return { ok: false, kind: 'failed', code: reason };
      }
      if (response.status === 403 && code === 'insufficient_scope') return { ok: false, kind: 'insufficient_scope' };
      return { ok: false, kind: 'server' };
    },

    async getDocuments(token, applicationId) {
      const result = await request(`/offers/${encodeURIComponent(applicationId)}/documents`, { method: 'GET', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 200) return documentsFailure(response);
      const body = await readJson(response);
      const data = isObject(body) ? parseDocuments(body.documents, apiBase) : null;
      return data ? { ok: true, data } : { ok: false, kind: 'server' };
    },

    async requestDownload(token, applicationId, format) {
      const result = await request(`/offers/${encodeURIComponent(applicationId)}/downloads`, {
        method: 'POST',
        token,
        json: { format },
      });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status !== 201) return documentsFailure(response);
      const body = await readJson(response);
      const url = isObject(body) ? sameOrigin(body.url, apiBase) : null;
      if (!url || !isObject(body)) return { ok: false, kind: 'server' };
      return { ok: true, data: { url, expiresAt: typeof body.expires_at === 'string' ? body.expires_at : '' } };
    },

    async getProfile(token) {
      const result = await request('/profile', { method: 'GET', token });
      if ('error' in result) return { ok: false, ...result.error };
      const { response } = result;
      if (response.status === 409) {
        return errorCode(await readJson(response)) === 'no_profile' ? { ok: false, kind: 'no_profile' } : { ok: false, kind: 'server' };
      }
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      const body = await readJson(response);
      const data = isObject(body) ? parseProfile(body.profile) : null;
      return data ? { ok: true, data } : { ok: false, kind: 'server' };
    },

    async downloadFile(url, format) {
      // Sin Authorization: el secreto va en la URL. Y solo se pide si es del propio Aplica.
      if (!sameOrigin(url, apiBase)) return { ok: false, kind: 'server' };
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, kind: 'network' };
      }
      if (response.status === 410) return { ok: false, kind: 'gone' };
      if (response.status === 404) return { ok: false, kind: 'not_found' };
      if (response.status !== 200) return { ok: false, ...(await failure(response)) };
      try {
        const blob = await response.blob();
        return { ok: true, data: { blob, filename: filenameFrom(response.headers.get('Content-Disposition'), `CV.${format}`) } };
      } catch {
        return { ok: false, kind: 'network' };
      }
    },
  };
}
