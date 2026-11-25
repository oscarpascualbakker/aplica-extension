// @vitest-environment happy-dom
// Panel: registrar sola la candidatura como enviada al terminar el formulario (CV-508, D-220). Con el
// navegador y la API simulados. Nada cambia hasta que la persona pulsa. Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api';
import { findSentCandidate, type Remembered } from '../src/panel/sent-run';

const API = 'https://api.test';
const OFFER_URL = 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001';
const THANKS_URL = `${OFFER_URL}/thanks`;
const APP = { id: 'a1', title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', stage: 'guardada', url: `${API}/app/candidaturas/a1`, ready: false };
const SENT = { ...APP, stage: 'enviada', sent_at: '2026-11-23', follow_up_at: '2026-11-30' };
const EXTRACTED = {
  title: 'Desarrolladora backend',
  company: 'Empresa Ficticia S.L.',
  location: 'Villanueva del Ejemplo',
  workMode: 'hibrido',
  salary: '',
  description: 'Texto de la oferta',
  portal: 'lever',
  descriptionFromSelection: false,
  descriptionTruncated: false,
};
const CONFIRMATION = { ats: 'lever', offerUrl: OFFER_URL, title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.' };

type Reply = { status: number; body?: unknown };
type Listener = (tabId: number, changeInfo: { status?: string }, tab: { active: boolean; url?: string; windowId: number }) => void;
type Env = {
  calls: { url: string; method: string; body: unknown }[];
  created: string[];
  replies: Record<string, Reply>;
  tabUrl: string;
  /** Lo que devuelve detect.js en la pestaña. */
  confirmation: unknown;
  injected: string[];
  listeners: Listener[];
};

function setup(overrides: Partial<Env> = {}): Env {
  const env: Env = {
    calls: [],
    created: [],
    replies: {
      'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
      'GET /offers/match': { status: 200, body: { match: null } },
    },
    tabUrl: OFFER_URL,
    confirmation: null,
    injected: [],
    listeners: [],
    ...overrides,
  };
  vi.stubGlobal('__API_BASE__', API);
  vi.stubGlobal('__DEV_BUILD__', false);
  const storage: Record<string, unknown> = { 'aplica.token': 'tok' };
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => `nav:${key}` },
    runtime: { getURL: (path: string) => `chrome-extension://abc/${path}`, onMessage: { addListener: () => undefined } },
    identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow: () => Promise.resolve(undefined) },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in storage ? { [key]: storage[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(storage, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          Reflect.deleteProperty(storage, key);
          return Promise.resolve();
        },
      },
    },
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: env.tabUrl }]),
      create: ({ url }: { url: string }) => {
        env.created.push(url);
        return Promise.resolve();
      },
      onUpdated: { addListener: (listener: Listener) => env.listeners.push(listener) },
      onRemoved: { addListener: () => undefined },
    },
    scripting: {
      executeScript: ({ files }: { files?: string[] }) => {
        const file = files?.[0] ?? '';
        env.injected.push(file);
        if (file === 'extract.js') return Promise.resolve([{ result: EXTRACTED }]);
        if (file === 'detect.js') return Promise.resolve([{ result: env.confirmation }]);
        return Promise.resolve([{ result: undefined }]);
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.startsWith('chrome-extension://')) {
        const lang = /_locales\/(\w+)\//.exec(input)?.[1] ?? 'es';
        return Promise.resolve(new Response(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')));
      }
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      const route = `${method} ${url.pathname.replace('/api/ext/v1', '')}`;
      env.calls.push({ url: input, method, body: init?.body ? JSON.parse(init.body as string) : null });
      const reply = env.replies[route] ?? { status: 404 };
      return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }));
    }),
  );
  document.body.innerHTML = '<main id="app"></main><div id="live" role="status" aria-live="polite"></div>';
  return env;
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`No ha llegado a mostrarse: ${document.body.textContent}`);
}

const heading = (): string | null | undefined => document.querySelector('h1')?.textContent;
const body = (): string => document.body.textContent;
const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name);
const apiCalls = (env: Env, method: string, path: string) => env.calls.filter((c) => c.method === method && new URL(c.url).pathname === `/api/ext/v1${path}`);

async function openPanel(env: Env, expected = 'Guardar oferta'): Promise<void> {
  vi.resetModules();
  await import('../src/panel/panel');
  await until(() => heading() === expected && env.listeners.length > 0);
}

