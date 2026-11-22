// PKCE (RFC 7636) y `state` para el emparejamiento (CV-503).

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** code_challenge = base64url(SHA-256(code_verifier)), método S256. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
