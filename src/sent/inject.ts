// Código que se inyecta en la pestaña activa con scripting.executeScript({files}) (CV-508). Solo lee el DOM
// y devuelve la confirmación (o null) como objeto serializable. Sin red, sin mensajes y sin APIs de la
// extensión. Se empaqueta aparte como detect.js. Solo corre con el panel abierto, en uno de los siete ATS
// cuyo permiso de host concedió la persona al rellenar (CV-507), o en la página donde pulsó el icono.

import { detectConfirmation } from './detect';

export const result = detectConfirmation(document, location.href);
