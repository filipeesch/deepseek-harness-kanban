import { createDarwinOwnership, createDarwinTable } from './darwin.js';
import { createLinuxOwnership, createLinuxTable } from './linux.js';
import { markerNeedle, sweepOwned } from './sweep.js';
import type { ProcessOwnership, ProcessTable } from './types.js';
import { createWindowsOwnership, WINDOWS_UNSUPPORTED } from './windows.js';

export * from './types.js';
export { markerNeedle, sweepOwned } from './sweep.js';
export { createLinuxOwnership, createLinuxTable, type ProcessFiles } from './linux.js';
export { createDarwinOwnership, createDarwinTable, type ProcessPrograms } from './darwin.js';
export { createDelegatedOwnership } from './delegated.js';
export { createWindowsOwnership, WINDOWS_UNSUPPORTED } from './windows.js';

/** The table the host may read outside any execution confinement. */
export function hostTable(platform: NodeJS.Platform = process.platform): ProcessTable | undefined {
  if (platform === 'linux') return createLinuxTable();
  if (platform === 'darwin') return createDarwinTable();
  return undefined;
}

/** One ownership implementation for the platform this host runs on. */
export function createProcessOwnership(platform: NodeJS.Platform = process.platform): ProcessOwnership {
  if (platform === 'linux') return createLinuxOwnership();
  if (platform === 'darwin') return createDarwinOwnership();
  return createWindowsOwnership();
}

/** The processes that still carry one run's token, as the host can read them. */
export function ownedProcesses(marker: string, platform: NodeJS.Platform = process.platform): number[] {
  const table = hostTable(platform);
  // An empty set here would read as proof that nothing survives, which no platform
  // without an ownership primitive can claim.
  if (table === undefined) throw new Error(WINDOWS_UNSUPPORTED);
  return table.candidates(markerNeedle(marker));
}

/** Terminates the processes that still carry one run's token, as the host can. */
export async function terminateOwned(marker: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const table = hostTable(platform);
  if (table === undefined) throw new Error(WINDOWS_UNSUPPORTED);
  await sweepOwned(table, marker);
}
