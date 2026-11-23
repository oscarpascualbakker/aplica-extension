// Panel lateral (CV-503, CV-504, CV-505, CV-506). DOM a mano, sin frameworks. Todo el texto va con
// textContent (nunca innerHTML) y por i18n.
//
// Estados (CV-504): no conectado, leyendo, vista previa (con aviso de posible duplicado),
// guardando, guardada, duplicado y error. Cada cambio de estado mueve el foco al título.
// Guardada y duplicado llevan el bloque del encaje exprés (CV-505); si la candidatura ya tiene los
// documentos preparados (`ready`), llevan en su lugar los documentos a un clic (CV-506, D-217).
// CV-508 (D-220): con el panel abierto, en la página de confirmación de un ATS, el estado "enviada"
// pregunta si se ha enviado la candidatura y la marca con un clic.

import {
  createApiClient,
  type ApplicationDocuments,
  type ApplicationRef,
  type DocumentFormat,
  type OfferPayload,
  type QuickFit,
  type QuickFitStatus,
  type QuickFitVerdict,
} from '../api';
import type { ApiClient } from '../api';
import { detectBrowser, extensionApi } from '../browser';
import { atsFromUrl } from '../fill/ats';
import { formatDate, isLocale, loadLocale, resetLocale, t } from '../i18n';
import { createLocaleStore } from '../locale-store';
import { ICON_CLICKED } from '../messages';
import { MAX_DESCRIPTION, MAX_FIELD, type ExtractedOffer, type WorkMode } from '../extract/types';
import { createSession, type FailureReason } from '../session';
import type { Session } from '../session';
import { createTokenStore } from '../token-store';
import { closePanel } from './close';
import { devExportSection } from './dev-export';
import { button, el } from './dom';
import { fillSection } from './fill-section';
import { readPage, type ReadOutcome, type TabInfo } from './read-page';
import { confirmSent, findSentCandidate, type Remembered, type SentCandidate } from './sent-run';

const root = document.getElementById('app') as HTMLElement;
const live = document.getElementById('live') as HTMLElement;

type Notice = { key: string; substitutions?: string[]; alert?: boolean } | null;
type Draft = ExtractedOffer & { url: string };
type View = 'idle' | 'reading' | 'preview' | 'saving' | 'saved' | 'duplicate' | 'error' | 'sent';

const FIELDS = ['url', 'title', 'company', 'location', 'work_mode', 'salary', 'description'] as const;

// `scopes` viene de /me; undefined si el servidor es anterior a CV-506 (se prueba y se ve).
let account: { email: string; scopes?: string[] } | null = null;
let view: View = 'idle';
let draft: Draft | null = null;
// Invalida las respuestas de estados anteriores (lecturas o consultas que llegan tarde).
let generation = 0;
// Coincidencia de empresa y puesto detectada con la oferta de la vista previa actual: guardar
// pasa a pedir confirmación (force).
let similar: ApplicationRef | null = null;
// CV-508: la última pestaña leída, lo que el panel sabe de cada pestaña y los avisos de "enviada" que la
// persona ha descartado. Solo en memoria mientras el panel está abierto; nunca en `storage.*`.
let activeTab: TabInfo | undefined;
const remembered = new Map<number, Remembered>();
const dismissed = new Set<string>();

/**
 * Botón para cerrar el panel (CV-523), en todos los estados. Se ve arriba a la derecha, pero va
 * el último en el orden del documento: el foco y el tabulador empiezan por el contenido.
 */
function closeButton(): HTMLButtonElement {
  const node = button(
    '✕',
    () => {
      closePanel();
    },
    true,
  );
  node.classList.add('close');
  node.setAttribute('aria-label', t('closeButton'));
  node.title = t('closeButton');
  return node;
}

