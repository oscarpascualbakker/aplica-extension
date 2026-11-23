// Rellenado de formularios de candidatura (CV-507). Se ejecuta en la página, inyectado con
// scripting.executeScript cuando la persona pulsa "Rellenar este formulario".
//
// NUNCA envía nada: no hay llamadas a submit ni a requestSubmit, no hace clic en ningún botón y no
// dispara Enter ni otro evento de teclado. Solo asigna valores y lanza input, change y blur para que
// React o Vue los vean. Sin red y sin APIs de la extensión: recibe los datos como argumento y
// devuelve un resumen.
//
// Orden de decisión por campo: 1) ¿es sensitive? Se deja vacío y se marca "Contéstalo tú"; 2) ¿lo
// reconoce el adaptador del ATS o la detección genérica (etiqueta, aria, placeholder, nombre, id,
// autocomplete)? Se rellena con el perfil; 3) ¿es una pregunta abierta con respuesta en las
// Preguntas del formulario (CV-473)? Se rellena. Selects, radios y casillas nunca se rellenan.
// Lo que ya tiene valor no se toca. Lo rellenado se resalta en verde para que se revise.

import { acceptsFile } from './accept';
import { ADAPTERS } from './ats';
import { isSensitive } from './sensitive';
import { normalize, normalizeSplit, similarity } from './text';
import type { AtsKey, Attachment, FieldKind, FillFile, FillProfile, FillRequest, FillSummary, ScanResult } from './types';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type View = Window & typeof globalThis;
type Paint = 'filled' | 'had' | 'ask';

/** Un campo con todo lo que se sabe de él, ya normalizado. */
type Field = {
  control: Control;
  /** Lo que la persona lee: etiqueta, aria-label, placeholder, leyenda. */
  label: string;
  /** Lo que usa el ATS: name, id, autocomplete, data-*. Cada valor por separado. */
  attrs: string[];
  /** Opciones de un select o de un grupo de radios, con el texto de la pregunta del grupo. */
  options: string;
};

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'range', 'color']);
const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search', 'number']);
const ATTRIBUTES = ['name', 'id', 'autocomplete', 'data-automation-id', 'data-ui', 'data-testid', 'data-qa'];
const MIN_SIMILARITY = 0.6;
const MIN_QUESTION_WORDS = 4;

const COLORS: Record<Paint, { border: string; background: string }> = {
  filled: { border: '#1a7f37', background: '#dcfce7' },
  had: { border: '#9a6700', background: '#fff8c5' },
  ask: { border: '#cf222e', background: '#ffebe9' },
};

// ---------- Descubrir los campos ----------

function collect(root: Document | ShadowRoot, out: Control[]): void {
  root.querySelectorAll<Control>('input, textarea, select').forEach((control) => out.push(control));
  // Los formularios con componentes web (SmartRecruiters) pueden tener los campos en un shadow root abierto.
  root.querySelectorAll('*').forEach((node) => {
    if (node.shadowRoot) collect(node.shadowRoot, out);
  });
}

function inputType(control: Control): string {
  return control.tagName === 'INPUT' ? ((control as HTMLInputElement).type || '').toLowerCase() : '';
}

function isUsable(control: Control): boolean {
  if (control.disabled || control.closest('[hidden]')) return false;
  if (control.tagName === 'INPUT' && SKIP_TYPES.has(inputType(control))) return false;
  return true;
}

