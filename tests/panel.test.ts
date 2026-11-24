// @vitest-environment happy-dom
// Panel de punta a punta con el navegador y la API simulados (CV-504): estados, foco,
// duplicados, errores e idioma de la cuenta.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.test';
const LINKEDIN = 'https://www.linkedin.com/jobs/view/1/';
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

type Reply = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> };
type Env = {
  storage: Record<string, unknown>;
  calls: { url: string; method: string; body: unknown; authorization?: string }[];
  created: string[];
  /** Una lista se va gastando en orden (la última se repite): para el 410 y el reintento. */
  replies: Record<string, Reply | Reply[]>;
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
      const headers = (init?.headers ?? {}) as Record<string, string>;
      env.calls.push({
        url: input,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        authorization: headers.Authorization,
      });
      const queued = env.replies[route] ?? { status: 404 };
      const reply: Reply = Array.isArray(queued) ? (queued.length > 1 ? (queued.shift() as Reply) : (queued[0] as Reply)) : queued;
      const content = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
      return Promise.resolve(new Response(content, { status: reply.status, headers: reply.headers }));
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
const buttonByText = (text: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
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
  it('sin permiso de la pestaña dice que hay que pulsar el icono, dónde está y por qué', async () => {
    setup({ extract: () => Promise.reject(new Error('Cannot access contents of the page')) });
    await openPanel();
    await until(() => heading() === 'Pulsa el icono de Aplica');
    expect(document.activeElement?.tagName).toBe('H1');
    expect(body()).toContain('Con el panel abierto también vale');
    expect(body()).toContain('Por qué: por tu privacidad');
    expect(document.querySelector('.toolbar-hint img')?.getAttribute('src')).toBe('icons/icon-32.png');
    // CV-544: sin acceso, releer no puede funcionar, así que no hay botón que no haga nada.
    expect(buttonByText('Leer la página de nuevo')).toBeUndefined();
  });

  it('sin permiso, al pulsar el icono con el panel abierto, lee la página sola', async () => {
    let allowed = false;
    const env = setup({
      extract: () => (allowed ? Promise.resolve(EXTRACTED) : Promise.reject(new Error('Cannot access contents of the page'))),
    });
    await openPanel();
    await until(() => heading() === 'Pulsa el icono de Aplica');
    allowed = true;
    for (const fn of env.messageListeners) fn({ type: 'aplica.icon-clicked' });
    await until(() => heading() === 'Guardar oferta');
  });

  it('"Leer la página de nuevo" sin acceso lo explica ahí mismo y no pierde lo editado', async () => {
    let reads = 0;
    const env = setup({
      // Fuera de un ATS, para contar solo las lecturas de la oferta (sin el detector de "enviada").
      tab: () => Promise.resolve([{ id: 1, url: LINKEDIN }]),
      extract: () => {
        reads++;
        return Promise.resolve(EXTRACTED);
      },
    });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    field('title').value = 'Editado';
    // Se ha cambiado de página: el navegador ya no da la URL de la pestaña.
    env.tab = () => Promise.resolve([{ id: 1 }]);
    buttonByText('Leer la página de nuevo')?.click();
    await until(() => document.querySelector('[role="alert"]')?.textContent.includes('la extensión ya no tiene acceso a esta página'));
    expect(field('title').value).toBe('Editado');
    expect(reads).toBe(1);
  });

  it('"Leer la página de nuevo" con acceso relee y dice que lo ha hecho', async () => {
    let reads = 0;
    setup({
      tab: () => Promise.resolve([{ id: 1, url: LINKEDIN }]),
      extract: () => {
        reads++;
        return Promise.resolve(EXTRACTED);
      },
    });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    buttonByText('Leer la página de nuevo')?.click();
    await until(() => body().includes('Página leída de nuevo.'));
    expect(reads).toBe(2);
    expect(heading()).toBe('Guardar oferta');
  });

  it('"Usar el texto seleccionado" sin acceso lleva a la pantalla de pulsar el icono', async () => {
    const env = setup({ extract: () => Promise.resolve({ ...EXTRACTED, description: '' }) });
    await openPanel();
    await until(() => heading() === 'Selecciona el texto de la oferta');
    env.tab = () => Promise.resolve([{ id: 1 }]);
    buttonByText('Usar el texto seleccionado')?.click();
    await until(() => heading() === 'Pulsa el icono de Aplica');
  });

  it('en una página que no es web no ofrece releer', async () => {
    setup({ tab: () => Promise.resolve([{ id: 1, url: 'chrome://newtab/' }]) });
    await openPanel();
    await until(() => heading() === 'Abre una oferta de empleo');
    expect(buttonByText('Leer la página de nuevo')).toBeUndefined();
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
    await until(() => body().includes('Selecciona su texto con el ratón y pulsa «Usar el texto seleccionado».'));
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

  it('la pantalla de conexión dice qué hace y qué no, y enlaza la página de la extensión', async () => {
    const env = setup({ storage: {} });
    vi.stubGlobal('chrome', { ...chrome, i18n: { getMessage: (key: string) => `nav:${key}`, getUILanguage: () => 'es-ES' } });
    await openPanel();
    await until(() => heading() === 'nav:connectTitle');
    for (const key of ['connectFeatureSave', 'connectFeatureFit', 'connectFeatureApply', 'connectPrivacyClick', 'connectPrivacyTabs', 'connectPrivacySubmit']) {
      expect(body()).toContain(`nav:${key}`);
    }
    expect(document.querySelector('.bar img')?.getAttribute('src')).toBe('assets/logo.svg');
    buttonByText('nav:helpButton')?.click();
    expect(env.created).toEqual([`${API}/es/extension`]);
  });

  it('el pie enlaza la ayuda en el idioma de la cuenta y la desconexión va en pequeño', async () => {
    const env = setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    expect(buttonByText('Desconectar')?.className).toBe('link');
    buttonByText('Cómo funciona la extensión')?.click();
    expect(env.created).toEqual([`${API}/es/extension`]);
  });

  it('fuera de un ATS, rellenar formulario va plegado; en un ATS, abierto', async () => {
    setup({ tab: () => Promise.resolve([{ id: 1, url: 'https://www.linkedin.com/jobs/view/1/' }]) });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    expect(document.querySelector('.fill-form')?.tagName).toBe('DETAILS');
    setup();
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    expect(document.querySelector('.fill-form')?.tagName).toBe('SECTION');
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

  it('"Exportar página" sin acceso a la pestaña dice qué hacer con el panel abierto (CV-544)', async () => {
    const env = setup();
    vi.stubGlobal('__DEV_BUILD__', true);
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    env.tab = () => Promise.resolve([{ id: 1 }]);
    buttonByText('Exportar página')?.click();
    await until(() => body().includes('con el panel abierto también vale'));
    expect(body()).not.toContain('para leer la oferta');
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

describe('panel: documentos de la candidatura preparada (CV-506, D-217)', () => {
  const ME = (scopes?: string[]) => ({
    status: 200,
    body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' }, ...(scopes ? { scopes } : {}) },
  });
  const READY = { ...APPLICATION, stage: 'ready', ready: true };
  const DOCS = {
    documents: {
      lang: 'es',
      cv: { docx: true, pdf: true },
      letter: 'Carta ficticia para la empresa.',
      message: 'Mensaje ficticio al reclutador.',
      questions: [
        {
          generated_at: '2026-11-22T10:00:00+01:00',
          truncated: false,
          items: [
            { question: '¿Por qué esta empresa?', type: 'redactar', answer: 'Porque encaja conmigo.', note: 'Revisa el tono.' },
            { question: 'Pretensión salarial', type: 'contesta_tu', answer: null, note: 'La cifra la eliges tú.' },
          ],
        },
      ],
      url: READY.url,
    },
  };
  const LINK = { status: 201, body: { url: `${API}/api/ext/v1/downloads/s3cret`, expires_at: '2026-11-23T10:05:00Z' } };
  const FILE = { status: 200, raw: 'contenido', headers: { 'Content-Disposition': `attachment; filename*=UTF-8''CV%20Ana.docx` } };
  const buttonNamed = (name: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name);
  const live = (): string => document.querySelector('#live')?.textContent ?? '';

  let clipboard: ReturnType<typeof vi.fn>;
  let downloaded: { name: string; href: string }[];
  let revoked: string[];
  beforeEach(() => {
    clipboard = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    downloaded = [];
    revoked = [];
    URL.createObjectURL = vi.fn(() => 'blob:aplica-test');
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openReady(replies: Record<string, Reply | Reply[]> = {}, scopes?: string[]): Promise<Env> {
    const env = setup({
      replies: {
        'GET /me': ME(scopes),
        'GET /offers/match': { status: 200, body: { match: 'url', application: READY } },
        'GET /offers/a1/documents': { status: 200, body: DOCS },
        'POST /offers/a1/downloads': LINK,
        'GET /downloads/s3cret': FILE,
        ...replies,
      },
    });
    await openPanel();
    await until(() => heading() === 'Ya tienes esta oferta en Aplica');
    return env;
  }

  it('con ready: true enseña los documentos en lugar del encaje exprés, sin pedir el encaje', async () => {
    const env = await openReady();
    await until(() => buttonNamed('Descargar CV en Word'));
    expect(buttonNamed('Descargar CV en PDF')).toBeDefined();
    expect(body()).toContain('Esta candidatura ya está preparada');
    expect(document.querySelector('section.documents')).not.toBeNull();
    expect(document.querySelector('section.quick-fit:not(.documents)')).toBeNull();
    expect(env.calls.some((c) => c.url.endsWith('/quick-fit'))).toBe(false);
    expect(env.calls.find((c) => c.url.endsWith('/documents'))?.authorization).toBe('Bearer tok');
  });

  it('copia la carta, el mensaje y cada respuesta; la que contestas tú no tiene botón', async () => {
    await openReady();
    await until(() => buttonNamed('Copiar la carta'));
    buttonNamed('Copiar la carta')?.click();
    await until(() => live() === 'Copiado');
    expect(clipboard).toHaveBeenLastCalledWith('Carta ficticia para la empresa.');
    buttonNamed('Copiar el mensaje')?.click();
    expect(clipboard).toHaveBeenLastCalledWith('Mensaje ficticio al reclutador.');
    const answers = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Copiar respuesta');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.getAttribute('aria-label')).toBe('Copiar la respuesta a: ¿Por qué esta empresa?');
    answers[0]?.click();
    expect(clipboard).toHaveBeenLastCalledWith('Porque encaja conmigo.');
    // La pregunta y su nota se ven aunque no haya nada que copiar.
    expect(body()).toContain('Pretensión salarial');
    expect(body()).toContain('La cifra la eliges tú.');
    expect(body()).toContain('Esta la contestas tú.');
  });

  it('si el portapapeles falla, lo dice', async () => {
    await openReady();
    clipboard.mockImplementation(() => Promise.reject(new Error('denegado')) as never);
    (await until(() => buttonNamed('Copiar la carta'))).click();
    await until(() => live().startsWith('No se ha podido copiar'));
  });

  it('descarga el Word: pide el enlace, baja el fichero sin Authorization y lo guarda con su nombre', async () => {
    const env = await openReady();
    (await until(() => buttonNamed('Descargar CV en Word'))).click();
    await until(() => downloaded.length === 1);
    expect(downloaded[0]).toEqual({ name: 'CV Ana.docx', href: 'blob:aplica-test' });
    const request = env.calls.find((c) => c.url.endsWith('/downloads'));
    expect(request?.body).toEqual({ format: 'docx' });
    expect(request?.authorization).toBe('Bearer tok');
    expect(env.calls.find((c) => c.url.endsWith('/downloads/s3cret'))?.authorization).toBeUndefined();
    await until(() => buttonNamed('Descargar CV en Word')?.disabled === false);
  });

  it('un 410 pide un enlace nuevo una sola vez y reintenta', async () => {
    const env = await openReady({ 'GET /downloads/s3cret': [{ status: 410, body: { error: 'gone' } }, FILE] });
    (await until(() => buttonNamed('Descargar CV en PDF'))).click();
    await until(() => downloaded.length === 1);
    expect(env.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/downloads'))).toHaveLength(2);
  });

  it('si el 410 se repite, avisa del error y no pide más enlaces', async () => {
    const env = await openReady({ 'GET /downloads/s3cret': { status: 410, body: { error: 'gone' } } });
    (await until(() => buttonNamed('Descargar CV en Word'))).click();
    await until(() => document.querySelector('.doc-notices [role="alert"]'));
    expect(body()).toContain('No se ha podido descargar el fichero');
    expect(downloaded).toHaveLength(0);
    expect(env.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/downloads'))).toHaveLength(2);
  });

  it('sin PDF, no hay botón de PDF; un formato que falta (404) se explica', async () => {
    const docs = { documents: { ...DOCS.documents, cv: { docx: true, pdf: false } } };
    await openReady({ 'GET /offers/a1/documents': { status: 200, body: docs }, 'POST /offers/a1/downloads': { status: 404, body: { error: 'not_found' } } });
    await until(() => buttonNamed('Descargar CV en Word'));
    expect(buttonNamed('Descargar CV en PDF')).toBeUndefined();
    buttonNamed('Descargar CV en Word')?.click();
    await until(() => body().includes('Ese formato no está disponible'));
  });

  it('si la candidatura ya no está lista (409), lo dice y no ofrece descargas', async () => {
    await openReady({ 'GET /offers/a1/documents': { status: 409, body: { error: 'not_ready' } } });
    await until(() => body().includes('aún no tiene los documentos preparados'));
    expect(buttonNamed('Descargar CV en Word')).toBeUndefined();
  });

  it('403 insufficient_scope: explica que hay que volver a conectar, con el botón, y no borra el token', async () => {
    const env = await openReady({ 'GET /offers/a1/documents': { status: 403, body: { error: 'insufficient_scope' } } });
    await until(() => buttonNamed('Volver a conectar'));
    expect(body()).toContain('Vuelve a conectar este navegador');
    expect(env.storage['aplica.token']).toBe('tok');
    expect(buttonNamed('Descargar CV en Word')).toBeUndefined();
  });

  it('si /me no trae documents.read, ni se piden los documentos', async () => {
    const env = await openReady({}, ['tracker.read', 'profile.read']);
    await until(() => buttonNamed('Volver a conectar'));
    expect(env.calls.some((c) => c.url.endsWith('/documents'))).toBe(false);
    expect(env.storage['aplica.token']).toBe('tok');
  });

  it('si /me trae documents.read, se piden', async () => {
    await openReady({}, ['tracker.read', 'documents.read']);
    await until(() => buttonNamed('Descargar CV en Word'));
  });

  it('401 al pedir los documentos: sesión caducada como en el resto del panel', async () => {
    const env = setup({
      replies: {
        'GET /me': ME(),
        'GET /offers/match': { status: 200, body: { match: 'url', application: READY } },
        'GET /offers/a1/documents': { status: 401, body: { error: 'unauthenticated' } },
      },
    });
    await openPanel();
    // Sin sesión, el panel vuelve a Conectar (el idioma de la cuenta ya se ha olvidado).
    await until(() => buttonNamed('nav:connectButton'));
    expect(env.storage['aplica.token']).toBeUndefined();
  });

  it('con ready: false, el panel sigue como hoy: encaje exprés y sin documentos', async () => {
    const env = await openReady({ 'GET /offers/match': { status: 200, body: { match: 'url', application: APPLICATION } } });
    await until(() => document.querySelector('section.quick-fit'));
    expect(document.querySelector('section.documents')).toBeNull();
    expect(env.calls.some((c) => c.url.endsWith('/documents'))).toBe(false);
  });

  it('coincidencia de empresa y puesto con ready: true: los documentos se ven desde la vista previa sin perder lo editado', async () => {
    setup({
      replies: {
        'GET /me': ME(),
        'GET /offers/match': { status: 200, body: { match: 'role_company', application: READY } },
        'GET /offers/a1/documents': { status: 200, body: DOCS },
      },
    });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    field('title').value = 'Título editado';
    (await until(() => buttonNamed('Ver los documentos preparados'))).click();
    await until(() => buttonNamed('Descargar CV en Word'));
    expect(heading()).toBe('Guardar oferta');
    expect(field('title').value).toBe('Título editado');
  });

  it('un 409 al guardar con ready: true lleva a los documentos', async () => {
    setup({
      replies: {
        'GET /me': ME(),
        'GET /offers/match': { status: 200, body: { match: null } },
        'POST /offers': { status: 409, body: { error: 'duplicate', match: 'url', application: READY } },
        'GET /offers/a1/documents': { status: 200, body: DOCS },
      },
    });
    await openPanel();
    await until(() => heading() === 'Guardar oferta');
    submit().click();
    await until(() => buttonNamed('Descargar CV en Word'));
    expect(heading()).toBe('Ya tienes esta oferta en Aplica');
  });
});
