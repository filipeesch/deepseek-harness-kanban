import { lstat } from 'node:fs/promises';
import path from 'node:path';

/** Whether a filesystem entry exists; a missing path answers false instead of throwing. */
export async function entryExists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/**
 * Directory identity used to detect that two bindings address one folder and to
 * compare a resolved path with its root. A case-insensitive filesystem resolves
 * two spellings to one directory.
 */
export function folderIdentity(resolved: string, platform: NodeJS.Platform = process.platform): string {
  const trimmed = resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
  return platform === 'darwin' || platform === 'win32' ? trimmed.toLocaleLowerCase() : trimmed;
}

/**
 * Whether one resolved path is the root itself or lies inside it, using the
 * same identity rule as a binding comparison. Both inputs are expected to be
 * resolved already; lexical `..` escapes are collapsed before comparing.
 */
export function isWithinPath(root: string, candidate: string, platform: NodeJS.Platform = process.platform): boolean {
  const normalize = (value: string): string => {
    const unified = value.replace(/\\/g, '/');
    const absolute = unified.startsWith('/');
    const parts: string[] = [];
    for (const part of unified.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') { parts.pop(); continue; }
      parts.push(part);
    }
    const normalized = (absolute ? '/' : '') + parts.join('/');
    return platform === 'darwin' || platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
  };
  const base = normalize(root);
  const value = normalize(candidate);
  // Both spellings are compared after collapsing separators and dot segments,
  // so a Windows-style path can be reasoned about on any host.
  if (base === '/') return value.startsWith('/');
  return value === base || value.startsWith(base + '/');
}
