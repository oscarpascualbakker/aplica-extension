// Segundo plano (CV-503). Solo configura que el icono abra el panel lateral.
// Chrome y Edge: side panel. Firefox: sidebar_action, que el icono abre y cierra.

import { extensionApi } from './browser';

const api = extensionApi();
const scope = globalThis as unknown as { browser?: { sidebarAction?: { toggle(): Promise<void> } } };

const sidePanel = (api as { sidePanel?: typeof chrome.sidePanel }).sidePanel;

if (sidePanel) {
  void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} else if (scope.browser?.sidebarAction) {
  const sidebar = scope.browser.sidebarAction;
  api.action.onClicked.addListener(() => {
    void sidebar.toggle();
  });
}
