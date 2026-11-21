// Cerrar el panel desde dentro (CV-523). En Chrome y Edge el icono abre el panel y, si ya está
// abierto, relee la página (CV-504), así que sin este botón no había forma clara de cerrarlo.
//
// - Firefox: sidebarAction.close(). Exige gesto de la persona: se llama sin esperar a nada, en
//   el mismo clic.
// - Chrome y Edge: sidePanel.close({ windowId }) donde exista. El panel es el global
//   (default_path), así que se cierra por ventana. Si no existe o falla, window.close() desde el
//   propio panel.
// Sin permisos nuevos: ni sidebarAction, ni sidePanel, ni windows.getCurrent los piden aparte.

type Scope = {
  browser?: { sidebarAction?: { close(): Promise<void> } };
  chrome?: {
    sidePanel?: { close?: (options: { windowId: number }) => Promise<void> };
    windows?: { getCurrent(): Promise<{ id?: number }> };
  };
  close(): void;
};

export function closePanel(scope: Scope = globalThis as unknown as Scope): void {
  const sidebar = scope.browser?.sidebarAction;
  if (sidebar) {
    void sidebar.close().catch(() => {
      scope.close();
    });
    return;
  }

  const sidePanel = scope.chrome?.sidePanel;
  const windows = scope.chrome?.windows;
  if (!sidePanel?.close || !windows) {
    scope.close();
    return;
  }
  const close = sidePanel.close.bind(sidePanel);
  void windows
    .getCurrent()
    .then((current) => {
      if (current.id === undefined) throw new Error('Sin ventana');
      return close({ windowId: current.id });
    })
    .catch(() => {
      scope.close();
    });
}
