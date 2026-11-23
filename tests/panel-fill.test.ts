// @vitest-environment happy-dom
// Panel: rellenar formularios (CV-507). Fase A (copiar los datos del perfil) y fase B (autorrelleno en
// los ATS), con el navegador y la API simulados. Los datos del perfil no se guardan en el navegador.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.test';
const READY = { id: 'a1', title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.', stage: 'ready', url: `${API}/app/candidaturas/a1`, ready: true };
const NOT_READY = { ...READY, stage: 'saved', ready: false };
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
const PROFILE = {
  profile: {
    lang: 'es',
    name: 'Ana Ejemplo Prueba',
    email: 'ana@example.com',
    phone: '+34 600 000 000',
    location: 'Villanueva del Ejemplo, Provincia Ficticia',
    linkedin: 'https://www.linkedin.com/in/ana-ejemplo',
    github: null,
    websites: ['https://ana-ejemplo.example'],
    current_role: { title: 'Desarrolladora backend', company: 'Empresa Ficticia S.L.' },
    years_experience: 6,
    education: ['Grado en Informática'],
    languages: ['Español'],
  },
};
const DOCS = {
  documents: {
    lang: 'es',
    cv: { docx: true, pdf: true },
    letter: 'Carta ficticia.',
    message: null,
    questions: [
      {
        generated_at: '2026-11-22T10:00:00+01:00',
        truncated: false,
        items: [
          { question: 'Why do you want to work at Empresa Ficticia S.L.?', type: 'redactar', answer: 'Porque me gusta la plataforma.', note: null },
          { question: 'Expected salary', type: 'contesta_tu', answer: null, note: 'La cifra la eliges tú.' },
        ],
      },
    ],
    url: READY.url,
  },
};
const LINK = { status: 201, body: { url: `${API}/api/ext/v1/downloads/s3cret`, expires_at: '2026-11-23T10:05:00Z' } };
const FILE = { status: 200, raw: 'contenido', headers: { 'Content-Disposition': `attachment; filename*=UTF-8''CV%20Ana.docx` } };
const SUMMARY = { filled: ['firstName', 'lastName', 'email'], questionsFilled: 1, hadValue: 0, askYou: 2, questionsUnanswered: 0, attachment: 'attached' };

type Reply = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> };
type PageCall = { files?: string[]; method?: string; argument?: unknown };
type Env = {
  storage: Record<string, unknown>;
  storageWrites: { key: string; value: unknown }[];
  calls: { url: string; method: string }[];
  created: string[];
  replies: Record<string, Reply>;
  tabUrl: string;
  /** Respuesta de permissions.request. */
  grant: boolean;
  permissionRequests: string[][];
  pageCalls: PageCall[];
  scan: { hasFileInput: boolean; accept: string };
  fillResult: unknown;
  clipboard: ReturnType<typeof vi.fn>;
};

function setup(overrides: Partial<Env> = {}): Env {
  const env: Env = {
    storage: { 'aplica.token': 'tok' },
    storageWrites: [],
    calls: [],
    created: [],
    replies: {
      'GET /me': { status: 200, body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' } } },
      'GET /offers/match': { status: 200, body: { match: null } },
      'GET /profile': { status: 200, body: PROFILE },
    },
    tabUrl: 'https://jobs.lever.co/empresaficticia/1/apply',
    grant: true,
    permissionRequests: [],
    pageCalls: [],
    scan: { hasFileInput: true, accept: '.pdf,.docx' },
    fillResult: SUMMARY,
    clipboard: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  vi.stubGlobal('__API_BASE__', API);
  vi.stubGlobal('__DEV_BUILD__', false);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: env.clipboard }, configurable: true });
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => `nav:${key}` },
    runtime: {
      getURL: (path: string) => `chrome-extension://abc/${path}`,
      onMessage: { addListener: () => undefined },
    },
    identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow: () => Promise.resolve(undefined) },
    // Solo storage.local: si algo usara sync o session, fallaría.
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in env.storage ? { [key]: env.storage[key] } : {}),
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) env.storageWrites.push({ key, value });
          Object.assign(env.storage, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          Reflect.deleteProperty(env.storage, key);
          return Promise.resolve();
        },
      },
    },
    permissions: {
      request: ({ origins }: { origins: string[] }) => {
        env.permissionRequests.push(origins);
        return Promise.resolve(env.grant);
      },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: env.tabUrl }]),
      create: ({ url }: { url: string }) => {
        env.created.push(url);
        return Promise.resolve();
      },
    },
    scripting: {
      executeScript: ({ files, args }: { files?: string[]; args?: [string, unknown] }) => {
        if (files?.[0] === 'extract.js') return Promise.resolve([{ result: EXTRACTED }]);
        if (files) {
          env.pageCalls.push({ files });
          return Promise.resolve([{ result: undefined }]);
        }
        const [method, argument] = args as [string, unknown];
        env.pageCalls.push({ method, argument });
        return Promise.resolve([{ result: method === 'scan' ? env.scan : env.fillResult }]);
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
      const route = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/ext/v1', '')}`;
      env.calls.push({ url: input, method: init?.method ?? 'GET' });
      const reply = env.replies[route] ?? { status: 404 };
      const content = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
      return Promise.resolve(new Response(content, { status: reply.status, headers: reply.headers }));
    }),
  );
  document.body.innerHTML = '<main id="app"></main><div id="live" role="status" aria-live="polite"></div>';
  return env;
}

