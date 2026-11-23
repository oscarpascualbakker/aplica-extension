// HTML a texto plano para las descripciones de oferta (CV-504). Sin ejecutar nada de la
// página: el HTML se analiza en un documento inerte (createHTMLDocument), que no carga
// recursos ni ejecuta scripts, y las entidades las decodifica el propio analizador.

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe']);
/** Bloques con línea en blanco alrededor. */
const PARAGRAPH = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'table', 'pre']);
/** Bloques con salto de línea simple. */
const BLOCK = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'li', 'tr', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'address',
]);

// Marcas internas mientras se recorre el árbol; tidy() las convierte en saltos y viñetas. Son
// caracteres de control (\u0001 a \u0003) que no aparecen en el texto de una página; por eso
// las expresiones de tidy() los usan a propósito.
const SOFT = '\u0002';
const PARA = '\u0003';
const BULLET = '\u0001';

function walk(node: Node, out: string[], inPre: boolean): void {
  if (node.nodeType === 3) {
    const data = (node.nodeValue ?? '').replace(/\u00a0/g, ' ');
    out.push(inPre ? data : data.replace(/\s+/g, ' '));
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return;
  if (tag === 'br') {
    out.push('\n');
    return;
  }
  const paragraph = PARAGRAPH.has(tag);
  const block = paragraph || BLOCK.has(tag);
  const mark = paragraph ? PARA : SOFT;
  if (block) out.push(mark);
  if (tag === 'li') out.push(BULLET);
  const pre = inPre || tag === 'pre';
  for (const child of Array.from(el.childNodes)) walk(child, out, pre);
  if (block) out.push(mark);
}

/**
 * Normaliza el resultado: cada tramo de espacios y saltos pasa a un espacio, un salto o una línea
 * en blanco (nunca más de una); las viñetas vacías desaparecen.
 */
/* eslint-disable no-control-regex -- las marcas internas son caracteres de control a propósito */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\n\u0002\u0003]+/g, (run) => {
      if (run.includes(PARA)) return '\n\n';
      const hard = run.split('\n').length - 1;
      const lines = Math.max(hard, run.includes(SOFT) ? 1 : 0);
      return lines === 0 ? ' ' : '\n'.repeat(Math.min(lines, 2));
    })
    .replace(/\u0001[ \n]*(?=\u0001|$)/g, '')
    .replace(/\u0001[ \n]*/g, '- ')
    .trim();
}
/* eslint-enable no-control-regex */

/** Texto plano de un elemento de la página (o de un fragmento ya analizado). */
export function elementToText(el: Node): string {
  const out: string[] = [];
  walk(el, out, false);
  return tidy(out.join(''));
}

/** Texto plano de un trozo de HTML (por ejemplo, la `description` de un JSON-LD). */
export function htmlToText(doc: Document, html: string): string {
  if (!/[<&]/.test(html)) return tidy(html);
  const inert = doc.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  return elementToText(inert.body);
}

/** Texto corrido de una sola línea (títulos, empresa, ubicación). */
export function inlineText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Recorta sin partir un par sustituto (emoji) por la mitad. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
