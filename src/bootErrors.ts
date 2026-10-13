/**
 * Classifies start-up failures so visitors see an explanation they can act on
 * instead of a developer command ("Run: npm run fetch-tle").
 */

/** The orbital catalog could not be fetched or is unusable. */
export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUnavailableError';
  }
}

export type BootErrorKind = 'data' | 'webgl' | 'unknown';

/** Whether this browser can create a WebGL context at all. */
export function hasWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function classifyBootError(err: unknown): BootErrorKind {
  if (err instanceof DataUnavailableError) return 'data';
  if (err instanceof Error && /webgl/i.test(err.message)) return 'webgl';
  return 'unknown';
}

export const BOOT_ERROR_MESSAGE_KEY: Record<BootErrorKind, string> = {
  data: 'boot.error_data',
  webgl: 'boot.error_webgl',
  unknown: 'boot.error_unknown',
};