async function openPanel(heading = 'Guardar oferta'): Promise<void> {
  vi.resetModules();
  await import('../src/panel/panel');
  await until(() => document.querySelector('h1')?.textContent === heading);
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`No ha llegado a mostrarse: ${document.body.textContent}`);
}

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name);
const body = (): string => document.body.textContent;
const fillCalls = (env: Env): PageCall[] => env.pageCalls.filter((c) => c.method === 'fill');
const calledProfile = (env: Env): boolean => env.calls.some((c) => c.url.endsWith('/profile'));

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('panel: copiar los datos del perfil (fase A)', () => {
  it('lista los datos con un botón de copiar en cada uno, solo al pedirlo', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    await openPanel();
    // No se pide el perfil hasta que la persona lo pide.
    expect(calledProfile(env)).toBe(false);
    expect(buttonNamed('Rellenar este formulario')).toBeUndefined();
    expect(body()).toContain('Aquí no se rellena solo: copia los datos de la lista.');

    buttonNamed('Ver mis datos')?.click();
    await until(() => document.querySelector('.fill-form .requirements'));
    const rows = Array.from(document.querySelectorAll('.fill-form .requirements li')).map((li) => li.querySelector('strong')?.textContent);
    expect(rows).toEqual(['Nombre', 'Correo electrónico', 'Teléfono', 'Ciudad', 'LinkedIn', 'Web', 'Puesto actual', 'Años de experiencia', 'Formación']);
    expect(body()).toContain('Desarrolladora backend en Empresa Ficticia S.L.');

    const copyPhone = document.querySelector<HTMLButtonElement>('button[aria-label="Copiar Teléfono"]');
    copyPhone?.click();
    await until(() => env.clipboard.mock.calls.length > 0);
    expect(env.clipboard).toHaveBeenCalledWith('+34 600 000 000');
    await until(() => document.querySelector('#live')?.textContent === 'Copiado');
    // Y copiar no pide permisos ni toca la página.
    expect(env.permissionRequests).toEqual([]);
    expect(env.pageCalls).toEqual([]);
  });

  it('409 no_profile explica que hace falta un perfil y lleva a Aplica', async () => {
    const env = setup({ tabUrl: 'https://empresa-ficticia.example/empleo/1' });
    env.replies['GET /profile'] = { status: 409, body: { error: 'no_profile' } };
    await openPanel();
    buttonNamed('Ver mis datos')?.click();
    await until(() => body().includes('Para rellenar formularios necesitas un perfil en Aplica.'));
    buttonNamed('Abrir en Aplica')?.click();
    expect(env.created).toEqual([`${API}/app`]);
  });

  it('403 insufficient_scope pide conectar de nuevo, sin borrar el token', async () => {
    const env = setup();
    env.replies['GET /profile'] = { status: 403, body: { error: 'insufficient_scope' } };
    await openPanel();
    buttonNamed('Ver mis datos')?.click();
    await until(() => body().includes('Esta conexión no permite leer tu perfil'));
    expect(buttonNamed('Volver a conectar')).toBeDefined();
    expect(env.storage['aplica.token']).toBe('tok');
  });

  it('si /me dice que el token no tiene profile.read, ni se pide el perfil', async () => {
    const env = setup();
    env.replies['GET /me'] = {
      status: 200,
      body: { email: 'ana@example.com', locale: 'es', browser: { id: 'b', label: 'Chrome', connected_at: 'x' }, scopes: ['tracker.read'] },
    };
    await openPanel();
    buttonNamed('Ver mis datos')?.click();
    await until(() => body().includes('Esta conexión no permite leer tu perfil'));
    expect(calledProfile(env)).toBe(false);
  });

  it('401 vuelve a "Conectar"', async () => {
    const env = setup();
    env.replies['GET /profile'] = { status: 401, body: {} };
    await openPanel();
    buttonNamed('Ver mis datos')?.click();
    await until(() => body().includes('nav:connectButton'));
    expect(env.storage['aplica.token']).toBeUndefined();
  });
});

