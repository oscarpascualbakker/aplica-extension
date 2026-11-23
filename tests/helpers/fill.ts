// Ayudas para las pruebas del rellenado (CV-507). Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { ATS_KEYS, type AtsKey, type FillAnswer, type FillProfile, type FillRequest } from '../../src/fill/types';

export { ATS_KEYS };

export const FORM_URLS: Record<AtsKey, string> = {
  workday: 'https://empresaficticia.wd3.myworkdayjobs.com/es/Careers/job/Madrid/Desarrolladora-backend_R-1/apply',
  greenhouse: 'https://job-boards.greenhouse.io/empresaficticia/jobs/1234567',
  lever: 'https://jobs.lever.co/empresaficticia/00000000-0000-0000-0000-000000000001/apply',
  smartrecruiters: 'https://jobs.smartrecruiters.com/oneclick-ui/company/EmpresaFicticia/publication/1',
  workable: 'https://apply.workable.com/empresaficticia/j/ABC123/apply/',
  teamtailor: 'https://empresaficticia.teamtailor.com/jobs/1234567-desarrolladora-backend',
  personio: 'https://empresaficticia.jobs.personio.de/job/1234567',
};

export const PROFILE: FillProfile = {
  name: 'Ana Ejemplo Prueba',
  email: 'ana@example.com',
  phone: '+34 600 000 000',
  location: 'Villanueva del Ejemplo, Provincia Ficticia',
  linkedin: 'https://www.linkedin.com/in/ana-ejemplo',
  github: 'https://github.com/ana-ejemplo',
  website: 'https://ana-ejemplo.example',
  currentTitle: 'Desarrolladora backend',
  currentCompany: 'Empresa Ficticia S.L.',
  yearsExperience: 6,
};

export const ANSWER_EN = 'Because I like building tools for small shops, and the platform team is where I can do it best.';
export const ANSWER_ES = 'Porque me gusta construir herramientas para pequeños comercios y el equipo de plataforma encaja conmigo.';

export const ANSWERS: FillAnswer[] = [
  { question: 'Why do you want to work at Empresa Ficticia S.L.?', answer: ANSWER_EN, type: 'redactar' },
  { question: '¿Por qué quieres trabajar en Empresa Ficticia S.L.?', answer: ANSWER_ES, type: 'redactar' },
  { question: 'Are you legally authorized to work in Spain?', answer: null, type: 'contesta_tu' },
];

/** Un DOCX de mentira (unos bytes) en base64. */
export const CV_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
export const CV = {
  name: 'CV-Ana-Ejemplo.docx',
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  base64: Buffer.from(CV_BYTES).toString('base64'),
};

export function request(ats: AtsKey | null, overrides: Partial<FillRequest> = {}): FillRequest {
  return { ats, profile: PROFILE, answers: ANSWERS, cv: CV, askYouLabel: 'Contéstalo tú', ...overrides };
}

export function formHtml(ats: AtsKey): string {
  return readFileSync(`tests/fixtures/forms/${ats}.html`, 'utf8');
}

/** Documento de happy-dom con el formulario, listo para rellenar (sin ejecutar scripts). */
export function formDocument(html: string, url: string): Document {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
    },
  });
  window.document.write(html);
  return window.document as unknown as Document;
}

export function formFor(ats: AtsKey): Document {
  return formDocument(formHtml(ats), FORM_URLS[ats]);
}

export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function pick(doc: Document, selector: string): Field {
  const found = doc.querySelector(selector);
  if (!found) throw new Error(`No existe ${selector}`);
  return found as Field;
}
