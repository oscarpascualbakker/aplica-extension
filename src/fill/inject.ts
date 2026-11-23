// Código que se inyecta en la pestaña activa con scripting.executeScript({files}) (CV-507). Solo
// deja dos funciones en el mundo aislado del script; el panel las llama después con `func` y los
// datos como argumentos. No hay content scripts declarados: esto solo corre cuando la persona pulsa
// "Rellenar este formulario". Sin red, sin mensajes y sin APIs de la extensión.

import { fillForm, scanForm } from './fill';
import type { AtsKey, FillRequest } from './types';

export const FILL_GLOBAL = '__aplicaFill';

type Api = { scan(ats: AtsKey | null): unknown; fill(request: FillRequest): unknown };

(globalThis as unknown as Record<string, Api>)[FILL_GLOBAL] = {
  scan: (ats) => scanForm(document, ats),
  fill: (request) => fillForm(document, request),
};
