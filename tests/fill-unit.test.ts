// Piezas del rellenado (CV-507): emparejamiento de preguntas, campos con valor, setter nativo,
// formatos del CV, dominios de los ATS y casos sueltos de detección.
import { describe, expect, it } from 'vitest';
import { acceptsFile, chooseFormat } from '../src/fill/accept';
import { ATS_ORIGINS, atsFromUrl } from '../src/fill/ats';
import { fillForm, scanForm, splitName } from '../src/fill/fill';
import { similarity } from '../src/fill/text';
import { ATS_HOST_PATTERNS } from '../scripts/manifest.mjs';
import { ANSWER_EN, CV, formDocument, PROFILE, request } from './helpers/fill';

const page = (body: string): Document => formDocument(`<html><body><form>${body}</form></body></html>`, 'https://jobs.lever.co/x/1');
const input = (doc: Document, selector: string): HTMLInputElement => doc.querySelector(selector) as HTMLInputElement;

describe('emparejamiento de preguntas abiertas', () => {
  it('reconoce la misma pregunta con otra redacción, mayúsculas, tildes y signos distintos', () => {
    expect(similarity('Why do you want to work at Empresa Ficticia S.L.?', 'why do you want to work at empresa ficticia s.l.')).toBeGreaterThanOrEqual(0.9);
    expect(similarity('¿Por qué quieres trabajar en Empresa Ficticia S.L.? *', 'Por que quieres trabajar en Empresa Ficticia S.L. (obligatorio)')).toBeGreaterThanOrEqual(0.9);
    expect(similarity('Why do you want to work with us at Empresa Ficticia?', 'Why do you want to work at Empresa Ficticia S.L.?')).toBeGreaterThanOrEqual(0.6);
  });

  it('no empareja preguntas distintas ni con una sola palabra en común', () => {
    expect(similarity('Describe a project you are proud of', 'Why do you want to work at Empresa Ficticia S.L.?')).toBeLessThan(0.6);
    expect(similarity('Website', 'Personal website of the company')).toBeLessThan(0.6);
    expect(similarity('', 'Why do you want to work here')).toBe(0);
  });

  it('solo rellena con una buena coincidencia y cuenta las demás como sin respuesta', () => {
    const doc = page(
      '<label for="a">Why do you want to work at Empresa Ficticia S.L.?</label><textarea id="a"></textarea>' +
        '<label for="b">Describe a project you are proud of and what you learned</label><textarea id="b"></textarea>',
    );
    const summary = fillForm(doc, request('lever'));
    expect(input(doc, '#a').value).toBe(ANSWER_EN);
    expect(input(doc, '#b').value).toBe('');
    expect(summary).toMatchObject({ questionsFilled: 1, questionsUnanswered: 1 });
  });

  it('una pregunta contesta_tu no se rellena: se marca para que la conteste la persona', () => {
    const doc = page('<label for="a">Are you legally authorized to work in Spain?</label><textarea id="a"></textarea>');
    // La etiqueta es sensible: se marca igual, pero por la lista y no por la respuesta.
    const summary = fillForm(doc, request('lever'));
    expect(input(doc, '#a').value).toBe('');
    expect(input(doc, '#a').hasAttribute('data-aplica-ask-you')).toBe(true);
    expect(summary.askYou).toBe(1);

    const other = page('<label for="a">Tell us what makes your approach to testing different</label><textarea id="a"></textarea>');
    const answers = [{ question: 'Tell us what makes your approach to testing different', answer: null, type: 'contesta_tu' as const }];
    expect(fillForm(other, request('lever', { answers })).askYou).toBe(1);
    expect(input(other, '#a').value).toBe('');
  });

  it('no usa una respuesta de tipo redactar sin texto', () => {
    const doc = page('<label for="a">Why do you want to work at Empresa Ficticia S.L.?</label><textarea id="a"></textarea>');
    const answers = [{ question: 'Why do you want to work at Empresa Ficticia S.L.?', answer: null, type: 'redactar' as const }];
    fillForm(doc, request('lever', { answers }));
    expect(input(doc, '#a').value).toBe('');
  });

  it('respeta el límite de caracteres del campo', () => {
    const doc = page('<label for="a">Why do you want to work at Empresa Ficticia S.L.?</label><textarea id="a" maxlength="20"></textarea>');
    expect(fillForm(doc, request('lever')).questionsUnanswered).toBe(1);
    expect(input(doc, '#a').value).toBe('');
  });
});

