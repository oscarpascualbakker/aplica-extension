// Todo texto visible sale de i18n.getMessage (CV-503). Punto único de entrada: en CV-504 se
// podrá seguir el `locale` de la cuenta (lo devuelve /me) cambiando solo esta función.

import { extensionApi } from './browser';

export function t(key: string, substitutions?: string | string[]): string {
  return extensionApi().i18n.getMessage(key, substitutions) || key;
}
