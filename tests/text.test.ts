import { describe, expect, it } from 'vitest';
import { clip, htmlToText, inlineText } from '../src/extract/text';
import { parseHtml } from './helpers/dom';

const doc = parseHtml('<html><body></body></html>');
const text = (html: string): string => htmlToText(doc, html);

describe('htmlToText', () => {
  it('párrafos separados por una línea en blanco', () => {
    expect(text('<p>Uno</p><p>Dos</p>')).toBe('Uno\n\nDos');
  });

  it('viñetas, también con párrafos dentro', () => {
    expect(text('<ul><li>Uno</li><li><p>Dos</p></li></ul>')).toBe('- Uno\n- Dos');
  });

  it('listas numeradas se tratan como viñetas y las vacías se descartan', () => {
    expect(text('<ol><li>Uno</li><li> </li><li>Tres</li></ol>')).toBe('- Uno\n- Tres');
  });

  it('br, div y títulos', () => {
    expect(text('<h2>Título</h2><div>a<br>b</div><div>c</div>')).toBe('Título\n\na\nb\nc');
  });

  it('decodifica entidades, incluidas las numéricas y &nbsp;', () => {
    expect(text('<p>Ficticia &amp; Co &lt;3 &#233; &nbsp;fin</p>')).toBe('Ficticia & Co <3 é fin');
  });

  it('no deja pasar scripts, estilos ni etiquetas', () => {
    const out = text('<p>Hola <b>mundo</b></p><script>alert(1)</script><style>p{color:red}</style>');
    expect(out).toBe('Hola mundo');
  });

  it('texto plano sin HTML se conserva, con sus saltos de línea', () => {
    expect(text('Primera línea\n\n\n\nSegunda   línea')).toBe('Primera línea\n\nSegunda línea');
  });

  it('el HTML no ejecuta nada ni carga imágenes al analizarse', () => {
    (globalThis as { __ejecutado?: boolean }).__ejecutado = false;
    text('<img src=x onerror="globalThis.__ejecutado=true">');
    expect((globalThis as { __ejecutado?: boolean }).__ejecutado).toBe(false);
  });
});

describe('inlineText y clip', () => {
  it('inlineText une espacios y saltos', () => {
    expect(inlineText('  a \n  b  ')).toBe('a b');
    expect(inlineText(null)).toBe('');
  });

  it('clip no parte un emoji por la mitad', () => {
    expect(clip('ab😀cd', 3)).toBe('ab');
    expect(clip('ab😀cd', 4)).toBe('ab😀');
    expect(clip('abc', 10)).toBe('abc');
  });
});
