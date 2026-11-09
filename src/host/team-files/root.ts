import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_TRASH_DIRECTORY } from '../../shared/types.js';
import { folderIdentity, isWithinPath } from '../paths.js';

const MAX_RELATIVE_LENGTH = 1024;

export interface TeamFilePathOptions {
  /** Internal callers that own the trash destination; tools never pass this. */
  allowTrash?: boolean;
}

function invalidPath(value: string, detail: string): KanbanError {
  return new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file path "' + value + '" is not valid: ' + detail, { path: value });
}

function trashReserved(value: string): KanbanError {
  return new KanbanError('TEAM_FILE_TRASH_RESERVED', 'The path "' + value + '" is reserved: deleted team files live in ' + TEAM_FILES_TRASH_DIRECTORY + ' and no tool can reach them.', { path: value });
}

/**
 * The single gate every team file path passes through. It is purely lexical so
 * a caller can validate before touching a transport, and it refuses everything
 * that could address something other than a file inside the owned directory.
 * The value is used exactly as supplied: trimming would make a file whose name
 * begins or ends with a space unreachable and would hide a control character
 * before it was checked.
 */
export function normalizeTeamFilePath(value: unknown, options: TeamFilePathOptions = {}): string {
  if (typeof value !== 'string') throw new KanbanError('INVALID_INPUT', 'A team file path must be a string.');
  if (value.length === 0) throw new KanbanError('INVALID_INPUT', 'A team file path is required.');
  if (value.length > MAX_RELATIVE_LENGTH) throw invalidPath(value, 'it is longer than ' + MAX_RELATIVE_LENGTH + ' characters.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw invalidPath(value, 'it contains a control character.');
  if (value.includes('\\')) throw invalidPath(value, 'it must use "/" as the path separator.');
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw invalidPath(value, 'it must be relative to the team files directory.');
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0)) throw invalidPath(value, 'it contains an empty segment.');
  if (segments.some(segment => segment === '.' || segment === '..')) throw invalidPath(value, 'it contains a "." or ".." segment.');
  // The comparison is case-insensitive so an alias cannot become the trash on a
  // case-insensitive filesystem.
  if (segments[0]!.toLocaleLowerCase() === TEAM_FILES_TRASH_DIRECTORY && options.allowTrash !== true) throw trashReserved(value);
  return segments.join('/');
}

/**
 * One rooted directory. It never accepts a relative path that was not
 * normalized first, and it resolves symbolic links before every operation so a
 * link created inside the directory cannot reach outside it or into the trash.
 */
export class TeamFileRoot {
  constructor(private readonly directory: string) {
    if (!path.isAbsolute(directory)) throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'The team files directory is not an absolute path.', { path: directory });
  }

  get path(): string { return this.directory; }

  absolute(relative: string): string {
    return path.join(this.directory, ...relative.split('/'));
  }

  /**
   * The canonical directory itself. A missing directory is the caller's to
   * create. The directory must be a direct child of its bound location, so a
   * pre-existing symlink named like the owned directory cannot redirect every
   * tool to a folder the binding never covered.
   */
  async canonicalRoot(): Promise<string> {
    let resolved: string;
    try { resolved = await realpath(this.directory); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'The team files directory does not exist yet.', { path: this.directory });
      throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'The team files directory is not accessible.', { path: this.directory, code });
    }
    const parent = await realpath(path.dirname(this.directory)).catch(() => null);
    if (parent === null || !isWithinPath(parent, resolved) || folderIdentity(path.dirname(resolved)) !== folderIdentity(parent)) {
      throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'The team files directory must be a folder directly inside its bound location, not a redirect to another folder.', { path: this.directory });
    }
    return resolved;
  }

  /** The canonical path of an existing entry, or null when it does not exist. */
  async canonical(relative: string): Promise<string | null> {
    let resolved: string;
    try { resolved = await realpath(this.absolute(relative)); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      if (code === 'ELOOP') throw invalidPath(relative, 'it is a symbolic link loop.');
      throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'The team files directory cannot be read.', { path: relative, code });
    }
    await this.assertInside(relative, resolved);
    await this.assertReachable(relative, resolved);
    return resolved;
  }

  /** Refuse a resolved path that left the directory through a symbolic link. */
  async assertInside(relative: string, resolved: string): Promise<void> {
    const root = await this.canonicalRoot();
    if (!isWithinPath(root, resolved)) throw invalidPath(relative, 'it resolves outside the team files directory.');
  }

  /** Refuse a resolved path that is the trash or lies inside it, whatever its spelling. */
  async assertReachable(relative: string, resolved: string): Promise<void> {
    if (await this.isTrashPath(resolved)) throw trashReserved(relative);
  }

  /** The trash's canonical path, or null while it does not exist yet. */
  async trashRoot(): Promise<string | null> {
    const lexical = path.join(await this.canonicalRoot(), TEAM_FILES_TRASH_DIRECTORY);
    try { return await realpath(lexical); }
    catch { return null; }
  }

  /** Whether a canonical path is the trash itself or an entry inside it. */
  async isTrashPath(resolved: string): Promise<boolean> {
    const trash = await this.trashRoot();
    if (trash === null) return false;
    return isWithinPath(trash, resolved);
  }

  /**
   * Resolve the target of a write without mutating anything. Every existing
   * ancestor is validated, so a recursive directory creation that follows a
   * symbolic link can never happen outside the directory.
   */
  async resolveForWrite(relative: string): Promise<string> {
    const segments = relative.split('/');
    let current = await this.canonicalRoot();
    let index = 0;
    for (; index < segments.length - 1; index++) {
      const next = path.join(current, segments[index]!);
      const entry = await lstat(next).catch(() => null);
      if (entry === null) break;
      const resolved = entry.isSymbolicLink() ? await realpath(next).catch(() => next) : next;
      if (resolved !== next) {
        await this.assertInside(relative, resolved);
        await this.assertReachable(relative, resolved);
      }
      const stats = await lstat(resolved).catch(() => null);
      if (stats === null || !stats.isDirectory()) throw invalidPath(relative, 'a parent of it is not a folder.');
      current = resolved;
    }
    // The first missing ancestor ends the walk; everything below it is created
    // by the caller under a directory that was just validated.
    return path.join(current, ...segments.slice(index));
  }
}
