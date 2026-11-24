// Sección "Rellenar formulario" del panel (CV-507).
//
// Fase A, en todos los sitios: los datos del perfil en una lista, cada uno con su botón de copiar
// (navigator.clipboard.writeText desde el clic, sin permiso `clipboardWrite`).
// Fase B, en los siete ATS: "Rellenar este formulario" rellena los campos de contacto, adjunta el CV de
// la candidatura y responde las preguntas abiertas con las respuestas de CV-473. Pide el permiso de host
// del ATS al pulsar. Nunca envía el formulario: el envío lo hace la persona. Nunca rellena visado,
// salario, género y demás sensibles: los deja vacíos y los marca "Contéstalo tú".
//
// Los datos del perfil solo viven en el DOM de esta sección mientras el panel no se repinta: nada se
// guarda en `storage.*` ni en ninguna variable del módulo.

import type { ApiClient, ApplicationRef, ProfileData, ProfileResult } from '../api';
import { atsFromUrl } from '../fill/ats';
import { t } from '../i18n';
import { button, el } from './dom';
import { fillPageDeps } from './fill-page';
import { runFill, type FillOutcome, type Missing } from './fill-run';

const PROFILE_SCOPE = 'profile.read';
const DOCUMENTS_SCOPE = 'documents.read';

export type FillContext = {
  client: ApiClient;
  /** URL de la página que se está viendo (la de la oferta o el formulario), o null si no se sabe. */
  pageUrl: string | null;
  /** La candidatura de esta oferta en Aplica, si hay. Se pide al usarla: puede llegar después. */
  getApplication(): ApplicationRef | null;
  /** Alcances del token según /me; undefined si el servidor no los dice. */
  scopes(): string[] | undefined;
  getToken(): Promise<string | null>;
  announce(text: string): void;
  /** El token ya no vale: vuelve a "Conectar". */
  expire(): Promise<void>;
  /** Conecta de nuevo el navegador. Devuelve la clave del error o null si ha ido bien. */
  connect(): Promise<string | null>;
  generation(): number;
  openTab(url: string): void;
  /** Dirección de Aplica donde se crea el perfil. */
  profileUrl: string;
};

type Row = { label: string; value: string };

/** Lo que se puede copiar del perfil, en el orden del panel. Sin valor, no hay fila. */
export function profileRows(profile: ProfileData): Row[] {
  const rows: Row[] = [];
  const add = (key: string, value: string | null): void => {
    if (value) rows.push({ label: t(key), value });
  };
  add('fillLabelName', profile.name);
  add('fillLabelEmail', profile.email);
  add('fillLabelPhone', profile.phone);
  add('fillLabelCity', profile.location);
  add('fillLabelLinkedin', profile.linkedin);
  add('fillLabelGithub', profile.github);
  for (const site of profile.websites) add('fillLabelWebsite', site);
  const role = profile.currentRole;
  if (role?.title) add('fillLabelRole', role.company ? t('fillRoleAt', [role.title, role.company]) : role.title);
  else add('fillLabelRole', role?.company ?? null);
  add('fillLabelExperience', profile.yearsExperience === null ? null : String(profile.yearsExperience));
  for (const item of profile.education) add('fillLabelEducation', item);
  return rows;
}

const MISSING_KEYS: Record<Exclude<Missing, null>, string> = {
  no_application: 'fillMissingNoApplication',
  not_ready: 'fillMissingNotReady',
  no_scope: 'fillMissingScope',
  documents_failed: 'fillMissingDocuments',
};

