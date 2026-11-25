// Rellenado sobre las fixtures de formulario de cada ATS (CV-507): contacto, adjunto del CV,
// preguntas abiertas, sensibles sin tocar y ningún envío. Las de Workday, Workable, SmartRecruiters,
// Teamtailor y Personio salen de capturas reales de noviembre de 2026 con contenido inventado (CV-543);
// Workday va por pasos y se prueba aparte, más abajo.
import { describe, expect, it, vi } from 'vitest';
import { fillForm } from '../src/fill/fill';
import type { AtsKey } from '../src/fill/types';
import { ANSWER_EN, ATS_KEYS, CV, deepFind, formDocument, FORM_URLS, formFor, pick, PROFILE, request, type Field } from './helpers/fill';

type Case = {
  /** Campo (selector) y el valor que debe quedar. */
  values: Record<string, string>;
  /** Campos sensibles: vacíos y marcados. */
  sensitive: string[];
  /** Campos que no deben cambiar (pregunta sin respuesta, carta, desplegable). */
  untouched: string[];
  file: string;
  /** Resumen esperado. */
  summary: { filled: number; questionsFilled: number; askYou: number };
};

const CITY = 'Villanueva del Ejemplo';
const FULL_LOCATION = 'Villanueva del Ejemplo, Provincia Ficticia';

const CASES: Record<Exclude<AtsKey, 'workday'>, Case> = {
  greenhouse: {
    values: {
      '#first_name': 'Ana',
      '#last_name': 'Ejemplo Prueba',
      '#email': PROFILE.email ?? '',
      '#phone': PROFILE.phone ?? '',
      '#question_100001': PROFILE.linkedin ?? '',
      '#question_100002': PROFILE.website ?? '',
      '#question_100003': ANSWER_EN,
    },
    sensitive: ['#question_100005', '#question_100006', '#question_100007', '#gender', '#race', '#veteran_status', '#disability_status'],
    // La ubicación es un combobox: no se rellena a mano, como en la página real.
    untouched: ['#candidate-location', '#question_100004'],
    file: '#resume',
    summary: { filled: 6, questionsFilled: 1, askYou: 7 },
  },
  lever: {
    values: {
      'input[name="name"]': 'Ana Ejemplo Prueba',
      'input[name="email"]': PROFILE.email ?? '',
      'input[name="phone"]': PROFILE.phone ?? '',
      'input[name="location"]': FULL_LOCATION,
      'input[name="org"]': 'Empresa Ficticia S.L.',
      'input[name="urls[LinkedIn]"]': PROFILE.linkedin ?? '',
      'input[name="urls[GitHub]"]': PROFILE.github ?? '',
      'input[name="urls[Portfolio]"]': PROFILE.website ?? '',
      'textarea[name="cards[00000000-0000-0000-0000-0000000000a1][field0]"]': ANSWER_EN,
    },
    sensitive: [
      'textarea[name="cards[00000000-0000-0000-0000-0000000000a3][field0]"]',
      'input[name="cards[00000000-0000-0000-0000-0000000000a4][field0]"]',
      'select[name="cards[00000000-0000-0000-0000-0000000000a5][field0]"]',
      'select[name="eeo[gender]"]',
      'select[name="eeo[race]"]',
      'select[name="eeo[veteran]"]',
    ],
    // La web va solo en el primer campo de web (Portfolio): "Other" no la repite.
    untouched: ['textarea[name="cards[00000000-0000-0000-0000-0000000000a2][field0]"]', 'textarea[name="comments"]', 'input[name="urls[Other]"]'],
    file: 'input[name="resume"]',
    summary: { filled: 8, questionsFilled: 1, askYou: 6 },
  },
  teamtailor: {
    values: {
      '#candidate_first_name': 'Ana',
      '#candidate_last_name': 'Ejemplo Prueba',
      '#candidate_email': PROFILE.email ?? '',
      '#candidate_phone': PROFILE.phone ?? '',
      '#candidate_answers_attributes_1_text': ANSWER_EN,
    },
    sensitive: ['#boolean-1001-true', '#boolean-1001-false', '#candidate_answers_attributes_2_text'],
    untouched: ['#candidate_answers_attributes_3_text'],
    file: '#candidate_resume_remote_url',
    summary: { filled: 4, questionsFilled: 1, askYou: 2 },
  },
  personio: {
    values: {
      '#field-first_name': 'Ana',
      '#field-last_name': 'Ejemplo Prueba',
      '#field-email': PROFILE.email ?? '',
      '#field-phone': PROFILE.phone ?? '',
    },
    sensitive: ['#field-available_from', '#field-salary_expectations'],
    // El campo "Otro" no es el CV.
    untouched: ['#doc-input-other'],
    file: '#doc-input-cv',
    summary: { filled: 4, questionsFilled: 0, askYou: 2 },
  },
  smartrecruiters: {
    values: {
      'input#first-name-input': 'Ana',
      'input#last-name-input': 'Ejemplo Prueba',
      'input#email-input': PROFILE.email ?? '',
      'input#confirm-email-input': PROFILE.email ?? '',
      'input[type="tel"]': PROFILE.phone ?? '',
      'input#linkedin-input': PROFILE.linkedin ?? '',
    },
    sensitive: [],
    // La ciudad es un combobox; las otras dos zonas de archivo (la foto y "autorrellenar con un CV") no son el CV.
    untouched: ['textarea#hiring-manager-message-input', 'input#spl-form-element_7', 'input#spl-dropzone-file-input-2', 'input[aria-label="Upload profile image"]'],
    file: 'input#spl-dropzone-file-input-1',
    summary: { filled: 6, questionsFilled: 0, askYou: 0 },
  },
  workable: {
    values: {
      '#firstname': 'Ana',
      '#lastname': 'Ejemplo Prueba',
      '#email': PROFILE.email ?? '',
      '#input_phone': PROFILE.phone ?? '',
      '#address': FULL_LOCATION,
      '#QA_12087194': ANSWER_EN,
    },
    sensitive: ['#q2_yes', '#q2_no'],
    // Ciudad, código postal y país los rellena el buscador de la dirección: están ocultos para los lectores.
    untouched: ['#QA_12087195', '#city', '#postcode', '#country'],
    file: '#input_files_input_resume',
    summary: { filled: 5, questionsFilled: 1, askYou: 1 },
  },
};

