import { describe, expect, it } from 'vitest';
import { base64url, codeChallenge, randomToken } from '../src/pkce';

describe('PKCE (RFC 7636)', () => {
  it('reproduce el vector del apéndice B', async () => {
    // Resultado comprobado con openssl dgst -sha256 -binary | base64 (CV-503).
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await codeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('genera 32 bytes en base64url, 43 caracteres, sin relleno', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('codifica en base64url sin +, / ni =', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });
});