export function fillSection(ctx: FillContext): HTMLElement {
  const ats = atsFromUrl(ctx.pageUrl);
  // CV-544: fuera de los siete ATS solo se pueden copiar datos, así que la sección va plegada y no compite
  // con la acción principal de la pantalla. En un ATS va abierta: rellenar es lo que toca.
  const section = ats ? el('section', undefined, 'fill-form') : el('details', undefined, 'fill-form');
  const heading = el('h2', t('fillTitle'));
  heading.id = 'fill-title';
  heading.tabIndex = -1;
  section.setAttribute('aria-labelledby', heading.id);

  const notices = el('div', undefined, 'doc-notices');
  const list = el('div');
  const result = el('div');
  result.setAttribute('aria-live', 'polite');
  const actions = el('div', undefined, 'doc-actions');

  const note = (key: string, alert = false): HTMLElement => {
    const node = el('p', t(key), 'notice');
    node.setAttribute('role', alert ? 'alert' : 'status');
    return node;
  };

  /** Errores de la lectura del perfil, con lo que la persona puede hacer. */
  const profileError = async (error: Exclude<ProfileResult, { ok: true }>): Promise<void> => {
    switch (error.kind) {
      case 'unauthenticated':
        await ctx.expire();
        return;
      case 'no_profile': {
        const open = button(t('openInAplica'), () => {
          ctx.openTab(ctx.profileUrl);
        }, true);
        notices.replaceChildren(note('fillNoProfile', true), open);
        return;
      }
      case 'insufficient_scope':
        reconnect();
        return;
      case 'network':
      case 'rate_limited':
        notices.replaceChildren(note(error.kind === 'network' ? 'errorNetwork' : 'errorRateLimited', true));
        return;
      default:
        notices.replaceChildren(note('errorServer', true));
    }
  };

  const reconnect = (message = 'fillScopeMissing', failure: string | null = null): void => {
    const connect = button(t('documentsReconnectButton'), () => {
      connect.disabled = true;
      connect.textContent = t('connecting');
      void ctx.connect().then((key) => {
        if (key) reconnect(message, key);
      });
    });
    notices.replaceChildren(note(message, true), ...(failure ? [note(failure, true)] : []), connect);
  };

  // Fase A: la lista de datos, a petición.
  const show = button(t('fillShowButton'), () => {
    show.disabled = true;
    notices.replaceChildren();
    void (async () => {
      const gen = ctx.generation();
      const scopes = ctx.scopes();
      if (scopes && !scopes.includes(PROFILE_SCOPE)) {
        show.disabled = false;
        reconnect();
        return;
      }
      const token = await ctx.getToken();
      if (!token) {
        await ctx.expire();
        return;
      }
      list.replaceChildren(el('p', t('loading')));
      const profile = await ctx.client.getProfile(token);
      if (gen !== ctx.generation()) return;
      show.disabled = false;
      if (!profile.ok) {
        list.replaceChildren();
        await profileError(profile);
        return;
      }
      list.replaceChildren(...dataList(ctx, profile.data));
    })();
  }, true);
  actions.append(show);

  if (ats) {
    const run = button(t('fillButton'), () => {
      run.disabled = true;
      run.textContent = t('fillRunning');
      notices.replaceChildren();
      result.replaceChildren();
      const scopes = ctx.scopes();
      const gen = ctx.generation();
      // El permiso de host se pide dentro de este clic: runFill lo hace antes de cualquier otro await.
      const outcome = runFill(
        {
          pageUrl: ctx.pageUrl ?? '',
          application: ctx.getApplication(),
          hasDocumentsScope: !scopes || scopes.includes(DOCUMENTS_SCOPE),
          askYouLabel: t('fillAskYouLabel'),
          getToken: () => ctx.getToken(),
        },
        ctx.client,
        fillPageDeps,
      );
      void outcome.then(async (done) => {
        if (gen !== ctx.generation()) return;
        run.disabled = false;
        run.textContent = t('fillButton');
        await showOutcome(done);
      });
    });
    // En un ATS, rellenar es la acción principal: va la primera.
    actions.prepend(run);
  }

  const showOutcome = async (outcome: FillOutcome): Promise<void> => {
    switch (outcome.status) {
      case 'denied':
        notices.replaceChildren(note('fillPermissionDenied', true));
        return;
      case 'no_access':
        notices.replaceChildren(note('fillNoAccess', true));
        return;
      case 'unsupported':
        notices.replaceChildren(note('fillUnsupported', true));
        return;
      case 'failed':
        notices.replaceChildren(note('fillFailed', true));
        return;
      case 'unauthenticated':
        await ctx.expire();
        return;
      case 'profile_error':
        await profileError(outcome.error);
        return;
      case 'done':
        result.replaceChildren(...resultNodes(ctx, outcome));
        ctx.announce(t('fillDone'));
    }
  };

  const intro = el('p', t('fillIntro'));
  const hint = el('p', ats ? t('fillPermissionHint') : t('fillUnsupported'), 'hint');
  const body = el('div', undefined, 'fill-body');
  body.append(intro, actions, hint, notices, list, result);
  if (ats) {
    section.append(heading, body);
  } else {
    const summary = el('summary');
    summary.append(heading);
    section.append(summary, body);
  }
  return section;
}