describe('campos que ya tienen valor', () => {
  it('no se sobrescriben: se resaltan como "ya tenía valor"', () => {
    const doc = page('<label for="a">First name</label><input id="a" type="text" value="Marta"/><label for="b">Last name</label><input id="b" type="text"/>');
    const summary = fillForm(doc, request('lever'));
    expect(input(doc, '#a').value).toBe('Marta');
    expect(input(doc, '#a').hasAttribute('data-aplica-had-value')).toBe(true);
    expect(input(doc, '#a').hasAttribute('data-aplica-filled')).toBe(false);
    expect(input(doc, '#b').value).toBe('Ejemplo Prueba');
    expect(summary).toMatchObject({ hadValue: 1, filled: ['lastName'] });
  });

  it('un campo de archivo que ya tiene fichero tampoco se toca', () => {
    const doc = page('<label for="f">Resume</label><input id="f" type="file"/>');
    const file = input(doc, '#f');
    const seed = new (doc.defaultView as unknown as { DataTransfer: new () => DataTransfer; File: typeof File }).DataTransfer();
    seed.items.add(new (doc.defaultView as unknown as { File: typeof File }).File(['x'], 'otro.pdf'));
    file.files = seed.files;
    const summary = fillForm(doc, request('lever'));
    expect(file.files[0]?.name).toBe('otro.pdf');
    expect(summary.attachment).toBe('had_file');
  });
});

describe('escritura del valor', () => {
  it('usa el setter nativo del prototipo (React y Vue) y lanza input, change y blur', () => {
    const doc = page('<label for="a">Email</label><input id="a" type="text"/>');
    const field = input(doc, '#a');
    // React sustituye `value` en la instancia para vigilar los cambios: no debe pasar por ahí.
    const writes: string[] = [];
    let current = '';
    const proto = Object.getPrototypeOf(field) as object;
    const native = Object.getOwnPropertyDescriptor(proto, 'value') as PropertyDescriptor;
    Object.defineProperty(field, 'value', {
      configurable: true,
      get: () => native.get?.call(field) as string,
      set: (value: string) => {
        writes.push(value);
        current = value;
      },
    });
    const events: string[] = [];
    for (const name of ['input', 'change', 'blur']) field.addEventListener(name, () => events.push(name));
    fillForm(doc, request('lever'));
    expect(writes).toEqual([]);
    expect(current).toBe('');
    expect(field.value).toBe('ana@example.com');
    expect(events).toEqual(['input', 'change', 'blur']);
  });
});

