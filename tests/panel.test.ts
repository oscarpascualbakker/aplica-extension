// @vitest-environment happy-dom
// Panel de punta a punta con el navegador y la API simulados (CV-504): estados, foco,
// duplicados, errores e idioma de la cuenta.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.test';
const APPLICATION = { id: 'a1', title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', stage: 'saved', url: `${API}/app/candidaturas/a1` };
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

type Reply = { status: number; body?: unknown };
type Env = {
  storage: Record<string, unknown>;
  calls: { url: string; method: string; body: unknown }[];
  created: string[];
  replies: Record<string, Reply>;
  extract: () => Promise<unknown>;
  tab: () => Promise<{ id?: number; url?: string }[]>;
  messageListeners: ((message: unknown) => void)[];
  offline: boolean;
};

function setup(overrides: Partial<Env> = {}): Env {
  const env: Env = {
    storage: { 'aplica.token': 'tok' },
    calls: [],
    created: [],
    replies: {
      'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
      'GET /offers/match': { status: 200, body: { match: null } },
      'POST /offers': { status: 201, body: { application: APPLICATION } },
    },
    extract: () => Promise.resolve(EXTRACTED),
    tab: () => Promise.resolve([{ id: 1, url: 'https://jobs.lever.co/empresaficticia/1' }]),
    messageListeners: [],
    offline: false,
    ...overrides,
  };
  vi.stubGlobal('__API_BASE__', API);
  vi.stubGlobal('__DEV_BUILD__', false);
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => `nav:${key}` },
    runtime: {
      getURL: (path: string) => `chrome-extension://abc/${path}`,
      onMessage: { addListener: (fn: (message: unknown) => void) => env.messageListeners.push(fn) },
    },
    identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow: () => Promise.resolve(undefined) },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in env.storage ? { [key]: env.storage[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(env.storage, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          Reflect.deleteProperty(env.storage, key);
          return Promise.resolve();
        },
      },
    },
    tabs: {
      query: () => env.tab(),
      create: ({ url }: { url: string }) => {
        env.created.push(url);
        return Promise.resolve();
      },
    },
    scripting: { executeScript: () => env.extract().then((result) => [{ result }]) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.startsWith('chrome-extension://')) {
        const lang = /_locales\/(\w+)\//.exec(input)?.[1] ?? 'es';
        return Promise.resolve(new Response(readFileSync(`src/_locales/${lang}/messages.json`, 'utf8')));
      }
      if (env.offline) return Promise.reject(new TypeError('Failed to fetch'));
      const url = new URL(input);
      const route = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/ext/v1', '')}`;
      env.calls.push({ url: input, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const reply = env.replies[route] ?? { status: 404 };
      return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }));
    }),
  );
  document.body.innerHTML = '<main id="app"></main><div id="live" role="status" aria-live="polite"></div>';
  return env;
}

async function openPanel(): Promise<void> {
  vi.resetModules();
  await import('../src/panel/panel');
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`No ha llegado a mostrarse: ${document.body.textContent}`);
}

