// Panel lateral (CV-503, CV-504). DOM a mano, sin frameworks. Todo el texto va con
// textContent (nunca innerHTML) y por i18n.
//
// Estados (CV-504): no conectado, leyendo, vista previa (con aviso de posible duplicado),
// guardando, guardada, duplicado y error. Cada cambio de estado mueve el foco al título.

import { createApiClient, type ApplicationRef, type OfferPayload } from '../api';
import type { ApiClient } from '../api';
import { detectBrowser, extensionApi } from '../browser';
import { isLocale, loadLocale, resetLocale, t } from '../i18n';
import { createLocaleStore } from '../locale-store';
import { ICON_CLICKED } from '../messages';
import { MAX_DESCRIPTION, MAX_FIELD, type ExtractedOffer, type WorkMode } from '../extract/types';
import { createSession, type FailureReason } from '../session';
import type { Session } from '../session';
import { createTokenStore } from '../token-store';
import { devExportSection } from './dev-export';
import { readPage, type ReadOutcome } from './read-page';

const root = document.getElementById('app') as HTMLElement;
const live = document.getElementById('live') as HTMLElement;

type Notice = { key: string; substitutions?: string[]; alert?: boolean } | null;
type Draft = ExtractedOffer & { url: string };
type View = 'idle' | 'reading' | 'preview' | 'saving' | 'saved' | 'duplicate' | 'error';

const FIELDS = ['url', 'title', 'company', 'location', 'work_mode', 'salary', 'description'] as const;

let account: { email: string } | null = null;
let view: View = 'idle';
let draft: Draft | null = null;
// Invalida las respuestas de estados anteriores (lecturas o consultas que llegan tarde).
let generation = 0;
// Coincidencia de empresa y puesto detectada con la oferta de la vista previa actual: guardar
// pasa a pedir confirmación (force).
let similar: ApplicationRef | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const node = el('button', text, secondary ? 'secondary' : undefined);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Pinta el estado y lleva el foco al título (o al elemento indicado). */
function render(nodes: HTMLElement[], focus?: HTMLElement): void {
  live.textContent = '';
  root.replaceChildren(...nodes);
  const target = focus ?? root.querySelector('h1');
  if (target) {
    if (!target.hasAttribute('tabindex') && !(target instanceof HTMLInputElement)) target.tabIndex = -1;
    target.focus();
  }
}

/** Anuncio corto para lectores de pantalla (región aria-live fuera del contenido que se repinta). */
function announce(text: string): void {
  live.textContent = '';
  window.setTimeout(() => (live.textContent = text), 50);
}

function noticeNode(notice: Notice): HTMLElement[] {
  if (!notice) return [];
  const node = el('p', t(notice.key, notice.substitutions), 'notice');
  node.setAttribute('role', notice.alert ? 'alert' : 'status');
  return [node];
}

const failureKeys: Record<FailureReason | 'disconnect', string> = {
  cancelled: 'errorCancelled',
  denied: 'errorDenied',
  invalid: 'errorInvalid',
  network: 'errorNetwork',
  rate_limited: 'errorRateLimited',
  server: 'errorServer',
  disconnect: 'errorNetwork',
};

// ---------- Sesión y conexión (CV-503) ----------

function showConnect(session: Session, notice: Notice): void {
  view = 'idle';
  account = null;
  const connect = el('button', t('connectButton'));
  connect.type = 'button';
  connect.addEventListener('click', () => {
    connect.disabled = true;
    connect.textContent = t('connecting');
    void session.connect().then((outcome) => {
      if (outcome.status === 'connected') return start(session, null);
      showConnect(session, { key: failureKeys[outcome.reason] });
    });
  });
  render([el('h1', t('panelTitle')), el('p', t('connectIntro')), ...noticeNode(notice), connect]);
}

/** Pie de los estados con sesión: quién está conectado y cómo desconectar. */
function accountFooter(session: Session): HTMLElement {
  const footer = el('footer', undefined, 'account');
  const disconnect = button(
    t('disconnectButton'),
    () => {
      disconnect.disabled = true;
      void session.disconnect().then(async (outcome) => {
        if (outcome.status === 'disconnected') return start(session, null);
        disconnect.disabled = false;
        footer.querySelector('.notice')?.remove();
        footer.prepend(...noticeNode({ key: failureKeys[outcome.reason], alert: true }));
      });
    },
    true,
  );
  footer.append(el('p', t('connectedAs', account?.email ?? '')), disconnect);
  if (__DEV_BUILD__) footer.append(devExportSection());
  return footer;
}

