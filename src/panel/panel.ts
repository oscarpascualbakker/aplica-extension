// Panel lateral (CV-503): estados "Conectar" y "Conectado como". DOM a mano, sin frameworks.
// Todo el texto va con textContent (nunca innerHTML) y por i18n.

import { createApiClient } from '../api';
import { detectBrowser, extensionApi } from '../browser';
import { t } from '../i18n';
import { createSession, type FailureReason } from '../session';
import type { Session } from '../session';
import { createTokenStore } from '../token-store';

const root = document.getElementById('app') as HTMLElement;

type Notice = { key: string } | null;

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

function render(...nodes: HTMLElement[]): void {
  root.replaceChildren(...nodes);
}

function noticeNode(notice: Notice): HTMLElement[] {
  if (!notice) return [];
  const node = el('p', t(notice.key), 'notice');
  node.setAttribute('role', 'status');
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

function showConnect(session: Session, notice: Notice): void {
  const button = el('button', t('connectButton'));
  button.type = 'button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = t('connecting');
    void session.connect().then((outcome) => {
      if (outcome.status === 'connected') return start(session, null);
      showConnect(session, { key: failureKeys[outcome.reason] });
    });
  });
  render(el('h1', t('panelTitle')), el('p', t('connectIntro')), ...noticeNode(notice), button);
}

function showConnected(session: Session, email: string): void {
  const button = el('button', t('disconnectButton'), 'secondary');
  button.type = 'button';
  button.addEventListener('click', () => {
    button.disabled = true;
    void session.disconnect().then(async (outcome) => {
      if (outcome.status === 'disconnected') return start(session, null);
      showConnectedWithNotice(session, email, { key: failureKeys[outcome.reason] });
    });
  });
  render(el('h1', t('panelTitle')), el('p', t('connectedAs', email)), button);
}

function showConnectedWithNotice(session: Session, email: string, notice: Notice): void {
  showConnected(session, email);
  root.insertBefore(noticeNode(notice)[0] as HTMLElement, root.lastElementChild);
}

async function start(session: Session, notice: Notice): Promise<void> {
  render(el('h1', t('panelTitle')), el('p', t('loading')));
  const outcome = await session.refresh();
  switch (outcome.status) {
    case 'disconnected':
      showConnect(session, notice);
      return;
    case 'revoked':
      showConnect(session, { key: 'noticeRevoked' });
      return;
    case 'connected':
      showConnected(session, outcome.me.email);
      return;
    case 'error': {
      // Sin borrar el token: se avisa y se puede reintentar recargando el panel.
      const retry = el('button', t('retryButton'), 'secondary');
      retry.type = 'button';
      retry.addEventListener('click', () => void start(session, null));
      render(el('h1', t('panelTitle')), ...noticeNode({ key: failureKeys[outcome.reason] }), retry);
    }
  }
}

const api = extensionApi();
const session = createSession({
  api: createApiClient(__API_BASE__),
  tokenStore: createTokenStore(),
  apiBase: __API_BASE__,
  browser: detectBrowser(api.runtime.getURL(''), navigator),
  redirectUrl: api.identity.getRedirectURL(),
  launchWebAuthFlow: (url) => api.identity.launchWebAuthFlow({ url, interactive: true }),
});

void start(session, null);
