import { describe, expect, it } from 'vitest';
import { detectBrowser } from '../src/browser';

const chromeUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';

describe('detectBrowser', () => {
  it('Firefox por el esquema moz-extension', () => {
    expect(detectBrowser('moz-extension://abc/', { userAgent: 'Firefox' })).toBe('firefox');
  });

  it('Edge por userAgentData', () => {
    const nav = { userAgent: chromeUa, userAgentData: { brands: [{ brand: 'Microsoft Edge' }] } };
    expect(detectBrowser('chrome-extension://abc/', nav)).toBe('edge');
  });

  it('Edge por Edg/ en el UA', () => {
    expect(detectBrowser('chrome-extension://abc/', { userAgent: `${chromeUa} Edg/150.0.0.0` })).toBe('edge');
  });

  it('Chrome por defecto', () => {
    expect(detectBrowser('chrome-extension://abc/', { userAgent: chromeUa })).toBe('chrome');
  });
});
