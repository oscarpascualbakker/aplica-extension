// Herramienta SOLO del build de desarrollo (CV-504): guarda la página de la pestaña activa
// en un .html para convertirla en fixture. No existe en el bundle de producción (se elimina
// por la constante __DEV_BUILD__) y no usa el permiso `downloads`: Blob + <a download>.

import { extensionApi } from '../browser';
import { t } from '../i18n';

function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  return extensionApi()
    .tabs.query({ active: true, currentWindow: true })
    .then((tabs) => tabs[0]);
}

/**
 * El HTML de la página con el contenido de sus shadow roots abiertos (CV-543). SmartRecruiters y
 * otros ATS dibujan el formulario dentro de web components: con `outerHTML` los campos no salían.
 * Cada shadow root abierto va como `<template shadowrootmode="open">` dentro de su elemento.
 * Se ejecuta en la pestaña con `executeScript`, así que no puede usar nada de fuera de la función.
 */
export function serializePage(): string {
  const root = document.documentElement;
  const roots: ShadowRoot[] = [];
  const walk = (node: Document | ShadowRoot): void => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        walk(el.shadowRoot);
      }
    }
  };
  walk(document);
  const withShadow = root as HTMLElement & {
    getHTML?: (options: { serializableShadowRoots?: boolean; shadowRoots?: ShadowRoot[] }) => string;
  };
  if (roots.length === 0 || typeof withShadow.getHTML !== 'function') return root.outerHTML;
  const outer = root.outerHTML;
  const openTag = outer.slice(0, outer.indexOf('>') + 1);
  return `${openTag}${withShadow.getHTML({ shadowRoots: roots })}</html>`;
}

async function exportPage(report: (text: string) => void): Promise<void> {
  try {
    const tab = await currentTab();
    if (tab?.id === undefined || tab.url === undefined) {
      // CV-544: sin acceso a la pestaña (se ha cambiado de página desde que se pulsó el icono), se dice qué
      // hacer con el panel ya abierto y por qué, en lugar del aviso de leer la oferta.
      report(t('devExportNoAccess'));
      return;
    }
    const [injected] = await extensionApi().scripting.executeScript({
      target: { tabId: tab.id },
      func: serializePage,
    });
    const html = `<!-- aplica-export-url: ${tab.url.replace(/--/g, '-%2D')} -->\n${injected?.result ?? ''}`;
    const link = document.createElement('a');
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    link.href = blobUrl;
    link.download = `aplica-export-${new URL(tab.url).hostname}-${String(Date.now())}.html`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 10_000);
    report(t('devExportDone'));
  } catch {
    report(t('devExportError'));
  }
}

/** Sección con el botón y el aviso de que el fichero lleva datos personales. */
export function devExportSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'dev-tools';
  const warning = document.createElement('p');
  warning.className = 'notice';
  warning.textContent = t('devExportWarning');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = t('devExportButton');
  const result = document.createElement('p');
  result.setAttribute('role', 'status');
  button.addEventListener('click', () => {
    void exportPage((text) => {
      result.textContent = text;
    });
  });
  section.append(warning, button, result);
  return section;
}
