// El `locale` de la cuenta vive en storage.local (CV-504), junto al token pero en otra clave.
// Es lo único del perfil que se guarda y se borra al desconectar.

import { extensionApi } from './browser';
import { isLocale, type Locale } from './i18n';

const KEY = 'aplica.locale';

export type LocaleStore = {
  get(): Promise<Locale | null>;
  set(locale: Locale): Promise<void>;
  clear(): Promise<void>;
};

export function createLocaleStore(area: chrome.storage.LocalStorageArea = extensionApi().storage.local): LocaleStore {
  return {
    async get() {
      const stored = await area.get(KEY);
      const value: unknown = stored[KEY];
      return isLocale(value) ? value : null;
    },
    async set(locale) {
      await area.set({ [KEY]: locale });
    },
    async clear() {
      await area.remove(KEY);
    },
  };
}
