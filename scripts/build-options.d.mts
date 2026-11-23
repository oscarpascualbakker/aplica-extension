import type { BuildOptions } from 'esbuild';
export const EXTRACT_GLOBAL: string;
export const DETECT_GLOBAL: string;
export function bundleOptions(options: {
  target: 'chrome' | 'edge' | 'firefox';
  dev: boolean;
  apiBase: string;
  outdir?: string;
  write?: boolean;
}): { background: BuildOptions; panel: BuildOptions; extract: BuildOptions; fill: BuildOptions; detect: BuildOptions };
export function filterLocale<T extends Record<string, unknown>>(messages: T, dev: boolean): Partial<T>;