/** Sin sesión el idioma vuelve a ser el del navegador y no queda nada del perfil. */
async function forgetLocale(): Promise<void> {
  resetLocale();
  await localeStore.clear();
}

async function start(session: Session, notice: Notice): Promise<void> {
  generation++;
  view = 'idle';
  render([el('h1', t('panelTitle')), el('p', t('loading'))]);
  const outcome = await session.refresh();
  switch (outcome.status) {
    case 'disconnected':
      await forgetLocale();
      showConnect(session, notice);
      return;
    case 'revoked':
      await forgetLocale();
      showConnect(session, { key: 'noticeRevoked' });
      return;
    case 'connected':
      account = { email: outcome.me.email };
      // El idioma del panel es el de la cuenta (CV-504): solo ese valor se guarda.
      if (isLocale(outcome.me.locale)) {
        await localeStore.set(outcome.me.locale);
        await loadLocale(outcome.me.locale);
      }
      void read(session);
      return;
    case 'error': {
      // Sin borrar el token: se avisa y se puede reintentar recargando el panel.
      const retry = el('button', t('retryButton'), 'secondary');
      retry.type = 'button';
      retry.addEventListener('click', () => void start(session, null));
      render([el('h1', t('panelTitle')), ...noticeNode({ key: failureKeys[outcome.reason], alert: true }), retry]);
    }
  }
}

// ---------- Lectura de la oferta (CV-504) ----------

const readDeps = {
  async queryActiveTab() {
    const tabs = await extensionApi().tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  },
  async runExtract(tabId: number) {
    const [injected] = await extensionApi().scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
    return injected?.result;
  },
};

async function read(session: Session): Promise<void> {
  const gen = ++generation;
  view = 'reading';
  similar = null;
  render([el('h1', t('panelTitle')), el('p', t('readingPage')), accountFooter(session)]);
  announce(t('readingPage'));
  const outcome = await readPage(readDeps);
  if (gen !== generation) return;
  showReadOutcome(session, outcome);
}

function readAgain(session: Session): HTMLButtonElement {
  return button(t('readAgainButton'), () => void read(session), true);
}

function showReadOutcome(session: Session, outcome: ReadOutcome): void {
  if (outcome.status === 'ok') {
    if (!outcome.offer.description) {
      // Ni datos estructurados ni extractor del portal: el texto seleccionado (CV-504).
      view = 'error';
      render([
        el('h1', t('panelTitle')),
        ...noticeNode({ key: 'needsSelection' }),
        button(t('readSelectionButton'), () => void read(session)),
        accountFooter(session),
      ]);
      return;
    }
    draft = outcome.offer;
    showPreview(session, { checkMatch: true });
    return;
  }
  view = 'error';
  const key = { no_access: 'noAccess', unsupported: 'unsupportedPage', failed: 'readFailed' }[outcome.status];
  render([
    el('h1', t('panelTitle')),
    ...noticeNode({ key, alert: true }),
    readAgain(session),
    accountFooter(session),
  ]);
}

// ---------- Vista previa editable ----------

type PreviewOptions = {
  checkMatch?: boolean;
  notice?: Notice;
  /** Coincidencia de empresa y puesto: se pide confirmación para guardar. */
  similar?: ApplicationRef;
  invalid?: string[];
};

function labelled(
  name: (typeof FIELDS)[number],
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  invalid: boolean,
): HTMLElement {
  const wrapper = el('div', undefined, 'field');
  control.id = `f-${name}`;
  control.name = name;
  const caption = el('label', label);
  caption.htmlFor = control.id;
  wrapper.append(caption, control);
  if (invalid) {
    control.setAttribute('aria-invalid', 'true');
    const error = el('p', t('fieldInvalid'), 'field-error');
    error.id = `e-${name}`;
    control.setAttribute('aria-describedby', error.id);
    wrapper.append(error);
  }
  return wrapper;
}

function textInput(value: string): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = MAX_FIELD;
  return input;
}

const WORK_MODE_KEYS: [WorkMode | '', string][] = [
  ['', 'workModeNone'],
  ['presencial', 'workModeOnsite'],
  ['hibrido', 'workModeHybrid'],
  ['remoto', 'workModeRemote'],
];