/** Texto de un nodo sin los campos que contiene (el valor de un textarea no es la etiqueta). */
function plainText(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('input, textarea, select, script, style, [data-aplica-badge]').forEach((child) => {
    child.remove();
  });
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function byId(root: Node, id: string): Element | null {
  const scope = root as Document | ShadowRoot;
  if (typeof scope.getElementById === 'function') return scope.getElementById(id);
  return Array.from(scope.querySelectorAll('[id]')).find((node) => node.id === id) ?? null;
}

function labelTexts(control: Control): string[] {
  const root = control.getRootNode();
  const texts: string[] = [];
  const scope = root as Document | ShadowRoot;
  if (control.id) {
    scope.querySelectorAll('label[for]').forEach((label) => {
      if (label.getAttribute('for') === control.id) texts.push(plainText(label));
    });
  }
  const wrapping = control.closest('label');
  if (wrapping) texts.push(plainText(wrapping));
  for (const id of (control.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
    const node = byId(root, id);
    if (node) texts.push(plainText(node));
  }
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    const value = control.getAttribute(attribute);
    if (value) texts.push(value);
  }
  return texts.filter((text) => text !== '');
}

/** Leyenda del grupo (fieldset o role=group) al que pertenece el campo. */
function groupLabel(control: Control): string {
  const texts: string[] = [];
  const fieldset = control.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend) texts.push(plainText(legend));
  const group = control.closest('[role="radiogroup"], [role="group"]');
  if (group) {
    const own = group.getAttribute('aria-label');
    if (own) texts.push(own);
    for (const id of (group.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
      const node = byId(control.getRootNode(), id);
      if (node) texts.push(plainText(node));
    }
  }
  return texts.join(' ');
}

function optionTexts(control: Control, all: Control[]): string {
  if (control.tagName === 'SELECT') {
    return Array.from((control as HTMLSelectElement).options)
      .map((option) => `${option.textContent} ${option.value}`)
      .join(' ');
  }
  if (inputType(control) !== 'radio') return '';
  const name = control.getAttribute('name');
  const group = name ? all.filter((other) => inputType(other) === 'radio' && other.getAttribute('name') === name && other.form === control.form) : [control];
  const texts = group.flatMap((radio) => [...labelTexts(radio), radio.getAttribute('value') ?? '']);
  // La pregunta del grupo suele ser el texto del ancestro común más pequeño de todos los radios.
  if (group.length > 1) {
    let ancestor: Element | null = control.parentElement;
    while (ancestor && !group.every((radio) => ancestor?.contains(radio))) ancestor = ancestor.parentElement;
    // Y se sube mientras el ancestro no contenga otros campos: ahí suele estar el enunciado.
    for (let level = 0; ancestor && level < 3; level++) {
      const parent: Element | null = ancestor.parentElement;
      const foreign = parent ? Array.from(parent.querySelectorAll<Control>('input, textarea, select')).some((other) => !group.includes(other)) : true;
      if (!parent || foreign) break;
      ancestor = parent;
    }
    if (ancestor) texts.push(plainText(ancestor));
  }
  return texts.join(' ');
}

function describe(control: Control, all: Control[]): Field {
  const label = [...labelTexts(control), groupLabel(control)].join(' ');
  const attrs = ATTRIBUTES.map((attribute) => control.getAttribute(attribute) ?? '').filter((value) => value !== '');
  return { control, label, attrs, options: optionTexts(control, all) };
}

// ---------- Reconocer el campo ----------

type Rule = { kind: FieldKind | 'name'; label?: RegExp; attr?: RegExp; unless?: RegExp };

// Se prueban en orden: el primero que encaja gana. Las etiquetas y los atributos van normalizados.
const RULES: readonly Rule[] = [
  { kind: 'linkedin', label: /linkedin/, attr: /linkedin/ },
  { kind: 'github', label: /github/, attr: /github/ },
  {
    kind: 'website',
    label: /\bwebsite\b|web ?site|portfolio|sitio web|pagina web|web personal|personal (site|url|page)/,
    attr: /(website|web ?site|portfolio|personal ?url)$/,
  },
  {
    kind: 'yearsExperience',
    label: /(years?|anos) (of )?(relevant |professional |work |total |prior )?experience|anos de experiencia/,
    attr: /years? ?(of )?experience$/,
  },
  {
    kind: 'currentCompany',
    label: /current (company|employer|organi[sz]ation)|present employer|empresa actual|empleador actual|organizacion actual/,
    attr: /(current ?(company|employer)|\borg)$/,
  },
  {
    kind: 'currentTitle',
    label: /current (job |work )?(title|role|position|occupation)|job title|puesto actual|cargo actual|posicion actual|ocupacion actual/,
    attr: /current ?(job ?)?(title|role|position)$/,
  },
  { kind: 'email', label: /e ?mail|correo/, attr: /(^|\s)e ?mail( address)?$/ },
  {
    kind: 'phone',
    label: /phone|telefono|\bmovil\b|celular|mobile|\btel\b/,
    attr: /(^|\s)(phone|telephone|mobile|tel|phone ?number)$/,
    unless: /(country|area) code|extension|device|phone type|tipo de|prefijo|codigo (de )?(pais|area)/,
  },
  { kind: 'lastName', label: /last name|family name|surname|apellido/, attr: /(last ?name|family ?name|surname)$/ },
  { kind: 'firstName', label: /first name|given name|forename|nombre de pila/, attr: /(first ?name|given ?name|forename)$/ },
  { kind: 'fullName', label: /full name|complete name|your name|nombre completo|nombre y apellido/, attr: /(^|\s)full ?name$/ },
  // Solo "Nombre" o "Name": nombre completo si el formulario no tiene apellidos aparte.
  { kind: 'name', label: /^(name|nombre)$/, attr: /^name$/ },
];

const AUTOCOMPLETE: Record<string, FieldKind | 'name'> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  name: 'name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-level2': 'city',
  'organization-title': 'currentTitle',
};