/** El botón de enviar (o de pasar al paso siguiente) de cada ATS. */
const SEND =
  'button[type="submit"], input[type="submit"], button[type="button"][data-qa="btn-submit"], button[data-automation-id="pageFooterNextButton"], oc-button[data-test="footer-next"], oc-button[data-test="footer-submit"]';

/** Rellena y comprueba que no se envía nada: ni submit, ni requestSubmit, ni clics, ni teclado. */
function neverSubmits(doc: Document, ats: AtsKey): void {
  const window = doc.defaultView as unknown as { HTMLFormElement: { prototype: HTMLFormElement } };
  const submit = vi.spyOn(window.HTMLFormElement.prototype, 'submit');
  const requestSubmit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit');
  const seen: string[] = [];
  for (const name of ['submit', 'click', 'keydown', 'keypress', 'keyup', 'dblclick']) {
    doc.addEventListener(name, (event) => seen.push(`${event.type}:${(event.target as Element).tagName}`), true);
  }
  fillForm(doc, request(ats));
  expect(submit).not.toHaveBeenCalled();
  expect(requestSubmit).not.toHaveBeenCalled();
  expect(seen).toEqual([]);
  // El botón de enviar sigue ahí y sin tocar.
  const send = deepFind(doc, SEND);
  expect(send).not.toBeNull();
  expect(send?.hasAttribute('data-aplica-filled')).toBe(false);
}

const files = (field: Field): FileList => (field as HTMLInputElement).files as FileList;

const WITH_ONE_PAGE = ATS_KEYS.filter((ats): ats is Exclude<AtsKey, 'workday'> => ats !== 'workday');

