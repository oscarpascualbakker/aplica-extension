export type Target = 'chrome' | 'edge' | 'firefox';
export const TARGETS: Target[];
export const DEV_PUBLIC_KEY: string;
export function buildManifest(
  target: Target,
  options: { version: string; dev?: boolean },
): Record<string, unknown>;
