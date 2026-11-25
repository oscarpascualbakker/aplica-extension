// @vitest-environment happy-dom
// CV-543: el exportador del build de desarrollo guarda también los shadow roots abiertos, donde
// SmartRecruiters y otros ATS dibujan los campos del formulario.
import { afterEach, describe, expect, it } from 'vitest';
import { serializePage } from '../src/panel/dev-export';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('serializePage', () => {
  it('incluye los campos que están dentro de shadow roots abiertos, también anidados', () => {
    const host = document.createElement('oc-form');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label for="first">Nombre</label><input id="first" name="firstName">';
    const field = document.createElement('spl-input');
    shadow.append(field);
    const inner = field.attachShadow({ mode: 'open' });
    inner.innerHTML = '<input name="email" type="email">';
    document.body.append(host);

    const html = serializePage();
    expect(html).toMatch(/^<html[^>]*>/);
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="email"');
  });

  it('sin shadow roots es el outerHTML de siempre', () => {
    document.body.innerHTML = '<p>Oferta</p>';
    expect(serializePage()).toBe(document.documentElement.outerHTML);
  });
});