/** Etiqueta sin las marcas de obligatoriedad ("Name (required)", "Nombre *"). */
function cleanLabel(label: string): string {
  return normalize(label)
    .replace(/\b(required|optional|obligatorio|opcional)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ruleKind(field: Field): FieldKind | 'name' | null {
  const label = cleanLabel(field.label);
  const attrs = field.attrs.map((attr) => normalize(attr));
  const split = field.attrs.map((attr) => normalizeSplit(attr));
  for (const rule of RULES) {
    if (rule.unless && (rule.unless.test(label) || attrs.some((a) => rule.unless?.test(a)))) continue;
    if (rule.label?.test(label)) return rule.kind;
    if (rule.attr && [...attrs, ...split].some((attr) => rule.attr?.test(attr))) return rule.kind;
  }
  return null;
}

function locationKind(field: Field): 'city' | 'location' | null {
  const label = cleanLabel(field.label);
  const attrs = [...field.attrs.map((a) => normalize(a)), ...field.attrs.map((a) => normalizeSplit(a))];
  const hasCountry = /country|pais/.test(label);
  if (/\bcity\b|ciudad|\btown\b|localidad|poblacion|municipio/.test(label) && !/postal|zip|street|calle|state|provincia|province/.test(label)) {
    return hasCountry ? 'location' : 'city';
  }
  if (/location|ubicacion|residen|based|donde vives|where do you live|domicilio|lugar de/.test(label) && !/country|pais|postal|zip|street|calle|state|provin|prefer|office|oficina|work location/.test(label)) {
    return 'location';
  }
  if (attrs.some((attr) => /(^|\s)(city|town|locality|address ?level2)$/.test(attr))) return 'city';
  if (attrs.some((attr) => /(^|\s)location$/.test(attr))) return 'location';
  return null;
}

function adapterKind(field: Field, ats: AtsKey | null): FieldKind | null {
  if (!ats) return null;
  for (const rule of ADAPTERS[ats].rules) {
    if (rule.pattern.test(field.control.getAttribute(rule.attr) ?? '')) return rule.kind;
  }
  return null;
}

/** El tipo de campo de contacto (o "name" si es ambiguo), o null si no es de contacto. */
function classify(field: Field, ats: AtsKey | null): FieldKind | 'name' | null {
  const adapted = adapterKind(field, ats);
  if (adapted) return adapted;
  const autocomplete = AUTOCOMPLETE[(field.control.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).pop() ?? ''];
  if (autocomplete) return autocomplete;
  const type = inputType(field.control);
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  return ruleKind(field) ?? locationKind(field);
}

// ---------- Valores ----------

export function splitName(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? '', last: words.slice(1).join(' ') };
}

function valueFor(kind: FieldKind, profile: FillProfile): string | null {
  const text = (value: string | null): string | null => (value && value.trim() !== '' ? value.trim() : null);
  switch (kind) {
    case 'firstName':
      return text(splitName(profile.name ?? '').first);
    case 'lastName':
      return text(splitName(profile.name ?? '').last);
    case 'fullName':
      return text(profile.name);
    case 'email':
      return text(profile.email);
    case 'phone':
      return text(profile.phone);
    case 'city':
      return text((profile.location ?? '').split(',')[0] ?? '');
    case 'location':
      return text(profile.location);
    case 'linkedin':
      return text(profile.linkedin);
    case 'github':
      return text(profile.github);
    case 'website':
      return text(profile.website);
    case 'currentTitle':
      return text(profile.currentTitle);
    case 'currentCompany':
      return text(profile.currentCompany);
    case 'yearsExperience':
      return profile.yearsExperience === null ? null : String(profile.yearsExperience);
  }
}

// ---------- Escribir en la página ----------

function viewOf(doc: Document): View {
  return (doc.defaultView ?? globalThis) as View;
}

function fire(view: View, control: Element, names: string[], value?: string): void {
  for (const name of names) {
    const event =
      name === 'input' && typeof view.InputEvent === 'function'
        ? new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value ?? null })
        : new view.Event(name, { bubbles: true });
    control.dispatchEvent(event);
  }
}

