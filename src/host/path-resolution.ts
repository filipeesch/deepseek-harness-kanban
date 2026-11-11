import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError } from '../shared/errors.js';

/**
 * The one canonical path resolver. It validates the shape of the input, resolves
 * aliases, and reports an unavailable path with the same problem everywhere, so a
 * moved directory is diagnosed the same way by the Git adapter, the project probe,
 * and the project save path.
 */
export async function resolveCanonicalPath(value: string, allowMissing = false): Promise<string> {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new KanbanError('INVALID_PATH', 'An absolute path without control characters is required.', { path: value });
  const candidate = path.resolve(value);
  try { return await realpath(candidate); }
  catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parent = path.dirname(candidate);
      if (parent !== candidate) return path.join(await resolveCanonicalPath(parent, true), path.basename(candidate));
    }
    throw new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: candidate, cause: (error as NodeJS.ErrnoException).code });
  }
}
/** Resolve one existing directory, rejecting a missing or non-directory path with the shared problem. */
export async function requireDirectory(value: string): Promise<string> {
  const canonical = await resolveCanonicalPath(value);
  if (!(await stat(canonical)).isDirectory()) throw new KanbanError('INVALID_DIRECTORY', 'The selected path is not a directory.', { path: canonical });
  return canonical;
}
