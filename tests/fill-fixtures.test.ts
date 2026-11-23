// Rellenado sobre las fixtures de formulario de cada ATS (CV-507): contacto, adjunto del CV,
// preguntas abiertas, sensibles sin tocar y ningún envío.
import { describe, expect, it, vi } from 'vitest';
import { fillForm } from '../src/fill/fill';
import type { AtsKey } from '../src/fill/types';
import { ANSWER_EN, ANSWER_ES, ATS_KEYS, CV, FORM_URLS, formFor, pick, PROFILE, request, type Field } from './helpers/fill';

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

const CASES: Record<AtsKey, Case> = {
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
      '#candidate_city': CITY,
      '#candidate_linkedin': PROFILE.linkedin ?? '',
      '#candidate_website': PROFILE.website ?? '',
      '#answer_1': ANSWER_ES,
    },
    sensitive: ['#answer_3', '#answer_4', '#answer_5', 'input[name="answers[6][answer]"]'],
    untouched: ['#answer_2'],
    file: '#candidate_resume',
    summary: { filled: 7, questionsFilled: 1, askYou: 4 },
  },
  personio: {
    values: {
      '#first_name': 'Ana',
      '#last_name': 'Ejemplo Prueba',
      '#email': PROFILE.email ?? '',
      '#phone': PROFILE.phone ?? '',
      '#location': FULL_LOCATION,
      '#linkedin': PROFILE.linkedin ?? '',
      '#website': PROFILE.website ?? '',
      '#question_11': ANSWER_EN,
    },
    sensitive: ['#available_from', '#salary_expectations', '#question_13', '#question_14'],
    untouched: ['#question_12'],
    file: '#cv',
    summary: { filled: 7, questionsFilled: 1, askYou: 4 },
  },
  workday: {
    values: {
      '#input-1': 'Ana',
      '#input-2': 'Ejemplo Prueba',
      '#input-3': PROFILE.email ?? '',
      '#input-4': CITY,
      '#input-5': PROFILE.phone ?? '',
      '#input-6': PROFILE.linkedin ?? '',
      '#input-7': PROFILE.website ?? '',
      '#q-1': ANSWER_EN,
    },
    sensitive: ['#q-3', '#q-4', '#q-5', '#q-6', '#q-7'],
    untouched: ['#q-2', '#input-source'],
    file: '#input-8',
    summary: { filled: 7, questionsFilled: 1, askYou: 5 },
  },
  smartrecruiters: {
    values: {
      '#first-name-input': 'Ana',
      '#last-name-input': 'Ejemplo Prueba',
      '#email-input': PROFILE.email ?? '',
      '#confirm-email-input': PROFILE.email ?? '',
      '#phone-input': PROFILE.phone ?? '',
      '#city-input': CITY,
      '#linkedin-input': PROFILE.linkedin ?? '',
      '#web-input': PROFILE.website ?? '',
      '#q1': ANSWER_EN,
    },
    sensitive: ['input[name="question-3"]', '#q4', '#q5', '#q6'],
    untouched: ['#q2'],
    file: '#resume-input',
    summary: { filled: 8, questionsFilled: 1, askYou: 4 },
  },
  workable: {
    values: {
      '#firstname': 'Ana',
      '#lastname': 'Ejemplo Prueba',
      '#email': PROFILE.email ?? '',
      '#phone': PROFILE.phone ?? '',
      '#address': FULL_LOCATION,
      '#QA_100001': PROFILE.linkedin ?? '',
      '#QA_100002': PROFILE.website ?? '',
      '#QA_100003': ANSWER_EN,
    },
    sensitive: ['input[name="QA_100005"]', '#QA_100006', '#QA_100007', '#QA_100008'],
    untouched: ['#cover_letter', '#QA_100004'],
    file: '#resume',
    summary: { filled: 7, questionsFilled: 1, askYou: 4 },
  },
};

const files = (field: Field): FileList => (field as HTMLInputElement).files as FileList;

describe.each(ATS_KEYS)('formulario de %s', (ats) => {
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
    const doc = formFor(ats);
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
    const send = doc.querySelector('button[type="submit"], button[type="button"][data-qa="btn-submit"], button[data-automation-id="pageFooterNextButton"]');
    expect(send).not.toBeNull();
    expect(send?.hasAttribute('data-aplica-filled')).toBe(false);
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
