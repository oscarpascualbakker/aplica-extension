// Tipos del rellenado de formularios (CV-507). Todo es serializable: la petición viaja del panel
// al script inyectado como argumento de scripting.executeScript, y el resumen vuelve igual.

export const ATS_KEYS = ['workday', 'greenhouse', 'lever', 'smartrecruiters', 'workable', 'teamtailor', 'personio'] as const;
export type AtsKey = (typeof ATS_KEYS)[number];

/** Tipos de campo de contacto que se rellenan con el perfil. */
export const FIELD_KINDS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'city',
  'location',
  'linkedin',
  'github',
  'website',
  'currentTitle',
  'currentCompany',
  'yearsExperience',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Lo mínimo del perfil que necesita el formulario. Cada valor puede faltar. */
export type FillProfile = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  yearsExperience: number | null;
};

/** Respuesta de las Preguntas del formulario (CV-473). `answer` es null en `contesta_tu`. */
export type FillAnswer = { question: string; answer: string | null; type: 'redactar' | 'contesta_tu' };

/** El CV de la candidatura, en base64 porque executeScript solo admite JSON (CV-507). */
export type FillFile = { name: string; type: string; base64: string };

export type FillRequest = {
  ats: AtsKey | null;
  profile: FillProfile;
  answers: FillAnswer[];
  cv: FillFile | null;
  /** Etiqueta visible junto a lo que la persona debe contestar ella («Contéstalo tú»). */
  askYouLabel: string;
};

/** Qué hay en la página para adjuntar el CV: lo mira el panel antes de bajar el fichero. */
export type ScanResult = { hasFileInput: boolean; accept: string };

export type Attachment = 'attached' | 'no_file' | 'no_input' | 'not_accepted' | 'failed' | 'had_file';
export const ATTACHMENTS: readonly Attachment[] = ['attached', 'no_file', 'no_input', 'not_accepted', 'failed', 'had_file'];

export type FillSummary = {
  /** Campos de contacto rellenados, por tipo. */
  filled: FieldKind[];
  questionsFilled: number;
  /** Campos que ya tenían valor y no se han tocado. */
  hadValue: number;
  /** Campos sensibles (o que Aplica no redacta) marcados «Contéstalo tú». */
  askYou: number;
  /** Preguntas abiertas para las que no había respuesta. */
  questionsUnanswered: number;
  attachment: Attachment;
};