const heading = (): string | undefined => document.querySelector('h1')?.textContent;
const field = (name: string): HTMLInputElement => document.querySelector(`#f-${name}`) as HTMLInputElement;
const submit = (): HTMLButtonElement => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const body = (): string => document.body.textContent;
/** El cuerpo del último POST /offers. */
const postedOffer = (env: Env): Record<string, unknown> =>
  env.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/offers')).at(-1)?.body as Record<string, unknown>;

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('panel: guardar una oferta', () => {
  it('lee la página, enseña la vista previa editable y guarda como candidatura', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');

    expect(field('title').value).toBe('Desarrolladora backend');
    expect(field('company').value).toBe('Empresa Ficticia S.L.');
    expect((document.querySelector('#f-work_mode') as HTMLSelectElement).value).toBe('hibrido');
    expect(field('url').readOnly).toBe(true);
    expect(field('url').value).toBe('https://jobs.lever.co/empresaficticia/1');
    // Etiquetas asociadas a cada campo y contador de la descripción.
    for (const name of ['title', 'company', 'location', 'work_mode', 'salary', 'description', 'url']) {
      expect(document.querySelector(`label[for="f-${name}"]`), name).not.toBeNull();
    }
    expect(body()).toContain('18 de 30000 caracteres');
    // El foco está en el título del estado.
    expect(document.activeElement?.tagName).toBe('H1');

    // La consulta de duplicado lleva url, título y empresa.
    const match = await until(() => env.calls.find((c) => c.url.includes('/offers/match')));
    const params = new URL(match.url).searchParams;
    expect(params.get('url')).toBe('https://jobs.lever.co/empresaficticia/1');
    expect(params.get('title')).toBe('Desarrolladora backend');

    field('title').value = 'Desarrolladora backend senior';
    submit().click();
    await until(() => heading() === 'Oferta guardada');
    expect(postedOffer(env)).toEqual({
      url: 'https://jobs.lever.co/empresaficticia/1',
      title: 'Desarrolladora backend senior',
      company: 'Empresa Ficticia S.L.',
      location: 'Villanueva del Ejemplo',
      work_mode: 'hibrido',
      salary: '',
      description: 'Texto de la oferta',
      portal: 'lever',
      force: false,
    });
    expect(document.activeElement?.tagName).toBe('H1');

    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Abrir en Aplica') as HTMLButtonElement).click();
    expect(env.created).toEqual([APPLICATION.url]);
  });

  it('la oferta ya guardada con la misma URL: aviso, abrir en Aplica y sin botón de guardar', async () => {
    const env = setup({
      replies: {
        'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
        'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } },
      },
    });
    await openPanel();
    await until(() => heading() === 'Ya tienes esta oferta en Aplica');
    expect(document.querySelector('button[type="submit"]')).toBeNull();
    expect(body()).toContain('Desarrolladora backend en Empresa Ficticia S.L.');
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Abrir en Aplica') as HTMLButtonElement).click();
    expect(env.created).toEqual([APPLICATION.url]);
  });

  it('empresa y puesto parecidos: aviso y "Guardar igualmente" reenvía con force', async () => {
    const env = setup({
      replies: {
        'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
        'GET /offers/match': { status: 200, body: { match: 'role_company', application: APPLICATION } },
        'POST /offers': { status: 201, body: { application: APPLICATION } },
      },
    });
    await openPanel();
    await until(() => body().includes('Ya tienes una candidatura parecida'));
    expect(submit().textContent).toBe('Guardar igualmente');
    submit().click();
    await until(() => heading() === 'Oferta guardada');
    expect(postedOffer(env).force).toBe(true);
  });

  it('409 possible_duplicate al guardar: se conserva lo editado y se pide confirmación', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.replies['POST /offers'] = { status: 409, body: { error: 'possible_duplicate', match: 'role_company', application: APPLICATION } };
    field('salary').value = '40.000 EUR';
    submit().click();
    await until(() => submit().textContent === 'Guardar igualmente');
    expect(field('salary').value).toBe('40.000 EUR');
    env.replies['POST /offers'] = { status: 201, body: { application: APPLICATION } };
    submit().click();
    await until(() => heading() === 'Oferta guardada');
    expect(postedOffer(env).force).toBe(true);
  });

  it('409 duplicate al guardar: pasa al estado de duplicado', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.replies['POST /offers'] = { status: 409, body: { error: 'duplicate', match: 'url', application: APPLICATION } };
    submit().click();
    await until(() => heading() === 'Ya tienes esta oferta en Aplica');
  });

  it('422: marca los campos, avisa y lleva el foco al primero', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.replies['POST /offers'] = { status: 422, body: { error: 'invalid', fields: ['company', 'title'] } };
    submit().click();
    await until(() => field('title').getAttribute('aria-invalid') === 'true');
    expect(field('company').getAttribute('aria-invalid')).toBe('true');
    expect(field('salary').hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(field('title'));
    expect(field('title').getAttribute('aria-describedby')).toBe('e-title');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Revisa los campos marcados.');
  });

  it.each([
    [403, { error: 'insufficient_scope' }, 'Esta conexión no permite guardar ofertas'],
    [429, {}, 'Demasiados intentos'],
    [500, {}, 'Aplica no responde como se esperaba'],
  ])('error %i al guardar: mensaje claro y la vista previa sigue editable', async (status, replyBody, text) => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.replies['POST /offers'] = { status, body: replyBody };
    submit().click();
    await until(() => document.querySelector('[role="alert"]')?.textContent.includes(text));
    expect(field('title').disabled).toBe(false);
    expect(submit().disabled).toBe(false);
  });

  it('401 al guardar: se borra el token y el idioma y vuelve a Conectar', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.replies['POST /offers'] = { status: 401, body: { error: 'unauthenticated' } };
    submit().click();
    await until(() => body().includes('nav:connectButton'));
    expect(env.storage['aplica.token']).toBeUndefined();
    expect(env.storage['aplica.locale']).toBeUndefined();
  });

  it('sin red al guardar: mensaje de red', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.offline = true;
    submit().click();
    await until(() => document.querySelector('[role="alert"]')?.textContent.includes('No se ha podido contactar con Aplica'));
  });
});

