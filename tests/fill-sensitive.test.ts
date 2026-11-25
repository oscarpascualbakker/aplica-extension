// Las preguntas sensibles no se rellenan nunca (CV-507). Criterio de aceptación: "ningún campo
// sensible de la lista se rellena nunca". Recorre todas las fixtures con una batería de etiquetas en
// español e inglés (con mayúsculas y tildes variadas) y comprueba que ninguna se rellena y todas quedan
// marcadas.
import { describe, expect, it } from 'vitest';
import { fillForm } from '../src/fill/fill';
import { isSensitive, sensitiveTopic } from '../src/fill/sensitive';
import type { FillAnswer } from '../src/fill/types';
import { ATS_KEYS, formDocument, formHtml, FORM_URLS, request } from './helpers/fill';

/** Etiquetas sensibles por tema de la lista del titular. */
const BATTERY: Record<string, string[]> = {
  visa: ['Do you need a visa to work in Spain?', 'Visa status', '¿Necesitas visado para trabajar?', 'Permiso de trabajo', 'Work permit', 'PERMISO DE RESIDENCIA'],
  patrocinio: ['Do you require sponsorship?', 'Will you need visa sponsorship now or in the future?', 'Patrocinio de visado', 'Employment sponsorship'],
  autorizacion: ['Are you legally authorized to work in Spain?', 'Work authorization', 'Autorización para trabajar en España', 'Right to work in the EU'],
  nacionalidad: ['Nationality', 'Nacionalidad', 'Country of citizenship', 'Ciudadanía', 'Citizenship status', 'Are you a US citizen?'],
  salario: [
    'Current salary',
    'Salario actual',
    'Expected salary',
    'Pretensiones salariales',
    'Salary expectations',
    'Desired compensation',
    'Pay expectations',
    'Expectativas económicas',
    'Sueldo deseado',
    'Hourly rate',
    'Remuneración esperada',
    'SALARIO BRUTO ANUAL',
  ],
  discapacidad: [
    'Disability status',
    'Do you have a disability?',
    'Discapacidad',
    '¿Tienes alguna minusvalía?',
    'Please let us know if there are any adjustments we can make to assist you during the interview process.',
    'Do you require any accommodations?',
    '¿Necesitas adaptaciones para el proceso de selección?',
  ],
  genero: ['Gender', 'Género', 'GÉNERO', 'Sexo', 'Preferred pronouns', 'Pronombres', 'Gender identity'],
  origen: ['Race', 'Ethnicity', 'Raza o etnia', 'Origen étnico', 'País de origen', 'Are you Hispanic or Latino?', 'Racial or ethnic origin'],
  veterano: ['Veteran status', 'Are you a protected veteran?', 'Servicio militar'],
  orientacion: ['Sexual orientation', 'Orientación sexual'],
  religion: ['Religion', 'Religión', 'RELIGIÓN', 'Religious beliefs', 'Creencias religiosas'],
  edad: ['Age', 'Edad', 'Date of birth', 'Fecha de nacimiento', 'Birthdate', 'Are you over 18?', 'Año de nacimiento'],
  antecedentes: ['Criminal record', 'Antecedentes penales', 'Have you ever been convicted of a felony?', 'Certificado de antecedentes'],
  reubicacion: ['Are you willing to relocate?', 'Reubicación', '¿Estás dispuesta a trasladarte?', 'Relocation assistance'],
  disponibilidad: [
    'Availability',
    'Disponibilidad',
    'Start date',
    'Earliest start date',
    'Fecha de incorporación',
    'Notice period',
    'Periodo de preaviso',
    'When can you start?',
    '¿Cuándo puedes empezar?',
    'Disponibilidad para incorporarte',
  ],
};
const LABELS = Object.values(BATTERY).flat();

/** Etiquetas sensibles con un nombre o un id que parece otra cosa: lo sensible manda siempre. */
const DISGUISED: [label: string, attributes: string][] = [
  ['Current salary', 'name="current_role" autocomplete="organization-title"'],
  ['Country of citizenship', 'name="location" autocomplete="address-level2"'],
  ['Salary expectations', 'type="tel" name="phone"'],
  ['Earliest start date', 'name="first_name" autocomplete="given-name"'],
  ['Date of birth', 'type="email" name="email"'],
  ['Nationality', 'name="city"'],
  ['Disability status', 'name="linkedin"'],
  ['Visa sponsorship', 'name="website"'],
];

// Campos sin etiqueta visible: solo el nombre, el id, el placeholder o el aria-label.
const UNLABELLED = [
  'name="visa_status"',
  'id="salary"',
  'name="dateOfBirth"',
  'placeholder="Nationality"',
  'aria-label="Género"',
  'name="expected_salary"',
  'id="notice_period"',
  'name="criminal_record"',
  'name="job_application[gender]"',
  'placeholder="Fecha de nacimiento"',
];

