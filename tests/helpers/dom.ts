import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

/** Documento de happy-dom con el HTML dado, sin ejecutar scripts ni cargar recursos. */
export function parseHtml(html: string, url = 'https://example.com/'): Document {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
    },
  });
  window.document.write(html);
  return window.document as unknown as Document;
}

export function fixture(name: string): string {
  return readFileSync(`tests/fixtures/${name}.html`, 'utf8');
}

/** El mismo HTML sin ningún bloque JSON-LD: obliga a usar el extractor del portal. */
export function withoutJsonLd(html: string): string {
  return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
}
