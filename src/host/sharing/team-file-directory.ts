import { link, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_TRASH_DIRECTORY } from '../../shared/types.js';
import { folderIdentity, isWithinPath } from '../paths.js';
import { TeamFileRoot } from '../team-files/root.js';
import type { TeamFileContent, TeamFileEntry, TeamFileReadOptions, TeamFileStore, TeamFileWrite, TeamFileWriteOptions } from './team-file-store.js';

/** A partially written file is never visible under the name it will take. */
const TEMP_PREFIX = '.team-file.';
const COLLISION_ATTEMPTS = 1000;

function unavailable(detail: string, cause?: unknown): KanbanError {
  return new KanbanError('TEAM_FILES_UNAVAILABLE', detail, { ...(cause === undefined ? {} : { cause: cause instanceof Error ? cause.message : String(cause) }) });
}

function writeFailed(relative: string, cause?: unknown): KanbanError {
  return new KanbanError('TEAM_FILE_WRITE_FAILED', 'The team file "' + relative + '" could not be written.', { path: relative, ...(cause === undefined ? {} : { cause: cause instanceof Error ? cause.message : String(cause) }) });
}

function tooLarge(relative: string, size: number, maxBytes: number): KanbanError {
  return new KanbanError('TEAM_FILE_TOO_LARGE', 'The team file "' + relative + '" is ' + size + ' bytes, over the ' + maxBytes + '-byte limit for a text file.', { path: relative, size, maxBytes });
}

/**
 * The filesystem mechanics of one owned team files directory: recursive
 * listing, byte reads, an atomic replace, and a non-overwriting move. It works
 * on canonical paths only and never touches an entry outside the directory.
 */
export interface TeamFileDirectoryOptions {
  /** Test seam for the destination search; a real deletion never needs more than a few. */
  collisionAttempts?: number;
}

export class TeamFileDirectory {
  private readonly root: TeamFileRoot;
  private readonly collisionAttempts: number;

  constructor(directory: string, options: TeamFileDirectoryOptions = {}) {
    this.root = new TeamFileRoot(directory);
    this.collisionAttempts = options.collisionAttempts ?? COLLISION_ATTEMPTS;
  }

  get path(): string { return this.root.path; }
  get teamRoot(): TeamFileRoot { return this.root; }

  /** Create the owned directory when it is absent; the bound folder itself must exist. */
  async ensure(): Promise<void> {
    const parent = path.dirname(this.root.path);
    let info;
    try { info = await stat(parent); }
    catch (error) { throw unavailable('The team storage location is not accessible.', error); }
    if (!info.isDirectory()) throw unavailable('The team storage location is not a folder.');
    try { await mkdir(this.root.path, { recursive: true }); }
    catch (error) { throw unavailable('The team files directory could not be created.', error); }
  }

  /** Every text-ready file below the directory, ordered by path, trash excluded. */
  async list(): Promise<TeamFileEntry[]> {
    // An absent directory is empty; a directory that exists but redirects is a
    // refusal, so only the absent case is answered with an empty listing.
    if (await lstat(this.root.path).catch(() => null) === null) return [];
    const canonicalRoot = await this.root.canonicalRoot();
    // The trash identity is canonical, so a link that aliases it is excluded too.
    const trash = (await this.root.trashRoot()) ?? path.join(canonicalRoot, TEAM_FILES_TRASH_DIRECTORY);
    const entries: TeamFileEntry[] = [];
    await this.walk(canonicalRoot, trash, canonicalRoot, '', entries, new Set([canonicalRoot]));
    return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  }

