import { describe, expect, it, vi } from 'vitest';
import { parseExtracted, readPage, type ReadDeps } from '../src/panel/read-page';

const EXTRACTED = {
  title: 'Desarrolladora backend',
  company: 'Empresa Ficticia S.L.',
  location: 'Villanueva del Ejemplo',
  workMode: 'hibrido',
  salary: '',
  description: 'Texto',
  portal: 'lever',
  descriptionFromSelection: false,
  descriptionTruncated: false,
};

function deps(overrides: Partial<ReadDeps> = {}): ReadDeps {
  return {
    queryActiveTab: () => Promise.resolve({ id: 7, url: 'https://jobs.lever.co/empresaficticia/1' }),
    runExtract: vi.fn(() => Promise.resolve(EXTRACTED)),
    ...overrides,
  };
}

describe('readPage', () => {
  it('lee la pestaña activa y pone la URL de la pestaña', async () => {
    const d = deps();
    const outcome = await readPage(d);
    expect(outcome).toEqual({ status: 'ok', offer: { ...EXTRACTED, url: 'https://jobs.lever.co/empresaficticia/1' } });
    expect(d.runExtract).toHaveBeenCalledWith(7);
  });

  it('LinkedIn: la URL se normaliza a /jobs/view/<id>/', async () => {
    const outcome = await readPage(
      deps({ queryActiveTab: () => Promise.resolve({ id: 1, url: 'https://www.linkedin.com/jobs/search/?currentJobId=4400000001' }) }),
    );
    expect(outcome).toMatchObject({ status: 'ok', offer: { url: 'https://www.linkedin.com/jobs/view/4400000001/' } });
  });

  it('sin permiso de pestaña (sin URL) pide pulsar el icono y no inyecta nada', async () => {
    const d = deps({ queryActiveTab: () => Promise.resolve({ id: 1 }) });
    expect(await readPage(d)).toEqual({ status: 'no_access' });
    expect(d.runExtract).not.toHaveBeenCalled();
  });

  it('sin pestaña activa, lo mismo', async () => {
    expect(await readPage(deps({ queryActiveTab: () => Promise.resolve(undefined) }))).toEqual({ status: 'no_access' });
  });

  it('si executeScript falla por falta de permiso, no_access', async () => {
    const outcome = await readPage(deps({ runExtract: () => Promise.reject(new Error('Cannot access contents of the page')) }));
    expect(outcome).toEqual({ status: 'no_access' });
  });

  it('páginas que no son web: unsupported', async () => {
    for (const url of ['chrome://extensions', 'about:blank', 'moz-extension://x/panel.html', 'file:///tmp/a.html']) {
      const d = deps({ queryActiveTab: () => Promise.resolve({ id: 1, url }) });
      expect(await readPage(d)).toEqual({ status: 'unsupported' });
      expect(d.runExtract).not.toHaveBeenCalled();
    }
  });

  it('resultado con formato inesperado: failed', async () => {
    expect(await readPage(deps({ runExtract: () => Promise.resolve({ title: 3 }) }))).toEqual({ status: 'failed' });
    expect(await readPage(deps({ runExtract: () => Promise.resolve(undefined) }))).toEqual({ status: 'failed' });
  });

  it('error al consultar la pestaña: failed', async () => {
    expect(await readPage(deps({ queryActiveTab: () => Promise.reject(new Error('x')) }))).toEqual({ status: 'failed' });
  });
});

describe('parseExtracted', () => {
  it('portal desconocido pasa a other y modalidad inválida a null', () => {
    expect(parseExtracted({ ...EXTRACTED, portal: 'raro', workMode: 'a ratos' })).toMatchObject({ portal: 'other', workMode: null });
  });
});