function showPreview(session: Session, options: PreviewOptions = {}): void {
  if (!draft) return;
  const current = draft;
  view = 'preview';
  similar = options.similar ?? null;
  const invalid = new Set(options.invalid ?? []);
  const force = similar !== null;

  const title = textInput(current.title);
  const company = textInput(current.company);
  const location = textInput(current.location);
  const salary = textInput(current.salary);
  const workMode = el('select');
  for (const [value, key] of WORK_MODE_KEYS) {
    const option = el('option', t(key));
    option.value = value;
    workMode.append(option);
  }
  workMode.value = current.workMode ?? '';
  const description = el('textarea');
  description.value = current.description;
  description.rows = 10;
  description.maxLength = MAX_DESCRIPTION;
  const count = el('p', undefined, 'hint');
  count.id = 'description-count';
  const updateCount = (): void => {
    count.textContent = t('descriptionCount', [String(description.value.length), String(MAX_DESCRIPTION)]);
  };
  updateCount();
  description.addEventListener('input', updateCount);
  description.setAttribute('aria-describedby', count.id);
  const link = textInput(current.url);
  link.readOnly = true;
  link.maxLength = 2048;

  const matchStatus = el('div', undefined, 'match-status');
  matchStatus.setAttribute('aria-live', 'polite');
  if (options.similar) matchStatus.append(similarNode(options.similar));

  const submit = el('button', t(force ? 'saveAnywayButton' : 'saveButton'));
  submit.type = 'submit';

  const form = el('form');
  form.noValidate = true;
  form.append(
    labelled('title', t('fieldTitle'), title, invalid.has('title')),
    labelled('company', t('fieldCompany'), company, invalid.has('company')),
    labelled('location', t('fieldLocation'), location, invalid.has('location')),
    labelled('work_mode', t('fieldWorkMode'), workMode, invalid.has('work_mode')),
    labelled('salary', t('fieldSalary'), salary, invalid.has('salary')),
    labelled('description', t('fieldDescription'), description, invalid.has('description')),
    count,
    labelled('url', t('fieldLink'), link, invalid.has('url')),
    submit,
    readAgain(session),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Lo editado se conserva aunque el guardado falle o pida confirmación.
    current.title = title.value.trim();
    current.company = company.value.trim();
    current.location = location.value.trim();
    current.salary = salary.value.trim();
    current.description = description.value.trim();
    current.workMode = (workMode.value || null) as WorkMode | null;
    void save(session);
  });

  const notes: Notice[] = [
    options.notice ?? null,
    current.descriptionTruncated ? { key: 'noticeTruncated', substitutions: [String(MAX_DESCRIPTION)] } : null,
    current.descriptionFromSelection ? { key: 'noticeFromSelection' } : null,
  ];
  const firstInvalid = FIELDS.find((name) => invalid.has(name));
  render(
    [
      el('h1', t('previewTitle')),
      el('p', t('previewIntro')),
      ...notes.flatMap(noticeNode),
      matchStatus,
      form,
      accountFooter(session),
    ],
    firstInvalid ? (form.querySelector<HTMLElement>(`#f-${firstInvalid}`) ?? undefined) : undefined,
  );

  if (options.checkMatch) void checkMatch(session, current, matchStatus);
}

function similarNode(application: ApplicationRef): HTMLElement {
  const node = el('p', t('possibleDuplicate', [application.title, application.company]), 'notice');
  node.setAttribute('role', 'status');
  return node;
}

async function checkMatch(session: Session, offer: Draft, status: HTMLElement): Promise<void> {
  const gen = generation;
  const token = await tokens.get();
  if (!token) return;
  const result = await client.matchOffer(token, { url: offer.url, title: offer.title, company: offer.company });
  // La persona ya ha cambiado de estado (guardando, otra lectura…): la respuesta ya no vale.
  if (gen !== generation || view !== 'preview') return;
  if (!result.ok) {
    if (result.kind === 'unauthenticated') await expireSession(session);
    // El resto de fallos no impide guardar: el servidor vuelve a comprobarlo al guardar.
    return;
  }
  if (!result.data) return;
  if (result.data.match === 'url') {
    showDuplicate(session, result.data.application);
    return;
  }
  // Guardar pasa a pedir confirmación (force) sin tocar lo que la persona esté editando.
  status.replaceChildren(similarNode(result.data.application));
  const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.textContent = t('saveAnywayButton');
  similar = result.data.application;
}

