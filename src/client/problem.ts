import type { Problem } from '../shared/types.js';

/** Convert any thrown value into the wire problem shape used by the UI. */
export function asProblem(error: unknown): Problem {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; details?: unknown; error?: unknown };
    if (value.error && typeof value.error === 'object') return asProblem(value.error);
    return { code: typeof value.code === 'string' ? value.code : 'CLIENT_ERROR', message: typeof value.message === 'string' ? value.message : 'The operation could not be completed.', ...(value.details && typeof value.details === 'object' ? { details: value.details as Record<string, unknown> } : {}) };
  }
  return { code: 'CLIENT_ERROR', message: typeof error === 'string' ? error : 'The operation could not be completed.' };
}