/** Pinta el estado y lleva el foco al título (o al elemento indicado). */
function render(nodes: HTMLElement[], focus?: HTMLElement): void {
  live.textContent = '';
  root.replaceChildren(...nodes, closeButton());
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
      account = { email: outcome.me.email, scopes: outcome.me.scopes };
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
    activeTab = tabs[0];
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
  // CV-508: al pulsar el icono en la confirmación de un ATS (Workday la enseña sin cambiar de página), el
  // aviso de "enviada" va antes que leerla como oferta.
  const tab = activeTab;
  if (tab?.id !== undefined && tab.url && (await checkSent(session, tab.id, tab.url))) return;
  if (gen !== generation) return;
  if (outcome.status === 'ok' && tab?.id !== undefined && outcome.offer.description) {
    remembered.set(tab.id, { pageUrl: tab.url ?? outcome.offer.url, offer: outcome.offer, application: null });
  }
  showReadOutcome(session, outcome);
}

/** La candidatura de la oferta de la pestaña activa, para el aviso de "enviada" de su confirmación (CV-508). */
function rememberApplication(application: ApplicationRef): void {
  const tab = activeTab;
  if (tab?.id === undefined) return;
  const known = remembered.get(tab.id);
  remembered.set(tab.id, { pageUrl: known?.pageUrl ?? tab.url ?? draft?.url ?? '', offer: known?.offer ?? draft, application });
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
        fillBlock(session, outcome.offer.url, () => null),
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
    fillBlock(session, null, () => null),
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
  if (options.similar) matchStatus.append(similarNode(session, options.similar));

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
      fillBlock(session, current.url, () => similar),
      accountFooter(session),
    ],
    firstInvalid ? (form.querySelector<HTMLElement>(`#f-${firstInvalid}`) ?? undefined) : undefined,
  );

  if (options.checkMatch) void checkMatch(session, current, matchStatus);
}

function similarNode(session: Session, application: ApplicationRef): HTMLElement {
  const notice = el('p', t('possibleDuplicate', [application.title, application.company]), 'notice');
  notice.setAttribute('role', 'status');
  if (!application.ready) return notice;
  // Con los documentos preparados (CV-506): se ven aquí mismo, sin salir de la vista previa para no
  // perder lo que la persona esté editando.
  const wrapper = el('div');
  const show = button(t('documentsShowButton'), () => {
    show.replaceWith(documentsSection(session, application));
  }, true);
  wrapper.append(notice, show);
  return wrapper;
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
  status.replaceChildren(similarNode(session, result.data.application));
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
  rememberApplication(application);
  render([
    el('h1', t('savedTitle')),
    el('p', t('savedText', [application.title, application.company])),
    applicationBlock(session, application),
    ...openInAplica(application),
    fillBlock(session, draft?.url ?? null, () => application),
    accountFooter(session),
  ]);
}

function showDuplicate(session: Session, application: ApplicationRef): void {
  view = 'duplicate';
  similar = null;
  rememberApplication(application);
  render([
    el('h1', t('duplicateTitle')),
    el('p', t('duplicateText', [application.title, application.company])),
    applicationBlock(session, application),
    ...openInAplica(application),
    readAgain(session),
    fillBlock(session, draft?.url ?? null, () => application),
    accountFooter(session),
  ]);
}

// ---------- Registrar la candidatura como enviada (CV-508, D-220) ----------
//
// Solo con el panel abierto. Al terminar de cargar una página de uno de los siete ATS en la pestaña activa
// (o al pulsar el icono), el panel inyecta detect.js. Sin el permiso de host de ese ATS (CV-507) el navegador
// ni siquiera da la URL de la pestaña, así que no se lee nada. Nada cambia sin el clic de la persona.

const sentDeps = {
  async detect(tabId: number) {
    const [injected] = await extensionApi().scripting.executeScript({ target: { tabId }, files: ['detect.js'] });
    return injected?.result;
  },
};

const sentKey = (tabId: number, url: string): string => `${String(tabId)} ${url}`;