  private async walk(canonicalRoot: string, trash: string, directory: string, prefix: string, entries: TeamFileEntry[], visited: Set<string>): Promise<void> {
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); }
    catch (error) { throw unavailable('The team files directory cannot be listed.', error); }
    for (const item of items) {
      if (item.name.startsWith(TEMP_PREFIX)) continue;
      const relative = prefix.length === 0 ? item.name : prefix + '/' + item.name;
      // The trash is never reachable, whatever its spelling or an alias calls it.
      if (prefix.length === 0 && folderIdentity(item.name) === folderIdentity(TEAM_FILES_TRASH_DIRECTORY)) continue;
      let resolved = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        try { resolved = await realpath(resolved); }
        catch { continue; }
        if (!isWithinPath(canonicalRoot, resolved)) continue;
        if (isWithinPath(trash, resolved)) continue;
      }
      let info;
      try { info = await stat(resolved); }
      catch { continue; }
      if (info.isDirectory()) {
        if (visited.has(resolved)) continue;
        visited.add(resolved);
        await this.walk(canonicalRoot, trash, resolved, relative, entries, visited);
        continue;
      }
      if (!info.isFile()) continue;
      entries.push({ path: relative, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
  }

  async read(relative: string, options: TeamFileReadOptions = {}): Promise<TeamFileContent | null> {
    const canonical = await this.root.canonical(relative);
    if (canonical === null) return null;
    let info;
    try { info = await stat(canonical); }
    catch { return null; }
    if (!info.isFile()) return null;
    if (options.maxBytes !== undefined && info.size > options.maxBytes) throw tooLarge(relative, info.size, options.maxBytes);
    let bytes: Buffer;
    try { bytes = await readFile(canonical); }
    catch (error) { throw unavailable('The team file "' + relative + '" cannot be read.', error); }
    return { path: relative, bytes, size: info.size, modifiedAt: info.mtime.toISOString() };
  }

  /**
   * Create a file that must not exist. The temporary file is linked into place,
   * which fails when the name is taken instead of replacing it, so a concurrent
   * create, an existing temporary file, or another spelling that resolves to the
   * same entry can never be overwritten.
   */
  async create(relative: string, content: string): Promise<TeamFileWrite> {
    const target = await this.root.resolveForWrite(relative);
    const parent = path.dirname(target);
    let canonicalParent: string;
    try {
      await mkdir(parent, { recursive: true });
      canonicalParent = await realpath(parent);
    } catch (error) { throw writeFailed(relative, error); }
    await this.root.assertInside(relative, canonicalParent);
    await this.root.assertReachable(relative, canonicalParent);
    const file = path.join(canonicalParent, path.basename(target));
    const temporary = path.join(canonicalParent, TEMP_PREFIX + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, content, 'utf8');
      await link(temporary, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new KanbanError('TEAM_FILE_EXISTS', 'The team file "' + relative + '" already exists. Use edit_team_file to change it.', { path: relative });
      throw writeFailed(relative, error);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    const info = await stat(file).catch(() => null);
    return { path: relative, size: info?.size ?? Buffer.byteLength(content, 'utf8') };
  }

  async write(relative: string, content: string): Promise<TeamFileWrite> {
    // Every existing ancestor is validated before a directory is created, so a
    // symlink that escapes the directory never receives a new entry.
    const target = await this.root.resolveForWrite(relative);
    const parent = path.dirname(target);
    let canonicalParent: string;
    try {
      await mkdir(parent, { recursive: true });
      canonicalParent = await realpath(parent);
    } catch (error) { throw writeFailed(relative, error); }
    await this.root.assertInside(relative, canonicalParent);
    await this.root.assertReachable(relative, canonicalParent);
    const file = path.join(canonicalParent, path.basename(target));
    const existing = await lstat(file).catch(() => null);
    if (existing?.isDirectory()) throw new KanbanError('TEAM_FILE_NOT_FOUND', 'The team path "' + relative + '" is a directory, not a file.', { path: relative });
    if (existing?.isSymbolicLink()) throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file "' + relative + '" is a symbolic link and cannot be replaced.', { path: relative });
    const temporary = path.join(canonicalParent, TEMP_PREFIX + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, content, 'utf8');
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw writeFailed(relative, error);
    }
    const info = await stat(file).catch(() => null);
    return { path: relative, size: info?.size ?? Buffer.byteLength(content, 'utf8') };
  }

  /**
   * Move one existing file without ever replacing another entry. A hard link
   * fails when the destination exists, which a rename does not, and the trash
   * always lives on the same filesystem as the file it preserves.
   */
  async move(from: string, to: string): Promise<{ path: string }> {
    const canonicalFrom = await this.root.canonical(from);
    if (canonicalFrom === null) throw new KanbanError('TEAM_FILE_NOT_FOUND', 'The team file "' + from + '" does not exist.', { path: from });
    const info = await stat(canonicalFrom).catch(() => null);
    if (info === null || !info.isFile()) throw new KanbanError('TEAM_FILE_NOT_FOUND', 'The team path "' + from + '" is not a file.', { path: from });
    // A trash that is a symbolic link would send a deleted file somewhere the
    // plugin never chose, so it is refused rather than followed.
    if (to.split('/')[0] === TEAM_FILES_TRASH_DIRECTORY) {
      const entry = path.join(await this.root.canonicalRoot(), TEAM_FILES_TRASH_DIRECTORY);
      const info = await lstat(entry).catch(() => null);
      if (info?.isSymbolicLink()) throw new KanbanError('TEAM_FILE_WRITE_FAILED', 'The team files trash is a symbolic link; refusing to move a file into it.', { path: from });
    }
    const requested = await this.root.resolveForWrite(to);
    const parent = path.dirname(requested);
    let canonicalParent: string;
    try {
      await mkdir(parent, { recursive: true });
      canonicalParent = await realpath(parent);
    } catch (error) { throw writeFailed(to, error); }
    // The destination is the trash itself, so it is only required to stay inside
    // the owned directory; the source path is the one that must be reachable.
    await this.root.assertInside(to, canonicalParent);
    const destination = path.join(canonicalParent, path.basename(requested));
    let landed: string | undefined;
    for (let attempt = 1; attempt <= this.collisionAttempts && landed === undefined; attempt++) {
      const candidate = attempt === 1 ? destination : destination + '-' + attempt;
      try {
        await link(canonicalFrom, candidate);
        landed = candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw writeFailed(to, error);
      }
    }
    if (landed === undefined) throw new KanbanError('TEAM_FILE_WRITE_FAILED', 'No free destination exists for the deleted team file "' + from + '".', { path: from, destination });
    await rm(canonicalFrom).catch(error => { throw writeFailed(from, error); });
    const canonicalRoot = await this.root.canonicalRoot();
    return { path: path.relative(canonicalRoot, landed).split(path.sep).join('/') };
  }
}

/** The store a folder-backed binding publishes into: one owned directory, no transport. */
export class DirectoryTeamFileStore implements TeamFileStore {
  constructor(private readonly directory: TeamFileDirectory) {}

  /** The owned directory this store reads and writes. */
  get path(): string { return this.directory.path; }

  ensure(): Promise<void> { return this.directory.ensure(); }
  list(): Promise<TeamFileEntry[]> { return this.directory.list(); }
  read(relative: string, options?: TeamFileReadOptions): Promise<TeamFileContent | null> { return this.directory.read(relative, options); }
  create(relative: string, content: string): Promise<TeamFileWrite> { return this.directory.create(relative, content); }
  write(relative: string, content: string, _options: TeamFileWriteOptions): Promise<TeamFileWrite> { return this.directory.write(relative, content); }
  move(from: string, to: string, _options: TeamFileWriteOptions): Promise<{ path: string }> { return this.directory.move(from, to); }
}
