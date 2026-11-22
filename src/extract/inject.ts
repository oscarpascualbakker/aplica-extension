// Código que se inyecta en la pestaña activa con scripting.executeScript({files}) (CV-504).
// Solo lee el DOM y devuelve un objeto serializable. No envía nada a ningún sitio: sin red,
// sin mensajes y sin APIs de la extensión. Se empaqueta aparte como extract.js.

import { extractOffer } from './extract';

export const result = extractOffer(document, location.hostname, getSelection()?.toString() ?? '');
