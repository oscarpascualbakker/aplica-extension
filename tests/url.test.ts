import { describe, expect, it } from 'vitest';
import { offerUrl } from '../src/extract/url';

describe('offerUrl', () => {
  it('LinkedIn /jobs/search con currentJobId manda la oferta concreta', () => {
    expect(offerUrl('https://www.linkedin.com/jobs/search/?currentJobId=4400000001&keywords=backend')).toBe(
      'https://www.linkedin.com/jobs/view/4400000001/',
    );
  });

  it('LinkedIn /jobs/collections con currentJobId', () => {
    expect(offerUrl('https://es.linkedin.com/jobs/collections/recommended/?currentJobId=4400000002')).toBe(
      'https://www.linkedin.com/jobs/view/4400000002/',
    );
  });

  it('LinkedIn /jobs/view se deja tal cual', () => {
    const url = 'https://www.linkedin.com/jobs/view/4400000003/?trk=x';
    expect(offerUrl(url)).toBe(url);
  });

  it('currentJobId que no es un número se ignora', () => {
    const url = 'https://www.linkedin.com/jobs/search/?currentJobId=abc';
    expect(offerUrl(url)).toBe(url);
  });

  it('otros portales y hosts parecidos no se tocan', () => {
    const url = 'https://www.infojobs.net/madrid/x/of-i1?currentJobId=4400000001';
    expect(offerUrl(url)).toBe(url);
    const fake = 'https://notlinkedin.com/jobs/search/?currentJobId=4400000001';
    expect(offerUrl(fake)).toBe(fake);
  });

  it('una URL que no se puede leer se devuelve igual', () => {
    expect(offerUrl('no es una url')).toBe('no es una url');
  });
});
