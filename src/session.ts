// Emparejamiento y sesión de la extensión con la cuenta de Aplica (CV-503).
// Flujo: PKCE S256 + state, launchWebAuthFlow, canje del código en /api/ext/v1/token.
// Las dependencias entran por parámetro para poder probarlo sin navegador.

import type { ApiClient, MeResponse } from './api';
import type { BrowserName } from './browser';
import { codeChallenge, randomToken } from './pkce';
import type { TokenStore } from './token-store';

export type SessionDeps = {
  api: ApiClient;
  tokenStore: TokenStore;
  apiBase: string;
  browser: BrowserName;
  /** identity.getRedirectURL() */
  redirectUrl: string;
  /** identity.launchWebAuthFlow({ url, interactive: true }): devuelve la URL de vuelta. */
  launchWebAuthFlow(url: string): Promise<string | undefined>;
};

export type FailureReason =
  | 'cancelled'
  | 'denied'
  | 'invalid'
  | 'network'
  | 'rate_limited'
  | 'server';

export type ConnectOutcome = { status: 'connected' } | { status: 'failed'; reason: FailureReason };

export type RefreshOutcome =
  | { status: 'disconnected' }
  | { status: 'connected'; me: MeResponse }
  /** La API ha dicho 401: el token local ya está borrado. */
  | { status: 'revoked' }
  | { status: 'error'; reason: 'network' | 'rate_limited' | 'server' };

export type DisconnectOutcome =
  | { status: 'disconnected' }
  | { status: 'error'; reason: 'network' | 'rate_limited' | 'server' };

export type Session = {
  connect(): Promise<ConnectOutcome>;
  refresh(): Promise<RefreshOutcome>;
  disconnect(): Promise<DisconnectOutcome>;
};

export function createSession(deps: SessionDeps): Session {
  const { api, tokenStore } = deps;

  return {
    async connect() {
      const state = randomToken();
      const verifier = randomToken();
      const challenge = await codeChallenge(verifier);

      const url = new URL(`${deps.apiBase}/app/extension/conectar`);
      url.searchParams.set('redirect_uri', deps.redirectUrl);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('browser', deps.browser);

      let returned: string | undefined;
      try {
        returned = await deps.launchWebAuthFlow(url.toString());
      } catch {
        return { status: 'failed', reason: 'cancelled' };
      }
      if (!returned) return { status: 'failed', reason: 'cancelled' };

      let params: URLSearchParams;
      try {
        params = new URL(returned).searchParams;
      } catch {
        return { status: 'failed', reason: 'invalid' };
      }

      // El state debe coincidir exactamente; si no, se aborta sin mirar nada más.
      if (params.get('state') !== state) return { status: 'failed', reason: 'invalid' };

      const error = params.get('error');
      if (error === 'access_denied') return { status: 'failed', reason: 'denied' };
      if (error) return { status: 'failed', reason: 'invalid' };

      const code = params.get('code');
      if (!code) return { status: 'failed', reason: 'invalid' };

      const result = await api.exchangeToken({
        code,
        code_verifier: verifier,
        redirect_uri: deps.redirectUrl,
      });
      if (!result.ok) {
        switch (result.kind) {
          case 'network':
          case 'rate_limited':
          case 'server':
            return { status: 'failed', reason: result.kind };
          default:
            return { status: 'failed', reason: 'invalid' };
        }
      }
      await tokenStore.set(result.data.token);
      return { status: 'connected' };
    },

    async refresh() {
      const token = await tokenStore.get();
      if (!token) return { status: 'disconnected' };
      const result = await api.getMe(token);
      if (result.ok) return { status: 'connected', me: result.data };
      switch (result.kind) {
        case 'unauthenticated':
          await tokenStore.clear();
          return { status: 'revoked' };
        case 'network':
        case 'rate_limited':
          return { status: 'error', reason: result.kind };
        default:
          return { status: 'error', reason: 'server' };
      }
    },

    async disconnect() {
      const token = await tokenStore.get();
      if (!token) return { status: 'disconnected' };
      const result = await api.revokeToken(token);
      // 204 o 401 (ya revocado): fuera el token local. Con red o 429 se conserva, para
      // no dejar un token vivo en el servidor sin que la persona lo sepa.
      if (result.ok || result.kind === 'unauthenticated') {
        await tokenStore.clear();
        return { status: 'disconnected' };
      }
      return {
        status: 'error',
        reason: result.kind === 'network' || result.kind === 'rate_limited' ? result.kind : 'server',
      };
    },
  };
}