/** ¿Es la pestaña la confirmación de un ATS con una candidatura que marcar? Si lo es, enseña el aviso. */
async function checkSent(session: Session, tabId: number, tabUrl: string): Promise<boolean> {
  if (!account || !atsFromUrl(tabUrl) || dismissed.has(sentKey(tabId, tabUrl))) return false;
  const gen = generation;
  const token = await tokens.get();
  if (!token) return false;
  const found = await findSentCandidate(tabId, tabUrl, remembered.get(tabId), token, client, sentDeps);
  if (gen !== generation) return false;
  if (found === 'unauthenticated') {
    await expireSession(session);
    return true;
  }
  if (!found) return false;
  showSent(session, tabId, tabUrl, found);
  return true;
}

function sentNames(candidate: SentCandidate): { title: string; company: string } {
  return candidate.kind === 'existing'
    ? { title: candidate.application.title, company: candidate.application.company }
    : { title: candidate.offer.title, company: candidate.offer.company };
}

function showSent(session: Session, tabId: number, tabUrl: string, candidate: SentCandidate, notice: Notice = null, names = sentNames(candidate)): void {
  generation++;
  view = 'sent';
  const nodes: HTMLElement[] = [el('h1', t('sentTitle'))];
  let title: HTMLInputElement | null = null;
  let company: HTMLInputElement | null = null;

  if (candidate.kind === 'existing') {
    nodes.push(el('p', names.title && names.company ? t('sentQuestion', [names.title, names.company]) : t('sentQuestionUnnamed')));
  } else {
    // No está en la cuenta: se guardará ya como enviada, con lo que la persona deje escrito.
    title = textInput(names.title);
    company = textInput(names.company);
    nodes.push(el('p', t('sentQuestionNew')), labelled('title', t('fieldTitle'), title, false), labelled('company', t('fieldCompany'), company, false));
  }
  nodes.push(...noticeNode(notice));

  const mark = button(t('sentButton'), () => {
    const typed = { title: title ? title.value.trim() : names.title, company: company ? company.value.trim() : names.company };
    void markAsSent(session, tabId, tabUrl, candidate, typed, mark);
  });
  const notYet = button(t('sentNotYetButton'), () => {
    dismissed.add(sentKey(tabId, tabUrl));
    showSentDismissed(session);
  }, true);
  const actions = el('div', undefined, 'doc-actions');
  actions.append(mark, notYet);
  nodes.push(actions, el('p', t('sentHint'), 'hint'), accountFooter(session));
  render(nodes);
  announce(t('sentTitle'));
}

async function markAsSent(
  session: Session,
  tabId: number,
  tabUrl: string,
  candidate: SentCandidate,
  names: { title: string; company: string },
  mark: HTMLButtonElement,
): Promise<void> {
  const gen = generation;
  root.querySelectorAll('input, button').forEach((node) => {
    (node as HTMLInputElement).disabled = true;
  });
  mark.textContent = t('saving');
  root.setAttribute('aria-busy', 'true');
  announce(t('saving'));
  const token = await tokens.get();
  if (!token) {
    await expireSession(session);
    return;
  }
  const outcome = await confirmSent(candidate, names, token, client);
  root.removeAttribute('aria-busy');
  if (gen !== generation) return;
  switch (outcome.status) {
    case 'done':
    case 'later': {
      dismissed.add(sentKey(tabId, tabUrl));
      const known = remembered.get(tabId);
      remembered.set(tabId, { pageUrl: known?.pageUrl ?? tabUrl, offer: known?.offer ?? null, application: outcome.application });
      showSentDone(session, outcome.application, outcome.status === 'done' ? outcome.followUpAt : null, outcome.status === 'later');
      return;
    }
    case 'unauthenticated':
      await expireSession(session);
      return;
    default:
      showSent(session, tabId, tabUrl, candidate, { key: outcome.key, alert: true }, names);
  }
}

