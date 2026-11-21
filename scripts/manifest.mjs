// Manifest por destino: una base común MV3 más las diferencias de cada navegador (CV-503).
// Sin host_permissions, content_scripts ni externally_connectable: la página solo se lee con
// activeTab + scripting.executeScript en la pestaña activa, después de que la persona pulse el
// icono (CV-504). La API responde con CORS abierto y sin credenciales.

export const TARGETS = ['chrome', 'edge', 'firefox'];

// Clave pública del build de desarrollo, para que Chrome y Edge den un ID estable a la
// extensión desempaquetada. La clave privada no se guarda (RS: nada de secretos en el repo).
export const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs47DV0Zls1Q565T9PHQdBzgIhkegvfBo2+9rS1U8cHhQ9AyWFo6u+398tiGXKZme2N1hVXG2vz6mvDfT5n1REMIfm2EDfzqeEZiKpUS9WZ0FoAto+Lt2lf+qEskxljSmQb2gCzxkpCGNJ3qqpoHKc1W8P7pPTAznXf7o4q0liHwyPpzeCKcUcPVpxYLIrqtm8JI13FmWmzOmrMe1R004os3PsdmVv7UQLIu7XzPoL1gJuUetfrBeRBSpv2T5p3s2ggJrr9KQhL9DJX/m9cpudyEqkjr7l0sDk5Hb+mqz1PAiYxQempnhHTIeGItrVIVbRCWBsnvSuBqfPktuqbEvxwIDAQAB';

const ICONS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

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
      background: { scripts: ['background.js'] },
      sidebar_action: {
        default_title: '__MSG_panelTitle__',
        default_panel: 'panel.html',
        default_icon: ICONS,
      },
      permissions: ['activeTab', 'scripting', 'storage', 'identity'],
      browser_specific_settings: {
        gecko: {
          id: 'extension@aplica.cv',
          // 142: primera versión con data_collection_permissions también en Android.
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['authenticationInfo'] },
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
  };
}