/** Asigna con el setter nativo del prototipo: así React y Vue, que vigilan el valor, se enteran. */
function setValue(view: View, control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = control.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  // El setter se llama con Reflect.apply sobre el campo: no se pierde el `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) Reflect.apply(setter, control, [value]);
  else control.value = value;
  fire(view, control, ['input'], value);
  fire(view, control, ['change', 'blur', 'focusout']);
}

function paint(control: Element, how: Paint): void {
  const { border, background } = COLORS[how];
  control.setAttribute(how === 'filled' ? 'data-aplica-filled' : how === 'had' ? 'data-aplica-had-value' : 'data-aplica-ask-you', 'true');
  const style = (control as HTMLElement).style;
  style.setProperty('outline', `3px solid ${border}`, 'important');
  style.setProperty('outline-offset', '1px', 'important');
  if (control.tagName !== 'INPUT' || TEXT_TYPES.has(inputType(control as Control))) {
    style.setProperty('background-color', background, 'important');
    style.setProperty('color', '#1f2328', 'important');
  }
}

/** Etiqueta visible junto al campo (o tras la última opción de un grupo). */
function addBadge(doc: Document, anchor: Element, text: string): void {
  const next = anchor.nextElementSibling;
  if (next?.hasAttribute('data-aplica-badge')) return;
  const badge = doc.createElement('span');
  badge.setAttribute('data-aplica-badge', 'true');
  badge.textContent = text;
  badge.style.cssText = `display:block;margin:4px 0;font:600 12px/1.4 sans-serif;color:#82071e;`;
  anchor.insertAdjacentElement('afterend', badge);
}