function showSentDone(session: Session, application: ApplicationRef, followUpAt: string | null, later: boolean): void {
  generation++;
  view = 'sent';
  const named = application.title && application.company;
  const nodes: HTMLElement[] = [el('h1', t(later ? 'sentLaterTitle' : 'sentDoneTitle'))];
  if (later) {
    nodes.push(el('p', t('sentLaterText')));
  } else {
    nodes.push(el('p', named ? t('sentDoneText', [application.title, application.company]) : t('sentDoneTextUnnamed')));
    // D-214: al pasar a enviada, Aplica propone el seguimiento a los 7 días si no había fecha.
    if (followUpAt) nodes.push(el('p', t('sentFollowUp', [formatDate(followUpAt)])));
  }
  nodes.push(...openInAplica(application), accountFooter(session));
  render(nodes);
  announce(t(later ? 'sentLaterTitle' : 'sentDoneTitle'));
}

function showSentDismissed(session: Session): void {
  generation++;
  view = 'idle';
  render([el('h1', t('panelTitle')), el('p', t('sentDismissedText')), readAgain(session), accountFooter(session)]);
}

/** Escucha las páginas que termina de cargar la pestaña activa de esta ventana, mientras el panel está abierto. */
async function watchTabs(session: Session): Promise<void> {
  // Pueden faltar (un navegador sin ellas, las pruebas): entonces no hay aviso automático, solo al pulsar el icono.
  const api = extensionApi() as { tabs: Partial<typeof chrome.tabs>; windows?: Partial<typeof chrome.windows> };
  const { tabs } = api;
  if (!tabs.onUpdated) return;
  let windowId: number | undefined;
  try {
    windowId = (await api.windows?.getCurrent?.())?.id;
  } catch {
    windowId = undefined;
  }
  tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.active || !tab.url) return;
    if (windowId !== undefined && tab.windowId !== windowId) return;
    // Sin interrumpir un guardado o una marca a medias.
    if (view === 'saving' || root.getAttribute('aria-busy') === 'true') return;
    activeTab = { id: tabId, url: tab.url };
    void checkSent(session, tabId, tab.url);
  });
  tabs.onRemoved?.addListener((tabId) => {
    remembered.delete(tabId);
  });
}

// ---------- Rellenar formularios (CV-507) ----------

/** La sección de copiar datos y autorrelleno de los ATS (src/panel/fill-section.ts). */
function fillBlock(session: Session, pageUrl: string | null, getApplication: () => ApplicationRef | null): HTMLElement {
  return fillSection({
    client,
    pageUrl,
    getApplication,
    scopes: () => account?.scopes,
    getToken: () => tokens.get(),
    announce,
    expire: () => expireSession(session),
    connect: async () => {
      const outcome = await session.connect();
      if (outcome.status === 'connected') {
        void start(session, null);
        return null;
      }
      return failureKeys[outcome.reason];
    },
    generation: () => generation,
    openTab: (url) => void extensionApi().tabs.create({ url }),
    profileUrl: `${__API_BASE__}/app`,
  });
}

// ---------- Encaje exprés (CV-505) ----------
//
// Solo con el botón, nunca al guardar. Desde aquí solo se hacen las lecturas gratis del día: el token
// no gasta créditos (D-204), así que, agotadas, el panel lleva a la candidatura en la web, donde se
// confirma el precio. El informe completo es el que manda, y el panel lo dice.

/** Bloque del encaje exprés en la web (D-211). */
const QUICK_FIT_ANCHOR = '#encaje-expres';
/** Bloque de preparar la candidatura en la web. */
const PREPARE_ANCHOR = '#preparar';

const VERDICT_KEYS: Record<QuickFitVerdict, string> = {
  apply: 'verdictApply',
  apply_with_caveats: 'verdictCaveats',
  do_not_apply: 'verdictDoNotApply',
};
const STATUS_KEYS: Record<QuickFitStatus, string> = {
  covered: 'statusCovered',
  to_confirm: 'statusToConfirm',
  missing: 'statusMissing',
};