describe('detección de campos', () => {
  it('"Nombre" a secas es el nombre completo si no hay apellidos aparte, y el nombre de pila si los hay', () => {
    const alone = page('<label for="a">Nombre</label><input id="a" type="text"/>');
    fillForm(alone, request(null));
    expect(input(alone, '#a').value).toBe('Ana Ejemplo Prueba');

    const split = page('<label for="a">Nombre</label><input id="a" type="text"/><label for="b">Apellidos</label><input id="b" type="text"/>');
    fillForm(split, request(null));
    expect(input(split, '#a').value).toBe('Ana');
    expect(input(split, '#b').value).toBe('Ejemplo Prueba');
  });

  it('separa el nombre: la primera palabra es el nombre y el resto los apellidos', () => {
    expect(splitName('Ana')).toEqual({ first: 'Ana', last: '' });
    expect(splitName('  Ana  María  Ejemplo Prueba ')).toEqual({ first: 'Ana', last: 'María Ejemplo Prueba' });
    expect(splitName('')).toEqual({ first: '', last: '' });
  });

  it('un solo nombre no rellena los apellidos', () => {
    const doc = page('<label for="a">First name</label><input id="a" type="text"/><label for="b">Last name</label><input id="b" type="text"/>');
    fillForm(doc, request(null, { profile: { ...PROFILE, name: 'Ana' } }));
    expect(input(doc, '#a').value).toBe('Ana');
    expect(input(doc, '#b').value).toBe('');
  });

  it('reconoce el campo por aria-label, aria-labelledby, placeholder y autocomplete', () => {
    const doc = page(
      '<input id="a" type="text" aria-label="Email address"/>' +
        '<span id="l">Phone number</span><input id="b" type="text" aria-labelledby="l"/>' +
        '<input id="c" type="text" placeholder="LinkedIn URL"/>' +
        '<input id="d" type="text" autocomplete="given-name"/>',
    );
    fillForm(doc, request(null));
    expect(input(doc, '#a').value).toBe('ana@example.com');
    expect(input(doc, '#b').value).toBe(PROFILE.phone);
    expect(input(doc, '#c').value).toBe(PROFILE.linkedin);
    expect(input(doc, '#d').value).toBe('Ana');
  });

  it('"Current salary" no es el puesto actual y "Country of citizenship" no es la ubicación', () => {
    const doc = page(
      '<label for="a">Current salary</label><input id="a" type="text" name="current_role"/>' +
        '<label for="b">Country of citizenship</label><input id="b" type="text" name="location"/>' +
        '<label for="c">Current role</label><input id="c" type="text"/>',
    );
    fillForm(doc, request(null));
    expect(input(doc, '#a').value).toBe('');
    expect(input(doc, '#b').value).toBe('');
    expect(input(doc, '#c').value).toBe('Desarrolladora backend');
  });

  it('no rellena selects, radios, casillas ni desplegables de búsqueda', () => {
    const doc = page(
      '<label for="a">City</label><select id="a"><option value="">-</option><option>Villanueva del Ejemplo</option></select>' +
        '<fieldset><legend>Preferred contact</legend><label><input type="radio" name="r" value="1"/> Email</label><label><input type="radio" name="r" value="2"/> Phone</label></fieldset>' +
        '<label><input type="checkbox" id="k"/> Email me job alerts</label>' +
        '<label for="e">Email</label><input id="e" type="text" role="combobox"/>',
    );
    const summary = fillForm(doc, request(null));
    expect((doc.querySelector('#a') as HTMLSelectElement).value).toBe('');
    expect(doc.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0);
    expect((doc.querySelector('#k') as HTMLInputElement).checked).toBe(false);
    expect(input(doc, '#e').value).toBe('');
    expect(summary.filled).toEqual([]);
  });

  it('la ciudad lleva solo la ciudad y la ubicación el texto completo', () => {
    const doc = page('<label for="a">City</label><input id="a" type="text"/><label for="b">Current location</label><input id="b" type="text"/><label for="c">Postal code</label><input id="c" type="text"/>');
    fillForm(doc, request(null));
    expect(input(doc, '#a').value).toBe('Villanueva del Ejemplo');
    expect(input(doc, '#b').value).toBe('Villanueva del Ejemplo, Provincia Ficticia');
    expect(input(doc, '#c').value).toBe('');
  });

  it('el sitio web no es LinkedIn ni GitHub, y los años de experiencia van como número', () => {
    const doc = page('<label for="a">Years of experience</label><input id="a" type="number"/><label for="b">Website</label><input id="b" type="text"/>');
    fillForm(doc, request(null));
    expect(input(doc, '#a').value).toBe('6');
    expect(input(doc, '#b').value).toBe('https://ana-ejemplo.example');
  });

  it('sin dato en el perfil no se rellena ni se inventa nada', () => {
    const doc = page('<label for="a">Phone</label><input id="a" type="text"/>');
    const summary = fillForm(doc, request(null, { profile: { ...PROFILE, phone: null } }));
    expect(input(doc, '#a').value).toBe('');
    expect(summary.filled).toEqual([]);
  });

  it('recorre los shadow roots abiertos (componentes web)', () => {
    const doc = page('<div id="host"></div>');
    const host = doc.querySelector('#host') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="n">First name</label><input id="n" type="text"/>';
    fillForm(doc, request(null));
    expect((root.querySelector('#n') as HTMLInputElement).value).toBe('Ana');
  });

  it('ignora los campos ocultos, desactivados y de solo lectura', () => {
    const doc = page(
      '<input type="hidden" name="email" value=""/><label for="a">Email</label><input id="a" type="text" disabled=""/>' +
        '<div hidden=""><label for="b">Phone</label><input id="b" type="text"/></div>',
    );
    expect(fillForm(doc, request(null)).filled).toEqual([]);
  });
});