/** La lista de datos con un botón de copiar en cada uno. */
function dataList(ctx: FillContext, profile: ProfileData): HTMLElement[] {
  const rows = profileRows(profile);
  if (rows.length === 0) return [el('p', t('fillNoData'))];
  const list = el('ul', undefined, 'requirements');
  for (const row of rows) {
    const item = el('li', undefined, 'requirement');
    const copy = button(t('fillCopy'), () => {
      void copyText(ctx, row.value);
    }, true);
    copy.setAttribute('aria-label', t('fillCopyFor', [row.label]));
    item.append(el('strong', row.label), el('span', row.value, 'doc-text'), copy);
    list.append(item);
  }
  return [list];
}

async function copyText(ctx: FillContext, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ctx.announce(t('documentsCopied'));
  } catch {
    ctx.announce(t('documentsCopyFailed'));
  }
}

const ATTACHMENT_KEYS = {
  attached: 'fillResultCvAttached',
  had_file: 'fillResultCvHad',
  no_input: 'fillResultCvNoInput',
  not_accepted: 'fillResultCvNotAccepted',
  failed: 'fillResultCvFailed',
} as const;

/** El resumen de lo hecho, lo que falta y el recordatorio de revisar y enviar tú. */
function resultNodes(ctx: FillContext, outcome: Extract<FillOutcome, { status: 'done' }>): HTMLElement[] {
  const { summary } = outcome;
  const lines: string[] = [];
  if (summary.filled.length > 0) lines.push(t('fillResultFilled', [String(summary.filled.length)]));
  if (summary.questionsFilled > 0) lines.push(t('fillResultQuestions', [String(summary.questionsFilled)]));
  if (summary.attachment !== 'no_file') lines.push(t(ATTACHMENT_KEYS[summary.attachment]));
  else if (outcome.cvStatus === 'download_failed') lines.push(t('fillResultCvDownload'));
  else if (outcome.cvStatus === 'format') lines.push(t('fillResultCvNotAccepted'));
  if (summary.hadValue > 0) lines.push(t('fillResultHadValue', [String(summary.hadValue)]));
  if (summary.askYou > 0) lines.push(t('fillResultAskYou', [String(summary.askYou)]));
  if (summary.questionsUnanswered > 0) lines.push(t('fillResultUnanswered', [String(summary.questionsUnanswered)]));
  if (lines.length === 0) lines.push(t('fillResultNothing'));

  const list = el('ul', undefined, 'requirements');
  for (const line of lines) list.append(el('li', line, 'requirement'));

  const nodes: HTMLElement[] = [list];
  const link = outcome.applicationUrl;
  const open = (): HTMLElement[] => (link ? [button(t('openInAplica'), () => { ctx.openTab(link); }, true)] : []);
  if (outcome.missing) {
    // Sin candidatura preparada: se dice por qué falta el resto.
    nodes.push(el('p', t(MISSING_KEYS[outcome.missing]), 'hint'), ...open());
  } else if (summary.questionsUnanswered > 0) {
    // Candidatura preparada pero sin respuestas para estas preguntas: se ofrece generarlas en la web.
    nodes.push(el('p', t('fillGenerateQuestions'), 'hint'), ...open());
  }
  nodes.push(el('p', t('fillReviewNote'), 'notice'));
  return nodes;
}