function withAnchor(url: string, anchor: string): string {
  return url.replace(/#.*$/, '') + anchor;
}

function openTab(text: string, url: string | null, secondary = false): HTMLElement[] {
  if (!url) return [];
  return [button(text, () => void extensionApi().tabs.create({ url }), secondary)];
}

/**
 * El bloque empieza oculto: si la funcionalidad está apagada (404), no sale. Con la respuesta enseña la
 * última lectura o el botón para hacer una.
 */
function quickFitSection(session: Session, application: ApplicationRef): HTMLElement {
  const section = el('section', undefined, 'quick-fit');
  const heading = el('h2', t('quickFitTitle'));
  heading.id = 'quick-fit-title';
  heading.tabIndex = -1;
  section.setAttribute('aria-labelledby', heading.id);
  const content = el('div');
  section.append(heading, content);
  section.hidden = true;
  void loadQuickFit(session, application, section, content);
  return section;
}

async function loadQuickFit(session: Session, application: ApplicationRef, section: HTMLElement, content: HTMLElement): Promise<void> {
  const gen = generation;
  const token = await tokens.get();
  if (!token) return;
  const result = await client.getQuickFit(token, application.id);
  if (gen !== generation) return;
  if (!result.ok) {
    if (result.kind === 'not_found') return;
    if (result.kind === 'unauthenticated') {
      await expireSession(session);
      return;
    }
    // Sin saber cuántas quedan, se ofrece igual: la lectura dice después lo que pase.
    section.hidden = false;
    quickFitIdle(session, application, content, null);
    return;
  }
  section.hidden = false;
  if (result.data.quickFit) {
    quickFitShow(application, content, result.data.quickFit, null);
  } else if (result.data.freeLeft === 0) {
    quickFitNotice(content, { key: 'quickFitCreditsRequired', substitutions: [String(result.data.price)] }, [
      ...openTab(t('quickFitOpenWeb'), application.url ? withAnchor(application.url, QUICK_FIT_ANCHOR) : null),
    ]);
  } else {
    quickFitIdle(session, application, content, result.data.freeLeft);
  }
}

function quickFitIdle(session: Session, application: ApplicationRef, content: HTMLElement, freeLeft: number | null, notice: Notice = null): void {
  const run = button(t('quickFitButton'), () => void runQuickFit(session, application, content, run));
  content.replaceChildren(
    el('p', t('quickFitIntro')),
    ...noticeNode(notice),
    ...(freeLeft === null ? [] : [el('p', t('quickFitFreeLeft', [String(freeLeft)]), 'hint')]),
    run,
  );
}

function quickFitNotice(content: HTMLElement, notice: Notice, actions: HTMLElement[]): void {
  content.replaceChildren(...noticeNode(notice), ...actions);
}

function quickFitShow(application: ApplicationRef, content: HTMLElement, fit: QuickFit, freeLeft: number | null): void {
  const list = el('ul', undefined, 'requirements');
  for (const item of fit.requirements) {
    const row = el('li', undefined, `requirement ${item.status}`);
    row.append(el('strong', `${t(STATUS_KEYS[item.status])}: `), document.createTextNode(item.requirement));
    if (item.note) row.append(el('span', item.note, 'note'));
    list.append(row);
  }
  content.replaceChildren(
    el('p', t('quickFitVerdict', [t(VERDICT_KEYS[fit.verdict])]), `verdict ${fit.verdict}`),
    el('p', fit.verdictReason),
    list,
    el('p', t('quickFitDisclaimer'), 'hint'),
    ...(freeLeft === null ? [] : [el('p', t('quickFitFreeLeft', [String(freeLeft)]), 'hint')]),
    ...openTab(t('prepareFullButton'), application.url ? withAnchor(application.url, PREPARE_ANCHOR) : null),
  );
}

async function runQuickFit(session: Session, application: ApplicationRef, content: HTMLElement, run: HTMLButtonElement): Promise<void> {
  const gen = generation;
  run.disabled = true;
  run.textContent = t('quickFitRunning');
  content.setAttribute('aria-busy', 'true');
  announce(t('quickFitRunning'));
  const token = await tokens.get();
  if (!token) {
    await expireSession(session);
    return;
  }
  const result = await client.runQuickFit(token, application.id);
  content.removeAttribute('aria-busy');
  if (gen !== generation) return;
  const heading = root.querySelector<HTMLElement>('#quick-fit-title');

  if (result.ok) {
    quickFitShow(application, content, result.data.quickFit, result.data.freeLeft);
    heading?.focus();
    announce(t('quickFitVerdict', [t(VERDICT_KEYS[result.data.quickFit.verdict])]));
    return;
  }
  const web = (anchor: string, url: string | null = null): string | null =>
    url ?? (application.url ? withAnchor(application.url, anchor) : null);
  switch (result.kind) {
    case 'unauthenticated':
      await expireSession(session);
      return;
    case 'credits_required':
      quickFitNotice(content, { key: 'quickFitCreditsRequired', substitutions: [String(result.price)], alert: true }, [
        ...openTab(t('quickFitOpenWeb'), web(QUICK_FIT_ANCHOR, result.url)),
      ]);
      break;
    case 'report_exists':
      quickFitNotice(content, { key: 'quickFitReportExists', alert: true }, [
        ...openTab(t('openInAplica'), result.url ?? application.url),
      ]);
      break;
    case 'no_posting':
      quickFitNotice(content, { key: 'quickFitNoPosting', alert: true }, [...openTab(t('openInAplica'), application.url)]);
      break;
    case 'no_profile':
      quickFitNotice(content, { key: 'quickFitNoProfile', alert: true }, [
        ...openTab(t('openInAplica'), `${__API_BASE__}/app`),
      ]);
      break;
    case 'not_found':
      quickFitNotice(content, { key: 'errorServer', alert: true }, []);
      break;
    default: {
      // Fallos que no gastan lectura: se puede volver a intentar desde el mismo botón.
      const keys: Record<string, string> = {
        running: 'quickFitBusy',
        unavailable: 'quickFitUnavailable',
        failed: result.kind === 'failed' && result.code === 'refused' ? 'quickFitRefused' : 'quickFitFailed',
        insufficient_scope: 'errorScopeQuickFit',
        network: 'errorNetwork',
        rate_limited: 'errorRateLimited',
      };
      quickFitIdle(session, application, content, null, { key: keys[result.kind] ?? 'errorServer', alert: true });
    }
  }
  heading?.focus();
}

// ---------- Documentos de una candidatura preparada (CV-506, D-217) ----------
//
// Si la candidatura tiene los documentos listos (`ready`), el panel los pone a un clic: el CV en
// Word y en PDF, la carta, el mensaje al reclutador y cada respuesta del formulario por separado.
// El token nunca lanza candidaturas ni gasta créditos (D-204). Sin permisos nuevos: el fichero se
// baja con fetch y se guarda con un <a download> (sin `downloads`), y se copia con el portapapeles
// desde el clic (sin `clipboardWrite`).

/** Alcance que hace falta para ver los documentos. */
const DOCUMENTS_SCOPE = 'documents.read';
/** Cuánto tarda en soltarse la URL del Blob: lo justo para que el navegador empiece a guardarlo. */
const REVOKE_AFTER_MS = 10_000;

/** Los documentos si la candidatura está preparada; si no, el encaje exprés de siempre. */
function applicationBlock(session: Session, application: ApplicationRef): HTMLElement {
  return application.ready ? documentsSection(session, application) : quickFitSection(session, application);
}

function documentsSection(session: Session, application: ApplicationRef): HTMLElement {
  const section = el('section', undefined, 'quick-fit documents');
  const heading = el('h2', t('documentsTitle'));
  heading.id = 'documents-title';
  heading.tabIndex = -1;
  section.setAttribute('aria-labelledby', heading.id);
  const content = el('div');
  section.append(heading, content);
  if (account?.scopes && !account.scopes.includes(DOCUMENTS_SCOPE)) {
    documentsReconnect(session, content);
  } else {
    content.append(el('p', t('loading')));
    void loadDocuments(session, application, content);
  }
  return section;
}

/**
 * Token de antes del alcance nuevo: se explica y se ofrece conectar de nuevo. No se borra el token
 * sin que la persona lo pida; al conectar, el nuevo lo sustituye.
 */
function documentsReconnect(session: Session, content: HTMLElement, notice: Notice = null): void {
  const connect = button(t('documentsReconnectButton'), () => {
    connect.disabled = true;
    connect.textContent = t('connecting');
    void session.connect().then((outcome) => {
      if (outcome.status === 'connected') return start(session, null);
      documentsReconnect(session, content, { key: failureKeys[outcome.reason], alert: true });
    });
  });
  content.replaceChildren(el('p', t('documentsReconnectText')), ...noticeNode(notice), connect);
}

async function loadDocuments(session: Session, application: ApplicationRef, content: HTMLElement): Promise<void> {
  const gen = generation;
  const token = await tokens.get();
  if (!token) return;
  const result = await client.getDocuments(token, application.id);
  if (gen !== generation) return;
  if (result.ok) {
    documentsShow(session, application, content, result.data);
    return;
  }
  switch (result.kind) {
    case 'unauthenticated':
      await expireSession(session);
      return;
    case 'insufficient_scope':
      documentsReconnect(session, content);
      return;
    case 'not_ready':
      content.replaceChildren(
        ...noticeNode({ key: 'documentsNotReady' }),
        ...openTab(t('openInAplica'), application.url ? withAnchor(application.url, PREPARE_ANCHOR) : null),
      );
      return;
    default: {
      const key = result.kind === 'network' || result.kind === 'rate_limited' ? failureKeys[result.kind] : 'errorServer';
      const retry = button(t('retryButton'), () => {
        content.replaceChildren(el('p', t('loading')));
        void loadDocuments(session, application, content);
      }, true);
      content.replaceChildren(...noticeNode({ key, alert: true }), retry);
    }
  }
}

/** Copia con el clic de la persona y lo dice en la región `live`. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    announce(t('documentsCopied'));
  } catch {
    announce(t('documentsCopyFailed'));
  }
}

function copyButton(label: string, text: string, ariaLabel?: string): HTMLButtonElement {
  const node = button(label, () => void copyText(text), true);
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  return node;
}

/** Un texto largo (carta, mensaje) plegado, con su botón de copiar fuera para tenerlo siempre a mano. */
function textBlock(title: string, text: string, copyLabel: string): HTMLElement {
  const block = el('div', undefined, 'doc-block');
  const details = el('details');
  details.append(el('summary', title), el('p', text, 'doc-text'));
  block.append(details, copyButton(copyLabel, text));
  return block;
}

function documentsShow(session: Session, application: ApplicationRef, content: HTMLElement, docs: ApplicationDocuments): void {
  const notices = el('div', undefined, 'doc-notices');
  const nodes: HTMLElement[] = [el('p', t('documentsIntro')), notices];

  if (docs.cv.docx || docs.cv.pdf) {
    const row = el('div', undefined, 'doc-actions');
    if (docs.cv.docx) row.append(downloadButton(session, application, notices, 'docx', t('documentsDownloadDocx')));
    if (docs.cv.pdf) row.append(downloadButton(session, application, notices, 'pdf', t('documentsDownloadPdf')));
    nodes.push(row);
  }
  if (docs.letter) nodes.push(textBlock(t('documentsLetter'), docs.letter, t('documentsCopyLetter')));
  if (docs.message) nodes.push(textBlock(t('documentsMessage'), docs.message, t('documentsCopyMessage')));

  if (docs.questions.length > 0) {
    nodes.push(el('h3', t('documentsQuestions')));
    for (const set of docs.questions) {
      if (docs.questions.length > 1 && set.generatedAt) {
        const when = new Date(set.generatedAt);
        if (!Number.isNaN(when.getTime())) nodes.push(el('p', t('documentsQuestionsFrom', [when.toLocaleDateString()]), 'hint'));
      }
      if (set.truncated) nodes.push(el('p', t('documentsQuestionsTruncated'), 'hint'));
      const list = el('ul', undefined, 'requirements');
      for (const item of set.items) {
        const row = el('li', undefined, 'requirement');
        row.append(el('strong', item.question));
        // `contesta_tu` no tiene respuesta: se enseña la pregunta y su nota, sin botón de copiar.
        if (item.answer && item.type === 'redactar') {
          row.append(
            el('span', item.answer, 'doc-text'),
            copyButton(t('documentsCopyAnswer'), item.answer, t('documentsCopyAnswerFor', [item.question])),
          );
        } else {
          row.append(el('span', t('documentsAnswerYourself'), 'note'));
        }
        if (item.note) row.append(el('span', item.note, 'note'));
        list.append(row);
      }
      nodes.push(list);
    }
  }
  nodes.push(...openTab(t('openInAplica'), docs.url ?? application.url, true));
  content.replaceChildren(...nodes);
}

function downloadButton(
  session: Session,
  application: ApplicationRef,
  notices: HTMLElement,
  format: DocumentFormat,
  label: string,
): HTMLButtonElement {
  const node = button(label, () => {
    node.disabled = true;
    node.textContent = t('documentsPreparing');
    notices.replaceChildren();
    void downloadDocument(session, application, format).then((key) => {
      node.disabled = false;
      node.textContent = label;
      if (key) notices.replaceChildren(...noticeNode({ key, alert: true }));
      else announce(t('documentsDownloaded'));
    });
  });
  return node;
}

/** Pide el enlace y baja el fichero. Devuelve la clave del error, o null si ha ido bien. */
async function downloadDocument(session: Session, application: ApplicationRef, format: DocumentFormat): Promise<string | null> {
  const gen = generation;
  const token = await tokens.get();
  if (!token) {
    await expireSession(session);
    return null;
  }
  // El enlace es de un solo uso y caduca: si ya no vale (410), se pide uno nuevo una sola vez.
  for (let attempt = 0; attempt < 2; attempt++) {
    const link = await client.requestDownload(token, application.id, format);
    if (gen !== generation) return null;
    if (!link.ok) return downloadFailureKey(session, link.kind);
    const file = await client.downloadFile(link.data.url, format);
    if (gen !== generation) return null;
    if (file.ok) {
      saveBlob(file.data.blob, file.data.filename);
      return null;
    }
    if (file.kind !== 'gone') return downloadFailureKey(session, file.kind);
  }
  return 'documentsDownloadFailed';
}

function downloadFailureKey(session: Session, kind: string): string | null {
  switch (kind) {
    case 'unauthenticated':
      void expireSession(session);
      return null;
    case 'insufficient_scope':
      return 'documentsScopeMissing';
    case 'not_ready':
      return 'documentsNotReady';
    case 'not_found':
      return 'documentsFormatMissing';
    case 'network':
    case 'rate_limited':
      return failureKeys[kind];
    default:
      return 'documentsDownloadFailed';
  }
}

/** Blob y <a download>: guarda el fichero sin el permiso `downloads` (D-204). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
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

// CV-508: la confirmación de un ATS mientras el panel está abierto.
void watchTabs(session);

// El idioma de la cuenta de la última sesión, para que ni la primera pantalla parpadee.
void localeStore
  .get()
  .then((locale) => (locale ? loadLocale(locale) : false))
  .then(() => start(session, null));