describe.each(WITH_ONE_PAGE)('formulario de %s', (ats) => {
  const expected = CASES[ats];

  it('rellena el contacto y lo resalta para revisarlo', () => {
    const doc = formFor(ats);
    const summary = fillForm(doc, request(ats));
    for (const [selector, value] of Object.entries(expected.values)) {
      const field = pick(doc, selector);
      expect(field.value, selector).toBe(value);
      expect(field.hasAttribute('data-aplica-filled'), selector).toBe(true);
      expect(field.style.getPropertyValue('outline'), selector).toContain('solid');
    }
    expect(summary.filled).toHaveLength(expected.summary.filled);
    expect(summary.questionsFilled).toBe(expected.summary.questionsFilled);
  });

  it('adjunta el CV de la candidatura en el campo de archivo', () => {
    const doc = formFor(ats);
    const events: string[] = [];
    const input = pick(doc, expected.file);
    for (const name of ['input', 'change']) input.addEventListener(name, () => events.push(name));
    const summary = fillForm(doc, request(ats));
    expect(summary.attachment).toBe('attached');
    expect(files(input)).toHaveLength(1);
    expect(files(input)[0]?.name).toBe(CV.name);
    expect(files(input)[0]?.size).toBe(9);
    expect(events).toEqual(['input', 'change']);
    expect(input.hasAttribute('data-aplica-filled')).toBe(true);
  });

  it('sin CV (sin candidatura preparada) rellena el contacto y no adjunta nada', () => {
    const doc = formFor(ats);
    const summary = fillForm(doc, request(ats, { cv: null, answers: [] }));
    expect(summary.attachment).toBe('no_file');
    expect(summary.filled).toHaveLength(expected.summary.filled);
    expect(summary.questionsFilled).toBe(0);
    expect(files(pick(doc, expected.file))).toHaveLength(0);
  });

  it('deja las sensibles vacías y las marca "Contéstalo tú" con una etiqueta visible', () => {
    const doc = formFor(ats);
    const summary = fillForm(doc, request(ats));
    for (const selector of expected.sensitive) {
      const field = pick(doc, selector);
      expect(field.hasAttribute('data-aplica-ask-you'), selector).toBe(true);
      expect(field.hasAttribute('data-aplica-filled'), selector).toBe(false);
      expect(field.value === '' || field.type === 'radio', selector).toBe(true);
      expect('checked' in field ? field.checked : false, selector).toBe(false);
    }
    expect(summary.askYou).toBe(expected.summary.askYou);
    const badges = Array.from(doc.querySelectorAll('[data-aplica-badge]'));
    expect(badges).toHaveLength(expected.summary.askYou);
    for (const badge of badges) expect(badge.textContent).toBe('Contéstalo tú');
  });

  it('no toca lo que no tiene respuesta ni los campos que no son de contacto', () => {
    const doc = formFor(ats);
    fillForm(doc, request(ats));
    for (const selector of expected.untouched) {
      const field = pick(doc, selector);
      expect(field.value, selector).toBe('');
      expect(field.hasAttribute('data-aplica-filled'), selector).toBe(false);
    }
  });

  it('nunca envía el formulario: ni submit, ni requestSubmit, ni clics, ni teclado', () => {
    neverSubmits(formFor(ats), ats);
  });

  it('es la dirección de un ATS conocido y repetir el rellenado no cambia el resultado', () => {
    const doc = formFor(ats);
    fillForm(doc, request(ats));
    const again = fillForm(doc, request(ats));
    expect(again.filled).toHaveLength(expected.summary.filled);
    expect(again.hadValue).toBe(0);
    expect(again.askYou).toBe(expected.summary.askYou);
    expect(doc.querySelectorAll('[data-aplica-badge]')).toHaveLength(expected.summary.askYou);
    expect(FORM_URLS[ats]).toMatch(/^https:/);
  });
});

// ---------- Workday, paso a paso (CV-543) ----------
// El formulario de Workday son varias pantallas de /apply/applyManually: la cuenta, "My Information" y
// "My Experience". Cada una es una fixture sacada de una captura real, con contenido inventado.

describe('formulario de Workday: My Information', () => {
  it('rellena nombre, apellido, ciudad y teléfono, y deja el resto como está', () => {
    const doc = formFor('workday');
    const summary = fillForm(doc, request('workday'));
    expect(summary.filled.sort()).toEqual(['city', 'firstName', 'lastName', 'phone']);
    expect(pick(doc, '#name--legalName--firstName').value).toBe('Ana');
    expect(pick(doc, '#name--legalName--lastName').value).toBe('Ejemplo Prueba');
    expect(pick(doc, '#address--city').value).toBe(CITY);
    expect(pick(doc, '#phoneNumber--phoneNumber').value).toBe(PROFILE.phone);
    expect(summary.attachment).toBe('no_input');
  });

  it('no toca el segundo apellido, la calle, el código postal, la extensión ni los buscadores', () => {
    const doc = formFor('workday');
    fillForm(doc, request('workday'));
    for (const selector of ['#name--legalName--secondaryLastName', '#address--addressLine1', '#address--postalCode', '#phoneNumber--extension', '#source--source', '#phoneNumber--countryPhoneCode']) {
      const field = pick(doc, selector);
      expect(field.value, selector).toBe('');
      expect(field.hasAttribute('data-aplica-filled'), selector).toBe(false);
    }
  });

  it('los campos auxiliares sin id ni etiqueta detrás de cada desplegable no se rellenan', () => {
    const doc = formFor('workday');
    fillForm(doc, request('workday'));
    const helpers = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="text"]:not([id]):not([name])'));
    expect(helpers).toHaveLength(3);
    for (const helper of helpers) expect(helper.hasAttribute('data-aplica-filled')).toBe(false);
    expect((pick(doc, '#vvov7') as HTMLInputElement).checked).toBe(false);
  });

  it('nunca envía el formulario', () => {
    neverSubmits(formFor('workday'), 'workday');
  });
});

