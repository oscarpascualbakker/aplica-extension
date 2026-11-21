// El token solo vive en storage.local (CV-503): nunca en sync, nunca en logs.
// No se guarda ningún dato del perfil.

import { extensionApi } from './browser';

const KEY = 'aplica.token';

export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

export function createTokenStore(area: chrome.storage.LocalStorageArea = extensionApi().storage.local): TokenStore {
  return {
    async get() {
      const stored = await area.get(KEY);
      const value: unknown = stored[KEY];
      return typeof value === 'string' && value !== '' ? value : null;
    },
    async set(token) {
      await area.set({ [KEY]: token });
    },
    async clear() {
      await area.remove(KEY);
    },
  };
}