/** Un campo extra por etiqueta (texto y textarea), más un grupo de radios y un select. */
function extraFields(): string {
  const parts: string[] = [];
  LABELS.forEach((label, i) => {
    parts.push(`<div><label for="s_t_${String(i)}">${label}</label><input type="text" id="s_t_${String(i)}" name="s_t_${String(i)}"/></div>`);
    parts.push(`<div><label for="s_a_${String(i)}">${label}</label><textarea id="s_a_${String(i)}" name="s_a_${String(i)}"></textarea></div>`);
  });
  DISGUISED.forEach(([label, attributes], i) => {
    parts.push(`<div><label for="d_${String(i)}">${label}</label><input id="d_${String(i)}" ${attributes}/></div>`);
  });
  UNLABELLED.forEach((attributes, i) => {
    parts.push(`<div><input type="text" data-case="u_${String(i)}" ${attributes}/></div>`);
  });
  parts.push('<fieldset id="g_radios"><legend>Gender identity</legend><label><input type="radio" name="g_r" value="a"/> A</label><label><input type="radio" name="g_r" value="b"/> B</label></fieldset>');
  parts.push('<div><label for="g_select">Please choose</label><select id="g_select"><option value="">-</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select></div>');
  parts.push('<div><label for="g_opt">Choose one</label><select id="g_opt"><option value="">-</option><option>Decline to self identify</option><option>Other</option></select></div>');
  return parts.join('\n');
}

/** Respuestas de las Preguntas del formulario para cada etiqueta sensible: aun así no se usan. */
const TEMPTING: FillAnswer[] = LABELS.map((label) => ({ question: label, answer: 'Respuesta que no debe usarse', type: 'redactar' }));

describe.each(ATS_KEYS)('formulario de %s con la batería de sensibles', (ats) => {
  // Los pasos de Workday y SmartRecruiters no son un <form> del DOM normal: ahí se añade al final de <main>.
  const html = formHtml(ats).replace(/<\/form>|<\/main>/, `${extraFields()}\n$&`);

  it('ninguna etiqueta sensible se rellena y todas quedan marcadas', () => {
    const doc = formDocument(html, FORM_URLS[ats]);
    const before = new Set(Array.from(doc.querySelectorAll('input, textarea, select')));
    const summary = fillForm(doc, request(ats, { answers: [...request(ats).answers, ...TEMPTING] }));

    const added = Array.from(doc.querySelectorAll<HTMLInputElement>('input, textarea, select')).filter((node) => node.id.startsWith('s_') || node.id.startsWith('d_') || node.id.startsWith('g_') || node.dataset.case || node.name === 'g_r');
    expect(added.length).toBeGreaterThanOrEqual(LABELS.length * 2 + DISGUISED.length + UNLABELLED.length);
    for (const node of added) {
      const name = node.id || node.getAttribute('name') || node.dataset.case;
      expect(node.hasAttribute('data-aplica-ask-you'), name).toBe(true);
      expect(node.hasAttribute('data-aplica-filled'), name).toBe(false);
      expect(node.hasAttribute('data-aplica-had-value'), name).toBe(false);
      if (node.type === 'radio') expect(node.checked, name).toBe(false);
      else expect(node.value, name).toBe('');
    }
    expect(summary.askYou).toBeGreaterThan(LABELS.length * 2);
    expect(before.size).toBeGreaterThan(0);
  });

  it('con un perfil completo, ningún valor del perfil acaba en un campo sensible', () => {
    const doc = formDocument(html, FORM_URLS[ats]);
    fillForm(doc, request(ats));
    for (const node of Array.from(doc.querySelectorAll<HTMLInputElement>('[data-aplica-ask-you]'))) {
      expect(node.value === '' || node.type === 'radio', node.id || node.name).toBe(true);
    }
  });
});

describe('detector de sensibles', () => {
  it.each(LABELS)('%s es sensible', (label) => {
    expect(isSensitive(label)).toBe(true);
  });

  it('no distingue mayúsculas ni tildes', () => {
    expect(isSensitive('NACIONALIDAD')).toBe(isSensitive('nacionalidad'));
    expect(isSensitive('Fecha de incorporacion')).toBe(isSensitive('Fecha de incorporación'));
    expect(isSensitive('FECHA DE NACIMIENTO')).toBe(true);
  });

  it('mira también el nombre, el id (camelCase y guiones) y las opciones', () => {
    expect(isSensitive('', 'dateOfBirth')).toBe(true);
    expect(isSensitive('', 'job_application[veteran_status]')).toBe(true);
    expect(isSensitive('', '', 'Male Female Non-binary')).toBe(true);
    expect(sensitiveTopic('Salary expectations')).toBe('salary');
  });

  it('no marca los campos de contacto ni las preguntas normales', () => {
    for (const label of ['First name', 'Last name', 'Email', 'Phone', 'City', 'LinkedIn profile', 'Website', 'Current company', 'Current role', 'Years of experience', 'Why do you want to work at Empresa Ficticia S.L.?', 'Nombre', 'Apellidos', 'Correo electrónico', 'Teléfono', 'Ciudad', 'Sitio web', 'Puesto actual', 'Resume/CV', 'Cover letter', 'Language', 'Manager name', 'Page']) {
      expect(isSensitive(label), label).toBe(false);
    }
  });
});