/** La pestaña activa termina de cargar `url` (en la ventana del panel, salvo que se diga otra). */
function loaded(env: Env, url: string, windowId = 1): void {
  env.tabUrl = url;
  for (const listener of env.listeners) listener(7, { status: 'complete' }, { active: true, url, windowId });
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('panel: aviso de candidatura enviada', () => {
  it('con la oferta guardada en esa pestaña, la confirmación pregunta y un clic la marca, con el seguimiento a 7 días', async () => {
    const env = setup();
    env.replies['POST /offers'] = { status: 201, body: { application: APP } };
    env.replies['POST /offers/a1/sent'] = { status: 200, body: { application: SENT, changed: true } };
    await openPanel(env);
    buttonNamed('Guardar en Aplica')?.click();
    await until(() => heading() === 'Oferta guardada');

    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    expect(body()).toContain('Esta página confirma el envío de tu candidatura a Desarrolladora backend en Empresa Ficticia S.L.');
    // Ya sabía cuál era: ni consulta ni cambio hasta pulsar.
    expect(apiCalls(env, 'GET', '/offers/match')).toHaveLength(1);
    expect(apiCalls(env, 'POST', '/offers/a1/sent')).toHaveLength(0);

    buttonNamed('Marcarla como enviada')?.click();
    await until(() => heading() === 'Marcada como enviada');
    expect(apiCalls(env, 'POST', '/offers/a1/sent')).toHaveLength(1);
    expect(body()).toContain('Desarrolladora backend en Empresa Ficticia S.L. está en tu cuenta como enviada.');
    expect(body()).toContain('Te lo recordaremos el 30 de noviembre de 2026.');
    buttonNamed('Abrir en Aplica')?.click();
    expect(env.created).toEqual([APP.url]);
  });

  it('sin saber la oferta, la busca en la cuenta y propone la que coincide', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: APP } };
    env.replies['POST /offers/a1/sent'] = { status: 200, body: { application: SENT, changed: true } };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    const match = new URL(apiCalls(env, 'GET', '/offers/match').at(-1)?.url ?? '');
    expect(match.searchParams.get('url')).toBe(OFFER_URL);
    expect(match.searchParams.get('company')).toBe('Empresa Ficticia S.L.');

    buttonNamed('Marcarla como enviada')?.click();
    await until(() => heading() === 'Marcada como enviada');
  });

  it('si no está en la cuenta, la crea ya como enviada con el puesto y la empresa que deje la persona', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['POST /offers'] = { status: 201, body: { application: { ...SENT, title: 'Backend sénior' } } };
    env.confirmation = { ...CONFIRMATION, title: '' };
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    expect(body()).toContain('aún no está en Aplica');
    const title = document.querySelector<HTMLInputElement>('#f-title');
    expect(title?.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#f-company')?.value).toBe('Empresa Ficticia S.L.');
    if (title) title.value = 'Backend sénior';

    buttonNamed('Marcarla como enviada')?.click();
    await until(() => heading() === 'Marcada como enviada');
    expect(apiCalls(env, 'POST', '/offers')[0]?.body).toMatchObject({
      url: OFFER_URL,
      title: 'Backend sénior',
      company: 'Empresa Ficticia S.L.',
      portal: 'lever',
      sent: true,
      force: false,
    });
  });

  it('si al crearla ya estaba (mismo enlace), marca esa en vez de duplicarla', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 500 };
    env.replies['POST /offers'] = { status: 409, body: { error: 'duplicate', match: 'url', application: APP } };
    env.replies['POST /offers/a1/sent'] = { status: 200, body: { application: SENT, changed: true } };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    buttonNamed('Marcarla como enviada')?.click();
    await until(() => heading() === 'Marcada como enviada');
    expect(apiCalls(env, 'POST', '/offers/a1/sent')).toHaveLength(1);
  });

  it('si ya va más allá de enviada, no hay aviso', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: { ...APP, stage: 'entrevista' } } };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => apiCalls(env, 'GET', '/offers/match').length === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heading()).toBe('Guardar oferta');
  });

  it('si el servidor dice que ya va más allá al marcar, lo explica sin cambiar nada', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: APP } };
    env.replies['POST /offers/a1/sent'] = { status: 409, body: { error: 'stage', application: { ...APP, stage: 'entrevista' } } };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    buttonNamed('Marcarla como enviada')?.click();
    await until(() => heading() === 'Ya está más adelante');
  });

  it('un error al marcar se avisa y se puede reintentar', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: APP } };
    env.replies['POST /offers/a1/sent'] = { status: 500 };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    buttonNamed('Marcarla como enviada')?.click();
    await until(() => document.querySelector('[role="alert"]'));
    expect(heading()).toBe('¿Has enviado la candidatura?');
    expect(buttonNamed('Marcarla como enviada')?.disabled).toBe(false);
  });

  it('"Ahora no" no cambia nada y no vuelve a preguntar en esa página', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: APP } };
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL);
    await until(() => heading() === '¿Has enviado la candidatura?');
    buttonNamed('Ahora no')?.click();
    await until(() => body().includes('no hemos cambiado nada'));
    loaded(env, THANKS_URL);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(body()).toContain('no hemos cambiado nada');
    expect(env.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('una página que no es la confirmación no enseña nada ni consulta la API', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    const before = env.calls.length;
    loaded(env, `${OFFER_URL}/apply`);
    await until(() => env.injected.includes('detect.js'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heading()).toBe('Guardar oferta');
    expect(env.calls.length).toBe(before);
  });

  it('fuera de los siete ATS ni siquiera inyecta el detector', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.injected = [];
    loaded(env, 'https://empresa-ficticia.example/gracias');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.injected).toEqual([]);
  });

  it('las pestañas de otra ventana no cuentan', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel(env);
    env.injected = [];
    env.confirmation = CONFIRMATION;
    loaded(env, THANKS_URL, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.injected).toEqual([]);
    expect(heading()).toBe('Guardar oferta');
  });

  it('al abrir el panel en la confirmación (Workday no cambia de página), el aviso va antes que leer la oferta', async () => {
    const env = setup({ tabUrl: THANKS_URL, confirmation: CONFIRMATION });
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: APP } };
    await openPanel(env, '¿Has enviado la candidatura?');
    expect(body()).toContain('Desarrolladora backend en Empresa Ficticia S.L.');
  });
});

