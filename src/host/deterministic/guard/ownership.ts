import { createDelegatedOwnership, createLinuxOwnership, createWindowsOwnership } from '../process/index.js';
import type { ProcessOwnership } from '../process/types.js';

/**
 * The ownership primitive available inside the execution world.
 *
 * Linux reads the kernel's process filesystem directly. macOS cannot read another
 * process's environment from inside the confinement, so the proof is requested from
 * the host over the authenticated lifetime channel. Any other platform has no
 * supported primitive and fails closed.
 */
export function guardOwnershipSupported(platform: NodeJS.Platform): boolean {
  return platform === 'linux' || platform === 'darwin';
}

export function createGuardOwnership(options: { platform: NodeJS.Platform; requestSweep: (marker: string) => Promise<void> }): ProcessOwnership {
  if (options.platform === 'linux') return createLinuxOwnership();
  if (options.platform === 'darwin') return createDelegatedOwnership(options.requestSweep);
  return createWindowsOwnership();
}