function decodeBase64(view: View, base64: string): Uint8Array {
  const binary = view.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- El campo del CV ----------

const COVER_LETTER = /cover|letter|carta|motivation|motivacion|photo|foto|portfolio|transcript|certificate|certificado/;
const CV_WORDS = /resume|\bcv\b|curriculum|lebenslauf/;

function fileFields(fields: Field[]): Field[] {
  return fields.filter((field) => inputType(field.control) === 'file' && !isSensitive(field.label, ...field.attrs, field.options));
}

function otherDocument(field: Field): boolean {
  return COVER_LETTER.test(cleanLabel(`${field.label} ${field.attrs.join(' ')}`));
}

function findCvInput(fields: Field[], ats: AtsKey | null): HTMLInputElement | null {
  const files = fileFields(fields);
  if (ats) {
    const hit = files.find((field) => field.control.matches(ADAPTERS[ats].cvSelector) && !otherDocument(field));
    if (hit) return hit.control as HTMLInputElement;
  }
  const named = files.find((field) => CV_WORDS.test(cleanLabel(`${field.label} ${field.attrs.join(' ')}`)) && !otherDocument(field));
  if (named) return named.control as HTMLInputElement;
  const only = files.filter((field) => !otherDocument(field));
  return only.length === 1 ? (only[0]?.control as HTMLInputElement) : null;
}

function allFields(doc: Document): Field[] {
  const controls: Control[] = [];
  collect(doc, controls);
  const usable = controls.filter(isUsable);
  return usable.map((control) => describe(control, usable));
}

/** Qué hay para adjuntar el CV: el panel lo mira antes de bajar el fichero (Word o PDF según `accept`). */
export function scanForm(doc: Document, ats: AtsKey | null): ScanResult {
  const input = findCvInput(allFields(doc), ats);
  return { hasFileInput: input !== null, accept: input?.getAttribute('accept') ?? '' };
}

function attach(view: View, input: HTMLInputElement, file: FillFile): Attachment {
  if (!acceptsFile(input.getAttribute('accept') ?? '', file)) return 'not_accepted';
  try {
    const bytes = decodeBase64(view, file.base64);
    const transfer = new view.DataTransfer();
    transfer.items.add(new view.File([bytes as BlobPart], file.name, { type: file.type }));
    input.files = transfer.files;
    if (input.files.length !== 1) return 'failed';
    fire(view, input, ['input', 'change']);
    paint(input, 'filled');
    return 'attached';
  } catch {
    return 'failed';
  }
}

// ---------- Preguntas abiertas ----------

// Textos que no son una pregunta para responder con las Preguntas del formulario.
const NOT_A_QUESTION = /cover letter|carta de presentacion|additional information|informacion adicional|anything else|algo mas|comments?\b|comentarios|\bnotes?\b|\bnotas\b/;

type Candidate = { answer: FillRequest['answers'][number]; score: number };

function bestAnswer(question: string, answers: FillRequest['answers']): Candidate | null {
  let best: Candidate | null = null;
  for (const answer of answers) {
    const score = similarity(question, answer.question);
    if (score >= MIN_SIMILARITY && (!best || score > best.score)) best = { answer, score };
  }
  return best;
}

function wordCount(label: string): number {
  return cleanLabel(label).split(' ').filter(Boolean).length;
}

// ---------- Rellenar ----------

/**
 * Rellena el formulario de `doc` con el perfil, las respuestas y el CV. Devuelve el resumen para el
 * panel. Nunca envía el formulario (CV-507).
 */
export function fillForm(doc: Document, request: FillRequest): FillSummary {
  const view = viewOf(doc);
  const summary: FillSummary = { filled: [], questionsFilled: 0, hadValue: 0, askYou: 0, questionsUnanswered: 0, attachment: 'no_file' };
  const fields = allFields(doc);

  const ask = (anchor: Element, marked: Element[]): void => {
    for (const node of marked) paint(node, 'ask');
    addBadge(doc, anchor, request.askYouLabel);
    summary.askYou++;
  };

  // 1) Sensibles primero: nada de lo que viene después puede rellenarlos.
  const sensitive = new Set<Control>();
  const radioGroups = new Set<string>();
  for (const field of fields) {
    if (!isSensitive(field.label, ...field.attrs, field.options)) continue;
    const { control } = field;
    sensitive.add(control);
    if (inputType(control) === 'radio' && control.getAttribute('name')) {
      const key = `${control.form ? 'f' : 'n'}:${control.getAttribute('name') ?? ''}`;
      const group = fields.filter((other) => inputType(other.control) === 'radio' && other.control.getAttribute('name') === control.getAttribute('name') && other.control.form === control.form).map((other) => other.control);
      group.forEach((radio) => sensitive.add(radio));
      if (radioGroups.has(key)) continue;
      radioGroups.add(key);
      const last = group.at(-1) ?? control;
      ask(last.closest('label') ?? last, group);
      continue;
    }
    ask(control, [control]);
  }

  // 2) Campos de contacto y 3) preguntas abiertas.
  const rest = fields.filter((field) => !sensitive.has(field.control));
  const kinds = new Map<Control, FieldKind | 'name' | null>();
  for (const field of rest) kinds.set(field.control, textLike(field.control) ? classify(field, request.ats) : null);
  const separateSurname = Array.from(kinds.values()).includes('lastName');
  // La web va en un solo campo: Lever pide "Portfolio" y "Other" y no hay que repetirla. El email sí se
  // repite (SmartRecruiters pide confirmarlo).
  let websiteFilled = false;

  for (const field of rest) {
    const { control } = field;
    if (!textLike(control) || control.tagName === 'SELECT') continue;
    const target = control as HTMLInputElement | HTMLTextAreaElement;
    const found = kinds.get(control) ?? null;
    const kind: FieldKind | null = found === 'name' ? (separateSurname ? 'firstName' : 'fullName') : found;

    if (kind) {
      const value = valueFor(kind, request.profile);
      if (value === null || (target.maxLength > 0 && value.length > target.maxLength)) continue;
      if (kind === 'website') {
        if (websiteFilled) continue;
        websiteFilled = true;
      }
      if (target.hasAttribute('data-aplica-filled') && target.value !== '') {
        summary.filled.push(kind);
      } else if (target.value.trim() !== '') {
        paint(target, 'had');
        summary.hadValue++;
      } else {
        setValue(view, target, value);
        paint(target, 'filled');
        summary.filled.push(kind);
      }
      continue;
    }

    // Pregunta abierta: un textarea, o un campo de texto cuya etiqueta parece una pregunta.
    const question = cleanLabel(field.label);
    const isQuestion = control.tagName === 'TEXTAREA' || wordCount(field.label) >= MIN_QUESTION_WORDS;
    if (question === '' || !isQuestion || NOT_A_QUESTION.test(question)) continue;
    const match = bestAnswer(field.label, request.answers);
    if (!match) {
      summary.questionsUnanswered++;
    } else if (match.answer.type === 'contesta_tu' || !match.answer.answer) {
      // Aplica no redacta esta (CV-473): la contesta la persona.
      ask(target, [target]);
    } else if (target.hasAttribute('data-aplica-filled') && target.value !== '') {
      summary.questionsFilled++;
    } else if (target.value.trim() !== '') {
      paint(target, 'had');
      summary.hadValue++;
    } else if (target.maxLength > 0 && match.answer.answer.length > target.maxLength) {
      summary.questionsUnanswered++;
    } else {
      setValue(view, target, match.answer.answer);
      paint(target, 'filled');
      summary.questionsFilled++;
    }
  }

  // 4) El CV, si hay dónde ponerlo.
  const input = findCvInput(rest, request.ats);
  if (!input) {
    summary.attachment = 'no_input';
  } else if (!request.cv) {
    summary.attachment = 'no_file';
  } else if (input.files && input.files.length > 0 && !input.hasAttribute('data-aplica-filled')) {
    paint(input, 'had');
    summary.hadValue++;
    summary.attachment = 'had_file';
  } else {
    summary.attachment = attach(view, input, request.cv);
  }
  return summary;
}

function textLike(control: Control): boolean {
  if (control.tagName === 'TEXTAREA') return true;
  if (control.tagName !== 'INPUT') return false;
  const role = control.getAttribute('role');
  // Los desplegables con búsqueda (combobox) no se rellenan a mano: no se elige una opción así.
  if (role === 'combobox' || control.getAttribute('aria-haspopup') === 'listbox') return false;
  return TEXT_TYPES.has(inputType(control));
}
