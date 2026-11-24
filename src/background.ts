// Segundo plano (CV-503, CV-504). El icono abre el panel lateral y le avisa de que debe leer la
// página. Chrome y Edge: side panel. Firefox: sidebar_action.
//
// CV-504: se usa action.onClicked en vez de la opción openPanelOnActionClick del side panel para
// asegurar que pulsar el icono concede activeTab. La apertura es lo primero que se hace y es
// síncrona dentro del gesto (sidePanel.open y sidebarAction.open exigen gesto de la persona).
//
// CV-544: en Firefox el icono ya no abre y cierra la barra lateral: solo la abre, como en Chrome y Edge.
// Así, con el panel abierto, volver a pulsarlo da acceso a la página (activeTab) y la relee, que es lo
// que el panel pide cuando le falta ese permiso. Para cerrar está la ✕ del panel (CV-523).

import { extensionApi } from './browser';
import { ICON_CLICKED } from './messages';

const api = extensionApi();
const scope = globalThis as unknown as { browser?: { sidebarAction?: { open(): Promise<void> } } };

const sidePanel = (api as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
const sidebar = scope.browser?.sidebarAction;

/** Avisa al panel (si ya está abierto) de que se ha vuelto a pulsar el icono: debe releer. */
function notifyPanel(): void {
  // Sin panel escuchando, sendMessage falla: no es un error.
  void Promise.resolve(api.runtime.sendMessage({ type: ICON_CLICKED })).catch(() => undefined);
}

if (sidePanel || sidebar) {
  api.action.onClicked.addListener((tab) => {
    if (sidePanel) {
      void sidePanel.open(tab.id === undefined ? { windowId: tab.windowId } : { tabId: tab.id });
    } else if (sidebar) {
      void sidebar.open();
    }
    notifyPanel();
  });
}
