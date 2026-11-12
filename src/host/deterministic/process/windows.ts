import type { ProcessOwnership } from './types.js';

const UNSUPPORTED = 'NATIVE_LIFETIME_UNSUPPORTED: no whole-tree ownership primitive is enabled on this platform. Configure a provider with proven Windows job-object cleanup before running this script.';

/** Windows ownership is a seam: no whole-tree primitive is enabled yet. */
export function createWindowsOwnership(): ProcessOwnership {
  return {
    async sweep() { throw new Error(UNSUPPORTED); },
  };
}

export const WINDOWS_UNSUPPORTED = UNSUPPORTED;