describe('panel: autorrelleno en un ATS (fase B)', () => {
  const withReadyApplication = (env: Env): void => {
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: READY } };
    env.replies['GET /offers/a1/documents'] = { status: 200, body: DOCS };
    env.replies['POST /offers/a1/downloads'] = LINK;
    env.replies['GET /downloads/s3cret'] = FILE;
  };

  it('pide el permiso del ATS al pulsar, rellena con perfil, respuestas y CV, y recuerda que el envío es de la persona', async () => {
    const env = setup();
    withReadyApplication(env);
    await openPanel('Ya tienes esta oferta en Aplica');
    // Nada se pide ni se inyecta antes del clic.
    expect(env.permissionRequests).toEqual([]);
    expect(env.pageCalls).toEqual([]);
    expect(body()).toContain('El navegador te pedirá permiso para este sitio la primera vez.');

    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Datos de contacto rellenados: 3.'));
    expect(env.permissionRequests).toEqual([['*://jobs.lever.co/*', '*://jobs.eu.lever.co/*']]);

    // Se inyecta fill.js y después se llama con los datos como argumentos.
    expect(env.pageCalls.map((c) => c.files ?? c.method)).toEqual([['fill.js'], 'scan', ['fill.js'], 'fill']);
    expect(env.pageCalls[1]?.argument).toBe('lever');
    const request = fillCalls(env)[0]?.argument as Record<string, unknown>;
    expect(request).toMatchObject({
      ats: 'lever',
      askYouLabel: 'Contéstalo tú',
      profile: {
        name: 'Ana Ejemplo Prueba',
        email: 'ana@example.com',
        phone: '+34 600 000 000',
        location: 'Villanueva del Ejemplo, Provincia Ficticia',
        website: 'https://ana-ejemplo.example',
        currentTitle: 'Desarrolladora backend',
        currentCompany: 'Empresa Ficticia S.L.',
        yearsExperience: 6,
      },
      answers: [
        { question: 'Why do you want to work at Empresa Ficticia S.L.?', answer: 'Porque me gusta la plataforma.', type: 'redactar' },
        { question: 'Expected salary', answer: null, type: 'contesta_tu' },
      ],
      cv: { name: 'CV Ana.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: btoa('contenido') },
    });

    expect(body()).toContain('Preguntas abiertas respondidas: 1.');
    expect(body()).toContain('CV adjuntado.');
    expect(body()).toContain('Campos que contestas tú, marcados en rojo con «Contéstalo tú»: 2.');
    expect(body()).toContain('Aplica nunca envía el formulario: el envío lo haces tú.');
    // El token pide el enlace del CV en Word (el campo admite .docx) y no gasta créditos ni lanza nada.
    const downloads = env.calls.filter((c) => c.url.endsWith('/downloads'));
    expect(downloads).toHaveLength(1);
    expect(env.calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([`${API}/api/ext/v1/offers/a1/downloads`]);
  });

  it('elige el PDF cuando el campo solo admite PDF', async () => {
    const env = setup({ scan: { hasFileInput: true, accept: 'application/pdf' } });
    withReadyApplication(env);
    let requested = '';
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
      if (init?.method === 'POST' && input.endsWith('/downloads')) requested = typeof init.body === 'string' ? init.body : '';
      return original(input, init);
    });
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Datos de contacto rellenados'));
    expect(JSON.parse(requested)).toEqual({ format: 'pdf' });
  });

  it('sin permiso concedido no se toca la página ni se piden datos: solo queda copiar', async () => {
    const env = setup({ grant: false });
    withReadyApplication(env);
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Sin permiso para este sitio no se puede rellenar.'));
    expect(env.permissionRequests).toHaveLength(1);
    expect(env.pageCalls).toEqual([]);
    expect(calledProfile(env)).toBe(false);
    expect(buttonNamed('Rellenar este formulario')?.disabled).toBe(false);
    expect(buttonNamed('Ver mis datos')).toBeDefined();
  });

  it('sin candidatura de esta oferta rellena el contacto y dice por qué falta el resto', async () => {
    const env = setup({ fillResult: { ...SUMMARY, questionsFilled: 0, attachment: 'no_file' } });
    await openPanel();
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Esta oferta no tiene candidatura en Aplica'));
    const request = fillCalls(env)[0]?.argument as { cv: unknown; answers: unknown[] };
    expect(request.cv).toBeNull();
    expect(request.answers).toEqual([]);
    expect(env.calls.some((c) => c.url.includes('/documents'))).toBe(false);
    expect(body()).toContain('Aplica nunca envía el formulario');
  });

  it('con la candidatura sin preparar, también: contacto sí, documentos no', async () => {
    const env = setup();
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: NOT_READY } };
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('La candidatura aún no está preparada'));
    expect(env.calls.some((c) => c.url.includes('/documents'))).toBe(false);
    expect((fillCalls(env)[0]?.argument as { cv: unknown }).cv).toBeNull();
  });

  it('si no hay respuestas para alguna pregunta, ofrece generarlas en la candidatura de la web', async () => {
    const env = setup({ fillResult: { ...SUMMARY, questionsFilled: 0, questionsUnanswered: 2 } });
    withReadyApplication(env);
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Hay preguntas abiertas sin respuesta preparada.'));
    expect(body()).toContain('Preguntas abiertas sin respuesta preparada: 2.');
    // Hay dos botones "Abrir en Aplica" (el de la candidatura y el de esta sección): el de la sección va el último.
    Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Abrir en Aplica').at(-1)?.click();
    expect(env.created).toEqual([READY.url]);
  });

  it('si el CV no se puede bajar, rellena igualmente y lo dice', async () => {
    const env = setup({ fillResult: { ...SUMMARY, attachment: 'no_file' } });
    withReadyApplication(env);
    env.replies['POST /offers/a1/downloads'] = { status: 404, body: { error: 'not_found' } };
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('No se ha podido descargar el CV de Aplica.'));
    expect((fillCalls(env)[0]?.argument as { cv: unknown }).cv).toBeNull();
  });

  it('401 al pedir el perfil vuelve a "Conectar" y no inyecta nada', async () => {
    const env = setup();
    withReadyApplication(env);
    env.replies['GET /profile'] = { status: 401, body: {} };
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('nav:connectButton'));
    expect(fillCalls(env)).toEqual([]);
  });

  it('en una página que no es de un ATS no hay botón de rellenar, y si la pestaña cambió, no se inyecta', async () => {
    const env = setup();
    withReadyApplication(env);
    await openPanel('Ya tienes esta oferta en Aplica');
    env.tabUrl = 'https://empresa-ficticia.example/otra';
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Aquí no se rellena solo'));
    expect(env.pageCalls).toEqual([]);
  });
});