async function expireSession(session: Session): Promise<void> {
  await tokens.clear();
  await forgetLocale();
  showConnect(session, { key: 'noticeRevoked' });
}

// ---------- Guardar ----------

function payload(offer: Draft, force: boolean): OfferPayload {
  return {
    url: offer.url,
    title: offer.title,
    company: offer.company,
    location: offer.location,
    work_mode: offer.workMode,
    salary: offer.salary,
    description: offer.description,
    portal: offer.portal,
    force,
  };
}

async function save(session: Session): Promise<void> {
  if (!draft) return;
  const offer = draft;
  const force = similar !== null;
  const gen = ++generation;
  view = 'saving';
  const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  root.querySelectorAll('input, select, textarea, button').forEach((node) => {
    (node as HTMLInputElement).disabled = true;
  });
  if (submit) submit.textContent = t('saving');
  root.setAttribute('aria-busy', 'true');
  announce(t('saving'));

  const token = await tokens.get();
  if (!token) {
    await expireSession(session);
    return;
  }
  const result = await client.saveOffer(token, payload(offer, force));
  root.removeAttribute('aria-busy');
  if (gen !== generation) return;

  if (result.ok) {
    showSaved(session, result.data.application);
    return;
  }
  switch (result.kind) {
    case 'duplicate':
      if (result.match === 'url') {
        showDuplicate(session, result.application);
      } else {
        showPreview(session, { similar: result.application });
      }
      return;
    case 'invalid':
      showPreview(session, {
        notice: { key: 'invalidFields', alert: true },
        similar: similar ?? undefined,
        invalid: result.fields,
      });
      return;
    case 'unauthenticated':
      await expireSession(session);
      return;
    case 'insufficient_scope':
      showPreview(session, { notice: { key: 'errorScope', alert: true }, similar: similar ?? undefined });
      return;
    case 'network':
    case 'rate_limited':
      showPreview(session, { notice: { key: failureKeys[result.kind], alert: true }, similar: similar ?? undefined });
      return;
    default:
      showPreview(session, { notice: { key: 'errorServer', alert: true }, similar: similar ?? undefined });
  }
}

function openInAplica(application: ApplicationRef): HTMLElement[] {
  const url = application.url;
  if (!url) return [];
  return [button(t('openInAplica'), () => void extensionApi().tabs.create({ url }))];
}

function showSaved(session: Session, application: ApplicationRef): void {
  view = 'saved';
  similar = null;
  render([
    el('h1', t('savedTitle')),
    el('p', t('savedText', [application.title, application.company])),
    ...openInAplica(application),
    accountFooter(session),
  ]);
}

function showDuplicate(session: Session, application: ApplicationRef): void {
  view = 'duplicate';
  similar = null;
  render([
    el('h1', t('duplicateTitle')),
    el('p', t('duplicateText', [application.title, application.company])),
    ...openInAplica(application),
    readAgain(session),
    accountFooter(session),
  ]);
}

// ---------- Arranque ----------

const api = extensionApi();
const tokens = createTokenStore();
const localeStore = createLocaleStore();
const client: ApiClient = createApiClient(__API_BASE__);
const session = createSession({
  api: client,
  tokenStore: tokens,
  apiBase: __API_BASE__,
  browser: detectBrowser(api.runtime.getURL(''), navigator),
  redirectUrl: api.identity.getRedirectURL(),
  launchWebAuthFlow: (url) => api.identity.launchWebAuthFlow({ url, interactive: true }),
});

// Al volver a pulsar el icono con el panel abierto, se relee la página (nueva oferta, nuevo permiso).
api.runtime.onMessage.addListener((message: unknown) => {
  const isIconClick = typeof message === 'object' && message !== null && (message as { type?: unknown }).type === ICON_CLICKED;
  if (!isIconClick || !account || view === 'reading' || view === 'saving') return;
  if (view !== 'preview' || !draft) {
    void read(session);
    return;
  }
  // En la vista previa solo se relee si la pestaña ha cambiado de oferta: no se pierde lo editado.
  const shown = draft.url;
  void readPage(readDeps).then((outcome) => {
    if (outcome.status !== 'ok' || outcome.offer.url !== shown) void read(session);
  });
});

// El idioma de la cuenta de la última sesión, para que ni la primera pantalla parpadee.
void localeStore
  .get()
  .then((locale) => (locale ? loadLocale(locale) : false))
  .then(() => start(session, null));
