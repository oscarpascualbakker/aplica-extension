// Cerrar el panel en cada navegador (CV-523), con dobles de las API.
import { describe, expect, it, vi } from 'vitest';
import { closePanel } from '../src/panel/close';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('closePanel', () => {
  it('Firefox: cierra la barra lateral en el mismo clic, sin esperar a nada', () => {
    const close = vi.fn(() => Promise.resolve());
    const windowClose = vi.fn();
    closePanel({ browser: { sidebarAction: { close } }, close: windowClose });
    expect(close).toHaveBeenCalledOnce();
    expect(windowClose).not.toHaveBeenCalled();
  });

  it('Firefox: si sidebarAction.close falla, cierra la ventana del panel', async () => {
    const windowClose = vi.fn();
    closePanel({ browser: { sidebarAction: { close: () => Promise.reject(new Error('sin gesto')) } }, close: windowClose });
    await flush();
    expect(windowClose).toHaveBeenCalledOnce();
  });

  it('Chrome y Edge: cierra el panel de la ventana actual con sidePanel.close', async () => {
    const close = vi.fn(() => Promise.resolve());
    const windowClose = vi.fn();
    closePanel({ chrome: { sidePanel: { close }, windows: { getCurrent: () => Promise.resolve({ id: 7 }) } }, close: windowClose });
    await flush();
    expect(close).toHaveBeenCalledWith({ windowId: 7 });
    expect(windowClose).not.toHaveBeenCalled();
  });

  it('Chrome sin sidePanel.close (versiones antiguas): window.close()', () => {
    const windowClose = vi.fn();
    closePanel({ chrome: { sidePanel: {}, windows: { getCurrent: () => Promise.resolve({ id: 7 }) } }, close: windowClose });
    expect(windowClose).toHaveBeenCalledOnce();
  });

  it('Chrome: si sidePanel.close falla o no hay ventana, window.close()', async () => {
    const failing = vi.fn();
    closePanel({
      chrome: { sidePanel: { close: () => Promise.reject(new Error('x')) }, windows: { getCurrent: () => Promise.resolve({ id: 7 }) } },
      close: failing,
    });
    const noWindow = vi.fn();
    closePanel({
      chrome: { sidePanel: { close: () => Promise.resolve() }, windows: { getCurrent: () => Promise.resolve({}) } },
      close: noWindow,
    });
    await flush();
    expect(failing).toHaveBeenCalledOnce();
    expect(noWindow).toHaveBeenCalledOnce();
  });
});
