import os from 'node:os';
import path from 'node:path';

/** `DSH_HOME` is the installation data root; provider workspaces stay under it. */
export function sharingRoot(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const base = env.DSH_HOME?.trim() || path.join(home, '.dsh');
  return path.join(base, 'kanban', 'shared');
}