describe('formulario de Workday: My Experience', () => {
  it('no escribe en el historial (puesto, empresa, fechas, estudios) y adjunta el CV', () => {
    const doc = formFor('workday', 'workday-experience');
    const summary = fillForm(doc, request('workday'));
    expect(summary.filled).toEqual([]);
    expect(summary.askYou).toBe(0);
    expect(summary.questionsFilled).toBe(0);
    for (const field of Array.from(doc.querySelectorAll<Field>('[id^="workExperience-"], [id^="education-"]'))) {
      expect(field.hasAttribute('data-aplica-filled'), field.id).toBe(false);
      expect(field.hasAttribute('data-aplica-ask-you'), field.id).toBe(false);
      if (field.type !== 'checkbox') expect(field.value, field.id).toBe('');
    }
    expect(summary.attachment).toBe('attached');
    const input = pick(doc, 'input[data-automation-id="file-upload-input-ref"]');
    expect(files(input)[0]?.name).toBe(CV.name);
  });

  it('nunca envía el formulario', () => {
    neverSubmits(formFor('workday', 'workday-experience'), 'workday');
  });
});

describe('pantalla de crear cuenta de Workday', () => {
  it('rellena el email y no toca las contraseñas ni el campo cebo para robots', () => {
    const doc = formFor('workday', 'workday-account');
    const summary = fillForm(doc, request('workday'));
    expect(summary.filled).toEqual(['email']);
    expect(pick(doc, '#input-4').value).toBe(PROFILE.email);
    for (const selector of ['#input-5', '#input-6', 'input[data-automation-id="beecatcher"]']) {
      const field = pick(doc, selector);
      expect(field.value, selector).toBe('');
      expect(field.hasAttribute('data-aplica-filled'), selector).toBe(false);
    }
  });

  it('un cebo para robots se reconoce también por su etiqueta, en cualquier ATS', () => {
    const doc = formDocument(
      '<form><label for="hp">Leave this empty. This input is for robots only, do not enter if you are human.</label><input id="hp" name="website" type="text"/><label for="web">Website</label><input id="web" name="web" type="text"/></form>',
      FORM_URLS.lever,
    );
    fillForm(doc, request('lever'));
    expect(pick(doc, '#hp').value).toBe('');
    expect(pick(doc, '#web').value).toBe(PROFILE.website);
  });
});

// ---------- SmartRecruiters: pregunta de selección (CV-543) ----------

describe('formulario de SmartRecruiters: preguntas de selección', () => {
  const QUESTION = 'input#question_00000000-0000-4000-8000-0000000000a';

  it('contesta la pregunta con respuesta, deja la otra y marca la del salario', () => {
    const doc = formFor('smartrecruiters', 'smartrecruiters-screening');
    const summary = fillForm(doc, request('smartrecruiters'));
    expect(pick(doc, `${QUESTION}1`).value).toBe(ANSWER_EN);
    expect(pick(doc, `${QUESTION}2`).value).toBe('');
    expect(pick(doc, `${QUESTION}3`).value).toBe('');
    expect(pick(doc, `${QUESTION}3`).hasAttribute('data-aplica-ask-you')).toBe(true);
    expect(summary.questionsFilled).toBe(1);
    expect(summary.questionsUnanswered).toBe(1);
    expect(summary.askYou).toBe(1);
  });

  it('el CV no va a "Additional attachments": esta pantalla no tiene campo de CV', () => {
    const doc = formFor('smartrecruiters', 'smartrecruiters-screening');
    const summary = fillForm(doc, request('smartrecruiters'));
    expect(summary.attachment).toBe('no_input');
    expect(files(pick(doc, 'input#spl-dropzone-file-input-3'))).toHaveLength(0);
  });

  it('nunca envía el formulario', () => {
    neverSubmits(formFor('smartrecruiters', 'smartrecruiters-screening'), 'smartrecruiters');
  });
});
