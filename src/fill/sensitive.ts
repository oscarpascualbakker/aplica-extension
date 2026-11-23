// Preguntas sensibles (CV-507): nunca se rellenan. Lista decidida por el titular de Aplica:
// visado, permiso de trabajo, patrocinio, nacionalidad, ciudadanía, salario y pretensiones,
// discapacidad, género y pronombres, origen, raza o etnia, veterano, orientación sexual, religión,
// edad o fecha de nacimiento, antecedentes penales, reubicación, disponibilidad y fecha de
// incorporación o preaviso.
//
// Se buscan en el texto de la etiqueta o la pregunta, el nombre, el id y las opciones, en español e
// inglés. El texto llega normalizado (minúsculas, sin tildes, solo letras y números), así que los
// patrones no llevan tildes ni signos. La comprobación va SIEMPRE antes que cualquier otro
// emparejamiento: un campo sensible no se rellena aunque parezca otra cosa ("Current salary" no es
// el puesto actual y "Country of citizenship" no es la ubicación). En la duda se marca de más.

import { normalize, normalizeSplit } from './text';

export const SENSITIVE_PATTERNS: readonly { topic: string; pattern: RegExp }[] = [
  { topic: 'visa', pattern: /\bvisa\b|\bvisado\b|work ?permit|permiso de (trabajo|residencia)|permiso para trabajar|residence permit/ },
  {
    topic: 'work_authorization',
    pattern:
      /work authori[sz]ation|authori[sz]ed to work|eligible to work|legally (authori[sz]ed|allowed|entitled|eligible)|right to work|permitted to work|autorizacion (de|para) trabajar|autorizacion laboral|derecho a trabajar|legalmente (autorizad|habilitad|pued)|trabajar legalmente/,
  },
  { topic: 'sponsorship', pattern: /sponsor|patrocin/ },
  { topic: 'nationality', pattern: /nationalit|nacionalidad|citizen|ciudadan/ },
  {
    topic: 'salary',
    pattern:
      /salar|sueldo|compensation|compensacion|remunera|retribu|pay (expectation|range|rate|requirement)|expected pay|desired pay|current pay|\bwages?\b|\bctc\b|hourly rate|day rate|tarifa|pretension|expectativa(s)? (econ|sal)|expectations? (of )?(pay|salary|compensation)|how much (do you|would you)/,
  },
  // Las adaptaciones o ajustes para el proceso de selección son una pregunta de discapacidad aunque no lo digan.
  {
    topic: 'disability',
    pattern:
      /disab|discapac|minusval|handicap|chronic (illness|condition)|enfermedad cronica|accommodation|reasonable adjustment|adjustments? (we can make|to (assist|support))|accessible (and inclusive )?interview|ajustes razonables|adaptaciones? (en|para|durante) (el|la|tu) (proceso|entrevista|seleccion)/,
  },
  {
    topic: 'gender',
    pattern: /\bgender|\bgenero\b|\bsex\b|\bsexo\b|transgender|non ?binary|pronoun|pronombre|\b(male|female|mujer|hombre)\b/,
  },
  // Las opciones de las preguntas de autoidentificación (EEO) delatan el campo aunque la etiqueta no.
  {
    topic: 'self_identification',
    pattern: /self ?identif|decline to (self|answer|state|identify)|prefer not to (say|answer|disclose|state)|prefiero no (decir|contestar|indicar)/,
  },
  { topic: 'origin', pattern: /\brace\b|racial|ethnic|\betnia|\braza\b|\borigen\b|\borigin\b|hispanic|latino|latina|latinx|\bindigen/ },
  { topic: 'veteran', pattern: /veteran|military|servicio militar|\bmilitar\b/ },
  { topic: 'orientation', pattern: /sexual|\blgbt|\bqueer\b/ },
  { topic: 'religion', pattern: /religi|\bcreed\b|\bfaith\b|\bcreencia/ },
  {
    topic: 'age',
    pattern:
      /\bage\b|\bedad\b|date ?of ?birth|birth ?date|birth ?day|\bdob\b|year of birth|born|nacimiento|fecha de nac|cumpleanos|years old|anos de edad|mayor de edad|(over|above|at least|older than) 18|(mayor|mas) de 18/,
  },
  { topic: 'criminal', pattern: /criminal|antecedente|convict|conviction|felony|penal\b|delito|condena|police record|record policial/ },
  {
    topic: 'relocation',
    pattern: /reloca|reubic|traslad|willing to move|dispuest[oa]s? a (mudar|trasladar|cambiar de (ciudad|residencia))|mudarte|mudarse|movilidad geografica/,
  },
  {
    topic: 'availability',
    pattern:
      /availab|disponib|start(ing)? date|earliest start|date available|available (from|to start)|when (can|could|would) you (start|join)|joining date|can you start|fecha de (inicio|comienzo|incorporacion|disponibilidad)|incorporacion|incorporar|cuando (puedes|podrias|podria|puede) (empezar|comenzar|incorporar|iniciar|empiezas)|notice period|periodo de (pre)?aviso|plazo de (pre)?aviso|preaviso|\bnotice\b (period|to|before)|\bavailable\b/,
  },
];

/** Tema sensible del texto (etiqueta, pregunta, nombre, id, opciones), o null si no lo es. */
export function sensitiveTopic(...texts: string[]): string | null {
  const haystack = texts
    .flatMap((text) => [normalize(text), normalizeSplit(text)])
    .filter((text) => text !== '')
    .join(' | ');
  if (haystack === '') return null;
  return SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(haystack))?.topic ?? null;
}

export function isSensitive(...texts: string[]): boolean {
  return sensitiveTopic(...texts) !== null;
}