describe('el CV', () => {
  it('no se adjunta si el campo no admite su formato, y se dice', () => {
    const doc = page('<label for="f">Resume</label><input id="f" type="file" accept=".pdf"/>');
    expect(fillForm(doc, request('lever')).attachment).toBe('not_accepted');
    expect(input(doc, '#f').files).toHaveLength(0);
  });

  it('un PDF se adjunta si el campo solo admite PDF', () => {
    const doc = page('<label for="f">Resume</label><input id="f" type="file" accept="application/pdf"/>');
    const pdf = { name: 'CV.pdf', type: 'application/pdf', base64: CV.base64 };
    expect(fillForm(doc, request('lever', { cv: pdf })).attachment).toBe('attached');
    expect(input(doc, '#f').files?.[0]?.name).toBe('CV.pdf');
  });

  it('sin campo de archivo lo dice, y la carta o la foto no cuentan como campo del CV', () => {
    expect(fillForm(page('<label for="a">Email</label><input id="a" type="text"/>'), request(null)).attachment).toBe('no_input');
    const doc = page('<label for="c">Cover letter</label><input id="c" type="file"/><label for="p">Photo</label><input id="p" type="file"/>');
    expect(fillForm(doc, request(null)).attachment).toBe('no_input');
    expect(scanForm(doc, null)).toEqual({ hasFileInput: false, accept: '' });
  });

  it('con varios campos de archivo elige el del CV por su etiqueta', () => {
    const doc = page('<label for="c">Cover letter</label><input id="c" type="file"/><label for="r">Upload your CV</label><input id="r" type="file" accept=".docx"/>');
    expect(scanForm(doc, null)).toEqual({ hasFileInput: true, accept: '.docx' });
    expect(fillForm(doc, request(null)).attachment).toBe('attached');
    expect(input(doc, '#r').files).toHaveLength(1);
    expect(input(doc, '#c').files).toHaveLength(0);
  });

  it('acepta por extensión, tipo y comodín, y elige Word o PDF según el campo', () => {
    const docx = { name: 'a.DOCX', type: CV.type };
    expect(acceptsFile('', docx)).toBe(true);
    expect(acceptsFile('.pdf, .docx', docx)).toBe(true);
    expect(acceptsFile('application/pdf', docx)).toBe(false);
    expect(acceptsFile('application/*', docx)).toBe(true);
    expect(chooseFormat('', { docx: true, pdf: true })).toBe('docx');
    expect(chooseFormat('.pdf', { docx: true, pdf: true })).toBe('pdf');
    expect(chooseFormat('.pdf', { docx: true, pdf: false })).toBeNull();
    expect(chooseFormat('image/*', { docx: true, pdf: true })).toBeNull();
  });
});

describe('dominios de los ATS', () => {
  it('reconoce los siete y nada más', () => {
    expect(atsFromUrl('https://empresaficticia.wd3.myworkdayjobs.com/es/x')).toBe('workday');
    expect(atsFromUrl('https://empresaficticia.wd5.myworkdaysite.com/recruiting/x')).toBe('workday');
    expect(atsFromUrl('https://job-boards.greenhouse.io/x/jobs/1')).toBe('greenhouse');
    expect(atsFromUrl('https://boards.greenhouse.io/x/jobs/1')).toBe('greenhouse');
    expect(atsFromUrl('https://jobs.eu.lever.co/x/1/apply')).toBe('lever');
    expect(atsFromUrl('https://jobs.smartrecruiters.com/oneclick-ui/x')).toBe('smartrecruiters');
    expect(atsFromUrl('https://apply.workable.com/x/j/1/apply/')).toBe('workable');
    expect(atsFromUrl('https://x.teamtailor.com/jobs/1')).toBe('teamtailor');
    expect(atsFromUrl('https://x.jobs.personio.com/job/1')).toBe('personio');
    for (const other of [
      'https://www.linkedin.com/jobs/view/1',
      'https://example.com/',
      'https://greenhouse.io.example.com/x',
      'https://evil-myworkdayjobs.com/x',
      'chrome://extensions',
      'not a url',
    ]) {
      expect(atsFromUrl(other), other).toBeNull();
    }
    expect(atsFromUrl(undefined)).toBeNull();
  });

  it('los permisos opcionales del manifiesto son exactamente los dominios del código', () => {
    expect([...ATS_HOST_PATTERNS].sort()).toEqual(Object.values(ATS_ORIGINS).flat().sort());
  });
});
