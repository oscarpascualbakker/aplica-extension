// El rellenado de la página activa (CV-507). Sin content scripts: el panel pide el permiso de host
// del ATS cuando la persona activa el autorrelleno, inyecta `fill.js` con scripting.executeScript y
// después lo llama con `func` y los datos como argumentos (solo JSON: el CV viaja en base64, que
// funciona igual en Chrome, Edge y Firefox). Las dependencias entran por parámetro (pruebas).

import { extensionApi } from '../browser';
import { ATTACHMENTS, FIELD_KINDS, type FillRequest, type FillSummary, type ScanResult } from '../fill/types';
import type { AtsKey } from '../fill/types';
import type { TabInfo } from './read-page';

export type FillPageDeps = {
  queryActiveTab(): Promise<TabInfo | undefined>;
  /** Pide permiso de host. Debe llamarse dentro del gesto de la persona (clic en el botón). */
  requestHostPermission(origins: string[]): Promise<boolean>;
  scan(tabId: number, ats: AtsKey | null): Promise<unknown>;
  fill(tabId: number, request: FillRequest): Promise<unknown>;
};

/**
 * Función que se serializa y corre en la página: no puede usar nada de fuera. El nombre del global es
 * el de FILL_GLOBAL (src/fill/inject.ts); un test comprueba que coinciden.
 */
export function callInPage(method: 'scan' | 'fill', argument: unknown): unknown {
  const api = (globalThis as unknown as Record<string, Record<string, ((value: unknown) => unknown) | undefined> | undefined>).__aplicaFill;
  return api?.[method]?.(argument);
}

async function inject(tabId: number, method: 'scan' | 'fill', argument: unknown): Promise<unknown> {
  const { scripting } = extensionApi();
  await scripting.executeScript({ target: { tabId }, files: ['fill.js'] });
  const [injected] = await scripting.executeScript({ target: { tabId }, func: callInPage, args: [method, argument] });
  return injected?.result;
}

export const fillPageDeps: FillPageDeps = {
  async queryActiveTab() {
    const tabs = await extensionApi().tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  },
  requestHostPermission: (origins) => extensionApi().permissions.request({ origins }),
  scan: (tabId, ats) => inject(tabId, 'scan', ats),
  fill: (tabId, request) => inject(tabId, 'fill', request),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Valida lo que devuelve el script inyectado: solo se acepta el formato esperado. */
export function parseScan(value: unknown): ScanResult | null {
  if (!isRecord(value) || typeof value.hasFileInput !== 'boolean' || typeof value.accept !== 'string') return null;
  return { hasFileInput: value.hasFileInput, accept: value.accept };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseSummary(value: unknown): FillSummary | null {
  if (!isRecord(value) || !Array.isArray(value.filled)) return null;
  const questionsFilled = count(value.questionsFilled);
  const hadValue = count(value.hadValue);
  const askYou = count(value.askYou);
  const questionsUnanswered = count(value.questionsUnanswered);
  const attachment = (ATTACHMENTS as readonly unknown[]).includes(value.attachment) ? (value.attachment as FillSummary['attachment']) : null;
  if (questionsFilled === null || hadValue === null || askYou === null || questionsUnanswered === null || attachment === null) return null;
  const filled = value.filled.filter((kind): kind is FillSummary['filled'][number] => (FIELD_KINDS as readonly unknown[]).includes(kind));
  return { filled, questionsFilled, hadValue, askYou, questionsUnanswered, attachment };
}
