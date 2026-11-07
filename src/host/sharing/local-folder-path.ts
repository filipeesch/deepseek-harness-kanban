import { access, constants, mkdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KanbanError } from '../../shared/errors.js';

/** The home-relative directory that holds the suggested per-Hub team folders. */
export const SUGGESTED_FOLDER_ROOT = '.dsh-kanban';

export interface FolderPathOptions {
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

function homeOf(options: FolderPathOptions): string {
  return options.home ?? os.homedir();
}

/** Expand a leading `~` to the home directory, leaving every other path untouched. */
export function expandHome(value: string, home: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(home, trimmed.slice(2));
  return trimmed;
}

/** The lexical absolute form of a typed path, before any filesystem inspection. */
export function absoluteFolderPath(value: string, options: FolderPathOptions = {}): string {
  return path.resolve(options.cwd ?? process.cwd(), expandHome(value, homeOf(options)));
}

/** The suggested default folder for one Hub. It is only a suggestion until the user connects. */
export function suggestedFolderPath(hubId: string, options: FolderPathOptions = {}): string {
  return path.join(homeOf(options), SUGGESTED_FOLDER_ROOT, hubId);
}

/** Show a path relative to the home directory when it lives inside it. */
export function abbreviateHome(value: string, home: string): string {
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  return value.startsWith(prefix) ? '~' + path.sep + value.slice(prefix.length) : value;
}

/**
 * Directory identity used to detect that two bindings address one folder.
 * A case-insensitive filesystem resolves two spellings to one directory.
 */
export function folderIdentity(resolved: string, platform: NodeJS.Platform = process.platform): string {
  const trimmed = resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
  return platform === 'darwin' || platform === 'win32' ? trimmed.toLocaleLowerCase() : trimmed;
}

/**
 * Whether one resolved path is the root itself or lies inside it, using the
 * same identity rule as a binding comparison. Both inputs are expected to be
 * resolved already; lexical `..` escapes are collapsed by `path.resolve`.
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

export interface InspectedFolder {
  /** The canonical path with symbolic links resolved. */
  path: string;
  identity: string;
}

function folderMissing(value: string, cause?: unknown): KanbanError {
  return new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder does not exist.', { path: value, ...(cause === undefined ? {} : { cause: cause instanceof Error ? cause.message : String(cause) }) });
}

/**
 * Resolve and validate one directory: it must exist, be a directory, and be
 * writable. Every refusal is a distinct typed error so the interface can name
 * the condition that prevented the connection.
 */
export async function inspectFolder(value: string, options: FolderPathOptions = {}): Promise<InspectedFolder> {
  const absolute = absoluteFolderPath(value, options);
  let info;
  try { info = await stat(absolute); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw folderMissing(absolute, error);
    throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder cannot be inspected.', { path: absolute, code });
  }
  if (!info.isDirectory()) throw new KanbanError('SHARING_FOLDER_NOT_DIRECTORY', 'The selected path is not a folder.', { path: absolute });
  let resolved: string;
  try { resolved = await realpath(absolute); }
  catch (error) { throw folderMissing(absolute, error); }
  try { await access(resolved, constants.W_OK); }
  catch (error) { throw new KanbanError('SHARING_FOLDER_UNWRITABLE', 'The selected folder is not writable.', { path: resolved, cause: error instanceof Error ? error.message : String(error) }); }
  return { path: resolved, identity: folderIdentity(resolved, options.platform) };
}

/** Create the suggested folder for a Hub. Any other path is the user's to create. */
export async function createSuggestedFolder(hubId: string, options: FolderPathOptions = {}): Promise<void> {
  await mkdir(suggestedFolderPath(hubId, options), { recursive: true });
}

/**
 * Resolve the managed publishing workspace before comparing it with an
 * inspected folder, so a symlinked ancestor cannot hide the overlap.
 */
export async function resolveManagedRoot(managedRoot: string | undefined): Promise<string | undefined> {
  if (!managedRoot) return undefined;
  try { return await realpath(managedRoot); } catch { return path.resolve(managedRoot); }
}

/**
 * Refuse a directory that belongs to the plugin's own managed publishing
 * workspace, where a clone or an intermediate file would be mixed with team
 * configuration that this storage must not own.
 */
export function assertOutsideManagedRoot(resolved: string, managedRoot: string | undefined): void {
  if (!managedRoot) return;
  const root = path.resolve(managedRoot);
  if (resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
    throw new KanbanError('SHARING_FOLDER_RESERVED', 'That folder is reserved for the plugin’s own publishing workspace.', { path: resolved, managedRoot: root });
  }
}
