// Segundo plano (CV-503, CV-504). El icono abre el panel lateral y le avisa de que debe leer la
// página. Chrome y Edge: side panel. Firefox: sidebar_action, que el icono abre y cierra.
//
// CV-504: se usa action.onClicked en vez de la opción openPanelOnActionClick del side panel para
// asegurar que pulsar el icono concede activeTab. La apertura es lo primero que se hace y es
// síncrona dentro del gesto (sidePanel.open y sidebarAction.toggle exigen gesto de la persona).

import { extensionApi } from './browser';
import { ICON_CLICKED } from './messages';

const api = extensionApi();
const scope = globalThis as unknown as { browser?: { sidebarAction?: { toggle(): Promise<void> } } };

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
      void sidebar.toggle();
    }
    notifyPanel();
  });
}
