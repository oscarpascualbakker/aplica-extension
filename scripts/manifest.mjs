// Manifest por destino: una base común MV3 más las diferencias de cada navegador (CV-503).
// Sin host_permissions, content_scripts ni externally_connectable: la página solo se lee con
// activeTab + scripting.executeScript en la pestaña activa, después de que la persona pulse el
// icono (CV-504). La API responde con CORS abierto y sin credenciales.
//
// CV-507: el autorrelleno de formularios pide, solo cuando la persona lo activa en el panel
// (permissions.request), permiso de host para los dominios de siete ATS. Nunca al instalar. Son
// opcionales: sin ellos solo queda copiar los datos desde el panel.

export const TARGETS = ['chrome', 'edge', 'firefox'];

// Clave pública del build de desarrollo, para que Chrome y Edge den un ID estable a la
// extensión desempaquetada. La clave privada no se guarda (RS: nada de secretos en el repo).
export const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs47DV0Zls1Q565T9PHQdBzgIhkegvfBo2+9rS1U8cHhQ9AyWFo6u+398tiGXKZme2N1hVXG2vz6mvDfT5n1REMIfm2EDfzqeEZiKpUS9WZ0FoAto+Lt2lf+qEskxljSmQb2gCzxkpCGNJ3qqpoHKc1W8P7pPTAznXf7o4q0liHwyPpzeCKcUcPVpxYLIrqtm8JI13FmWmzOmrMe1R004os3PsdmVv7UQLIu7XzPoL1gJuUetfrBeRBSpv2T5p3s2ggJrr9KQhL9DJX/m9cpudyEqkjr7l0sDk5Hb+mqz1PAiYxQempnhHTIeGItrVIVbRCWBsnvSuBqfPktuqbEvxwIDAQAB';

// Dominios de formulario de los siete ATS (CV-507). Los mismos patrones que src/fill/ats.ts: un test
// comprueba que no se desvían.
export const ATS_HOST_PATTERNS = [
  '*://*.myworkdayjobs.com/*',
  '*://*.myworkdaysite.com/*',
  '*://boards.greenhouse.io/*',
  '*://job-boards.greenhouse.io/*',
  '*://job-boards.eu.greenhouse.io/*',
  '*://jobs.lever.co/*',
  '*://jobs.eu.lever.co/*',
  '*://jobs.smartrecruiters.com/*',
  '*://apply.workable.com/*',
  '*://*.teamtailor.com/*',
  '*://*.jobs.personio.de/*',
  '*://*.jobs.personio.com/*',
];

const ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

// Iconos de la barra (CV-544): 16, 32 y 48 son el isotipo sin margen (scripts/make-icons.mjs); 128 es el de
// la tienda, con su margen. En Firefox, con un tema oscuro, va el isotipo en negativo (`light` es el icono
// para barras oscuras).
const THEME_ICONS = [16, 32].map((size) => ({
  light: `icons/icon-${size}-negativo.png`,
  dark: `icons/icon-${size}.png`,
  size,
}));

function base(version) {
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version,
    default_locale: 'en',
    icons: ICONS,
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: ICONS,
    },
  };
}

/**
 * @param {'chrome' | 'edge' | 'firefox'} target
 * @param {{ version: string, dev?: boolean }} options
 */
export function buildManifest(target, { version, dev = false }) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Destino desconocido: ${target}`);
  }
  const manifest = base(version);

  if (target === 'firefox') {
    return {
      ...manifest,
      action: { ...manifest.action, theme_icons: THEME_ICONS },
      background: { scripts: ['background.js'] },
      sidebar_action: {
        default_title: '__MSG_panelTitle__',
        default_panel: 'panel.html',
        default_icon: ICONS,
      },
      permissions: ['activeTab', 'scripting', 'storage', 'identity'],
      // Firefox MV3 admite los permisos de host opcionales en `optional_permissions` (CV-507).
      optional_permissions: ATS_HOST_PATTERNS,
      browser_specific_settings: {
        gecko: {
          id: 'extension@aplica.cv',
          // 142: primera versión con data_collection_permissions también en Android.
          strict_min_version: '142.0',
          // CV-504: además del token (authenticationInfo), envía a Aplica el contenido de la oferta
          // (websiteContent) y su enlace (browsingActivity), siempre después de que la persona pulse.
          data_collection_permissions: { required: ['authenticationInfo', 'websiteContent', 'browsingActivity'] },
        },
      },
    };
  }

  // Chrome y Edge comparten manifest (mismo motor).
  return {
    ...manifest,
    ...(dev ? { key: DEV_PUBLIC_KEY } : {}),
    background: { service_worker: 'background.js', type: 'module' },
    side_panel: { default_path: 'panel.html' },
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'identity'],
    optional_host_permissions: ATS_HOST_PATTERNS,
  };
}