describe('findSentCandidate: Workday no dice la oferta en su confirmación (CV-543)', () => {
  const SITE = 'https://empresaficticia.wd3.myworkdayjobs.com/en-US/empresaficticia';
  const TAB = `${SITE}/jobTasks/completed/application`;
  const WORKDAY = { ats: 'workday', offerUrl: SITE, title: '', company: '' };
  const OFFER: NonNullable<Remembered['offer']> = { ...EXTRACTED, workMode: 'hibrido', portal: 'workday', url: `${SITE}/job/Madrid/Desarrolladora-backend_R-1` };
  const deps = { detect: () => Promise.resolve(WORKDAY) };
  const matchOffer = vi.fn((): Promise<unknown> => Promise.resolve({ ok: true, data: null }));
  const client = { matchOffer } as unknown as ApiClient;

  beforeEach(() => {
    matchOffer.mockClear();
  });

  it('sin la oferta recordada en esa pestaña no propone nada ni consulta Aplica', async () => {
    expect(await findSentCandidate(7, TAB, undefined, 'tok', client, deps)).toBeNull();
    expect(matchOffer).not.toHaveBeenCalled();
  });

  it('con la oferta que el panel leyó en /apply (mismo sitio), la propone con sus datos, no con la dirección del sitio', async () => {
    const remembered = { pageUrl: `${OFFER.url}/apply/applyManually`, offer: OFFER, application: null };
    const found = await findSentCandidate(7, TAB, remembered, 'tok', client, deps);
    expect(matchOffer).toHaveBeenCalledWith('tok', { url: OFFER.url, title: OFFER.title, company: OFFER.company });
    expect(found).toMatchObject({ kind: 'new', offer: { url: OFFER.url, title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', sent: true } });
  });

  it('con la candidatura recordada propone esa, sin consultar', async () => {
    const remembered = { pageUrl: `${OFFER.url}/apply`, offer: OFFER, application: APP };
    expect(await findSentCandidate(7, TAB, remembered, 'tok', client, deps)).toEqual({ kind: 'existing', application: APP });
    expect(matchOffer).not.toHaveBeenCalled();
  });

  it('lo recordado de otro sitio no vale', async () => {
    const remembered = { pageUrl: 'https://otra.wd1.myworkdayjobs.com/en-US/otra/job/X', offer: OFFER, application: null };
    expect(await findSentCandidate(7, TAB, remembered, 'tok', client, deps)).toBeNull();
  });
});