describe('panel: los datos del perfil no se guardan en el navegador (CV-507)', () => {
  it('ni al copiar ni al rellenar se escribe nada en storage más allá del token y el idioma', async () => {
    const env = setup();
    env.replies['GET /offers/match'] = { status: 200, body: { match: 'url', application: READY } };
    env.replies['GET /offers/a1/documents'] = { status: 200, body: DOCS };
    env.replies['POST /offers/a1/downloads'] = LINK;
    env.replies['GET /downloads/s3cret'] = FILE;
    await openPanel('Ya tienes esta oferta en Aplica');
    buttonNamed('Ver mis datos')?.click();
    await until(() => document.querySelector('.fill-form .requirements'));
    buttonNamed('Rellenar este formulario')?.click();
    await until(() => body().includes('Datos de contacto rellenados'));

    const written = JSON.stringify(env.storageWrites) + JSON.stringify(env.storage);
    for (const secret of ['ana@example.com', 'Ana Ejemplo', '+34 600', 'linkedin.com', 'Villanueva', 'ana-ejemplo', 'Porque me gusta']) {
      expect(written, secret).not.toContain(secret);
    }
    expect(new Set(env.storageWrites.map((w) => w.key))).toEqual(new Set(['aplica.locale']));
    expect(Object.keys(env.storage).sort()).toEqual(['aplica.locale', 'aplica.token']);
  });

  it('el código del rellenado no usa storage, cookies ni IndexedDB', () => {
    for (const file of ['src/fill/fill.ts', 'src/fill/inject.ts', 'src/panel/fill-section.ts', 'src/panel/fill-run.ts', 'src/panel/fill-page.ts']) {
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/storage|localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    }
  });
});
