// Normalización y similitud de textos para el rellenado (CV-507). Sin dependencias: se empaqueta
// en el script inyectado.

/** Minúsculas, sin tildes y todo lo que no sea letra o número como espacio. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Palabras que no distinguen una pregunta de otra, en español e inglés.
const STOPWORDS = new Set(
  (
    'a an the of to in on for and or is are do does did you your yours me my we our us it this that with as at by be ' +
    'please describe tell about what why how which who when where would could should can will have has had if any ' +
    'required optional obligatorio opcional ' +
    'el la los las un una unos unas de del al y o en por para con que es son eres tu tus su sus te se lo como cual ' +
    'cuales cuando donde quien porque pregunta respuesta cuentanos cuenta explica describe indica'
  ).split(' '),
);

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((word) => word !== '' && !STOPWORDS.has(word)));
}

/**
 * Parecido entre dos preguntas, de 0 a 1 (coeficiente de Dice sobre las palabras con contenido).
 * Con menos de dos palabras en común no hay parecido: una sola palabra suelta no basta.
 */
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common++;
  if (common < 2 && !(left.size === 1 && right.size === 1 && common === 1)) return 0;
  return (2 * common) / (left.size + right.size);
}

/** Como `normalize`, pero separando antes el camelCase de nombres e ids (`dateOfBirth` pasa a `date of birth`). */
export function normalizeSplit(text: string): string {
  return normalize(text.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}
