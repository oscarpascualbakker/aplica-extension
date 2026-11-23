// Qué formatos admite un campo de archivo (CV-507): atributo `accept` de <input type="file">.
// Lo usan el panel (para elegir Word o PDF antes de bajar el CV) y el script de relleno.

export type CvFormat = 'docx' | 'pdf';

export const CV_MIME: Record<CvFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** Sin `accept` se admite todo. Con él: extensiones (`.pdf`), tipos (`application/pdf`) o comodines (`application/*`). */
export function acceptsFile(accept: string, file: { name: string; type: string }): boolean {
  const tokens = accept
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return token === type;
  });
}

/** El formato del CV que admite el campo: Word si se puede, PDF si solo admite PDF y existe. */
export function chooseFormat(accept: string, available: { docx: boolean; pdf: boolean }): CvFormat | null {
  for (const format of ['docx', 'pdf'] as const) {
    if (available[format] && acceptsFile(accept, { name: `CV.${format}`, type: CV_MIME[format] })) return format;
  }
  return null;
}