describe('panel: lectura de la página', () => {
  it('sin permiso de la pestaña dice que hay que pulsar el icono', async () => {
    setup({ extract: () => Promise.reject(new Error('Cannot access contents of the page')) });
    await openPanel();
    await until(() => body().includes('Pulsa el icono de Aplica en esta página para leer la oferta'));
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('sin descripción pide seleccionar el texto y el botón vuelve a leer', async () => {
    let reads = 0;
    setup({
      extract: () => {
        reads++;
        return Promise.resolve({ ...EXTRACTED, description: reads === 1 ? '' : 'Texto seleccionado', descriptionFromSelection: reads > 1 });
      },
    });
    await openPanel();
    await until(() => body().includes('Selecciona el texto de la oferta en la página y pulsa «Usar el texto seleccionado».'));
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Usar el texto seleccionado') as HTMLButtonElement).click();
    await until(() => heading() === 'Guardar oferta');
    expect((document.querySelector('#f-description') as HTMLTextAreaElement).value).toBe('Texto seleccionado');
    expect(body()).toContain('La descripción es el texto que tenías seleccionado en la página.');
  });

  it('avisa si la descripción se ha recortado', async () => {
    setup({ extract: () => Promise.resolve({ ...EXTRACTED, descriptionTruncated: true }) });
    await openPanel();
    await until(() => body().includes('se ha recortado a 30000 caracteres'));
  });

  it('al pulsar de nuevo el icono con otra oferta en la pestaña, relee', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.tab = () => Promise.resolve([{ id: 1, url: 'https://jobs.lever.co/empresaficticia/2' }]);
    for (const fn of env.messageListeners) fn({ type: 'aplica.icon-clicked' });
    await until(() => field('url').value === 'https://jobs.lever.co/empresaficticia/2');
  });

  it('al pulsar el icono en la misma oferta, no se pierde lo editado', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    field('title').value = 'Editado';
    for (const fn of env.messageListeners) fn({ type: 'aplica.icon-clicked' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(field('title').value).toBe('Editado');
  });
});

describe('panel: idioma de la cuenta y conexión', () => {
  it('con sesión, los textos siguen el locale de /me y solo ese valor se guarda', async () => {
    const env = setup({
      replies: {
        'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'en', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
        'GET /offers/match': { status: 200, body: { match: null } },
      },
    });
    await openPanel();
    await until(() => body().includes('Connected as ana@example.com'));
    expect(env.storage['aplica.locale']).toBe('en');
    expect(Object.keys(env.storage).sort()).toEqual(['aplica.locale', 'aplica.token']);
  });

  it('sin conectar, el idioma es el del navegador', async () => {
    setup({ storage: {} });
    await openPanel();
    await until(() => body().includes('nav:connectButton'));
  });

  it('al desconectar se olvida el idioma de la cuenta', async () => {
    const env = setup();
    env.replies['DELETE /token'] = { status: 204 };
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Desconectar') as HTMLButtonElement).click();
    await until(() => body().includes('nav:connectButton'));
    expect(env.storage['aplica.locale']).toBeUndefined();
    expect(env.storage['aplica.token']).toBeUndefined();
  });

  it('el botón de exportar página no existe en el panel de producción', async () => {
    setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    expect(document.querySelector('.dev-tools')).toBeNull();
  });

  it('el build de desarrollo muestra "Exportar página" con el aviso de datos personales', async () => {
    setup();
    vi.stubGlobal('__DEV_BUILD__', true);
    await openPanel();
    await until(() => document.querySelector('.dev-tools'));
    expect(body()).toContain('Exportar página');
    expect(body()).toContain('lleva datos personales');
    expect(body()).toContain('no lo compartas fuera del proyecto');
  });
});

describe('panel: cerrar (CV-523)', () => {
  const closeButton = (): HTMLButtonElement | null => document.querySelector('button.close');

  it('el botón de cerrar está en todos los estados, con nombre accesible y en el idioma del panel', async () => {
    setup({ replies: { 'GET /me': { status: 401 } } });
    await openPanel();
    await until(() => body().includes('nav:connectButton'));
    expect(closeButton()?.getAttribute('aria-label')).toBe('nav:closeButton');

    setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    expect(closeButton()?.getAttribute('aria-label')).toBe('Cerrar el panel');
    expect(closeButton()?.title).toBe('Cerrar el panel');
    // Va el último: el foco sigue empezando por el título.
    expect(document.querySelector('#app')?.lastElementChild).toBe(closeButton());
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });

  it('en Chrome y Edge cierra el panel de la ventana actual', async () => {
    setup();
    const close = vi.fn(() => Promise.resolve());
    const scope = globalThis as unknown as { chrome: Record<string, unknown> };
    scope.chrome.sidePanel = { close };
    scope.chrome.windows = { getCurrent: () => Promise.resolve({ id: 3 }) };
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    closeButton()?.click();
    await until(() => close.mock.calls.length > 0);
    expect(close).toHaveBeenCalledWith({ windowId: 3 });
  });
});

describe('panel: encaje exprés (CV-505)', () => {
  const ME = { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } };
  const FIT = {
    verdict: 'apply_with_caveats',
    verdict_reason: 'Encaja en lo técnico; falta confirmar el inglés.',
    requirements: [
      { requirement: 'PHP y Laravel', status: 'covered', evidence_ids: ['EV-01'], note: '' },
      { requirement: 'Inglés alto', status: 'to_confirm', evidence_ids: [], note: 'No aparece en tu perfil.' },
      { requirement: 'Kubernetes', status: 'missing', evidence_ids: [], note: '' },
    ],
    created_at: '2026-11-22T10:00:00+01:00',
    url: `${API}/app/candidaturas/a1#encaje-expres`,
  };
  const buttonNamed = (name: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name);
  const section = (): HTMLElement | null => document.querySelector('section.quick-fit');

  it('con la funcionalidad apagada (404) no sale el bloque', async () => {
    setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    submit().click();
    await until(() => heading() === 'Oferta guardada');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(section()?.hidden).toBe(true);
  });

  it('guardada: "Ver encaje" no se lanza solo; al pulsarlo enseña requisitos, veredicto y "Preparar candidatura completa"', async () => {
    const env = setup({
      replies: {
        'GET /me': ME,
        'GET /offers/match': { status: 200, body: { match: null } },
        'POST /offers': { status: 201, body: { application: APPLICATION } },
        'GET /offers/a1/quick-fit': { status: 200, body: { quick_fit: null, free_left: 3, price: 1 } },
        'POST /offers/a1/quick-fit': { status: 200, body: { quick_fit: FIT, free_left: 2 } },
      },
    });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    submit().click();
    await until(() => heading() === 'Oferta guardada');
    const run = await until(() => buttonNamed('Ver encaje'));
    expect(body()).toContain('Lecturas gratis que te quedan hoy: 3.');
    expect(body()).toContain('El informe completo, al preparar la candidatura, es el que manda');
    // Guardar no gasta lectura: solo el botón la lanza.
    expect(env.calls.some((c) => c.method === 'POST' && c.url.endsWith('/quick-fit'))).toBe(false);

    run.click();
    await until(() => body().includes('Veredicto provisional: Aplicar con reservas'));
    const items = Array.from(document.querySelectorAll('.requirements li')).map((li) => li.textContent);
    expect(items).toEqual(['Cubierto: PHP y Laravel', 'Por confirmar: Inglés altoNo aparece en tu perfil.', 'Falta: Kubernetes']);
    expect(body()).toContain('Lecturas gratis que te quedan hoy: 2.');
    expect(document.activeElement?.id).toBe('quick-fit-title');

    buttonNamed('Preparar candidatura completa')?.click();
    expect(env.created).toEqual([`${APPLICATION.url}#preparar`]);
  });

  it('duplicado con una lectura anterior: la enseña sin volver a leer', async () => {
    const env = setup({
      replies: {
        'GET /me': ME,
        'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } },
        'GET /offers/a1/quick-fit': { status: 200, body: { quick_fit: { ...FIT, verdict: 'do_not_apply' }, free_left: 0, price: 1 } },
      },
    });
    await openPanel();
    await until(() => body().includes('Veredicto provisional: No aplicar'));
    expect(buttonNamed('Ver encaje')).toBeUndefined();
    expect(env.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('sin lecturas gratis: lo dice y lleva a la web a confirmar, sin gastar créditos desde el panel', async () => {
    const env = setup({
      replies: {
        'GET /me': ME,
        'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } },
        'GET /offers/a1/quick-fit': { status: 200, body: { quick_fit: null, free_left: 0, price: 1 } },
      },
    });
    await openPanel();
    await until(() => body().includes('Ya has usado las lecturas gratis de hoy'));
    expect(buttonNamed('Ver encaje')).toBeUndefined();
    buttonNamed('Ver encaje en Aplica')?.click();
    expect(env.created).toEqual([`${APPLICATION.url}#encaje-expres`]);
  });

  it('la cuarta del día (402) y la negativa del modelo: aviso claro y sin lectura gastada', async () => {
    const env = setup({
      replies: {
        'GET /me': ME,
        'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } },
        'GET /offers/a1/quick-fit': { status: 200, body: { quick_fit: null, free_left: 1, price: 1 } },
        'POST /offers/a1/quick-fit': { status: 502, body: { error: 'failed', code: 'refused' } },
      },
    });
    await openPanel();
    (await until(() => buttonNamed('Ver encaje'))).click();
    await until(() => body().includes('No se ha podido hacer esta lectura con esta oferta. No has gastado ninguna lectura.'));
    expect(document.querySelector('.quick-fit [role="alert"]')).not.toBeNull();
    // Se puede reintentar desde el mismo botón.
    env.replies['POST /offers/a1/quick-fit'] = { status: 402, body: { error: 'credits_required', price: 1, url: `${API}/app/candidaturas/a1#encaje-expres` } };
    (await until(() => buttonNamed('Ver encaje'))).click();
    await until(() => body().includes('Ya has usado las lecturas gratis de hoy'));
    buttonNamed('Ver encaje en Aplica')?.click();
    expect(env.created).toEqual([`${API}/app/candidaturas/a1#encaje-expres`]);
  });

  it('con el informe completo ya hecho, remite a él', async () => {
    setup({
      replies: {
        'GET /me': ME,
        'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } },
        'GET /offers/a1/quick-fit': { status: 200, body: { quick_fit: null, free_left: 3, price: 1 } },
        'POST /offers/a1/quick-fit': { status: 409, body: { error: 'report_exists', url: APPLICATION.url } },
      },
    });
    await openPanel();
    (await until(() => buttonNamed('Ver encaje'))).click();
    await until(() => body().includes('Esta candidatura ya tiene el informe completo'));
  });
});
