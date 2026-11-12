import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError, invariant } from '../../shared/errors.js';
import {
  boardLogPath, readLayoutStamp, serializeLayoutStamp,
  SHARED_BOARD_DIRECTORY, SHARED_BOARD_EXTENSION, SHARED_BOARD_KEY_PATTERN, SHARED_LAYOUT_FILE, SHARED_LAYOUT_VERSION,
} from '../../domain/sharing/layout.js';
import { appendEvents, decodeBoardLog, encodeBoardLog, headToken, type BoardLog } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot, SharedLayoutStore, StorageReview } from './ports.js';

/**
 * The published layout in a directory: a layout stamp beside a directory of board
 * logs. It is the storage for a local folder and for a Google Drive Local folder,
 * which differ only in how the directory is discovered.
 */

const TEMP_PREFIX = '.kanban-';

export interface DirectoryLayoutStoreOptions {
  readonly directory: string;
  /** Test seam: reads one file, so a test can simulate a mid-read replacement. */
  readonly readFileText?: (file: string) => Promise<string>;
}

export class DirectoryLayoutStore implements SharedLayoutStore {
  private reviewValue: StorageReview | null = null;
  private ready: Promise<void> | undefined;
  private readonly readFileText: (file: string) => Promise<string>;

  constructor(private readonly options: DirectoryLayoutStoreOptions) {
    this.readFileText = options.readFileText ?? (file => readFile(file, 'utf8'));
  }

  protected get directory(): string { return this.options.directory; }

  private get stampPath(): string { return path.join(this.options.directory, SHARED_LAYOUT_FILE); }

  private get boardsPath(): string { return path.join(this.options.directory, SHARED_BOARD_DIRECTORY); }

  private logPath(key: string): string { return path.join(this.options.directory, boardLogPath(key)); }

  review(): StorageReview | null { return this.reviewValue; }

  state(): Record<string, unknown> { return {}; }

  async ensure(): Promise<void> {
    if (this.ready === undefined) this.ready = this.prepare().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  private async prepare(): Promise<void> {
    let info;
    try { info = await stat(this.options.directory); }
    catch { throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder is not accessible.', { path: this.options.directory }); }
    if (!info.isDirectory()) throw new KanbanError('SHARING_FOLDER_NOT_DIRECTORY', 'The selected path is not a folder.', { path: this.options.directory });
    this.reviewValue = await this.detectConflictCopies();
  }

  /** A copy of the stamp, or of a board log, that a synchronization client left behind. */
  private async detectConflictCopies(): Promise<StorageReview | null> {
    let entries: string[];
    try { entries = await readdir(this.options.directory); }
    catch { throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder is not accessible.', { path: this.options.directory }); }
    const base = path.basename(SHARED_LAYOUT_FILE, path.extname(SHARED_LAYOUT_FILE));
    const files = entries
      .filter(name => name !== SHARED_LAYOUT_FILE && !name.startsWith(TEMP_PREFIX) && name.startsWith(base))
      .sort();
    let boardCopies: string[] = [];
    try { boardCopies = (await readdir(this.boardsPath)).filter(name => looksLikeBoardCopy(name)).sort().map(name => SHARED_BOARD_DIRECTORY + '/' + name); }
    catch { /* the board directory may not exist yet */ }
    const found = [...files, ...boardCopies];
    if (found.length === 0) return null;
    return {
      code: 'SHARING_CONFLICT_COPY',
      message: 'Another copy of the team configuration is in this folder: ' + found.join(', ') + '. Review the copies before synchronizing.',
      files: found,
    };
  }

  async readStamp(): Promise<LayoutStampSnapshot | null> {
    const text = await this.readOptional(this.stampPath);
    return text === null ? null : { version: readLayoutStamp(text).version };
  }

  async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    invariant(version === SHARED_LAYOUT_VERSION, 'SHARING_INVALID_DOCUMENT', 'This installation writes a single layout version.');
    await this.ensure();
    const current = await this.readStamp();
    const actual = current?.version ?? null;
    if (actual !== options.expectedVersion) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedVersion ?? 'none', actual: actual ?? 'none' });
    }
    await this.writeAtomically(this.stampPath, serializeLayoutStamp());
    const verified = await this.readStamp();
    if (verified?.version !== version) throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The team configuration changed while it was being written. Review the team changes before retrying.');
    return { version };
  }

  async listLogs(): Promise<readonly { key: string; probe: string }[]> {
    await this.ensure();
    let names: string[];
    try { names = await readdir(this.boardsPath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The team configuration cannot be inspected.', { path: this.options.directory, code });
    }
    const listed: Array<{ key: string; probe: string }> = [];
    for (const name of names.sort()) {
      if (!name.endsWith(SHARED_BOARD_EXTENSION)) continue;
      const key = name.slice(0, -SHARED_BOARD_EXTENSION.length);
      if (!SHARED_BOARD_KEY_PATTERN.test(key)) continue;
      const probe = await this.probe(key);
      if (probe !== null) listed.push({ key, probe });
    }
    return listed;
  }

  async probe(key: string, signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted();
    const file = this.logPath(key);
    try {
      const info = await stat(file);
      return [info.mtimeMs, info.size, info.ino].join(':');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The team configuration cannot be inspected.', { path: this.options.directory, code });
    }
  }

  async readLog(key: string, signal?: AbortSignal): Promise<BoardLogSnapshot | null> {
    signal?.throwIfAborted();
    const probe = await this.probe(key, signal);
    if (probe === null) return null;
    const text = await this.readOptional(this.logPath(key));
    if (text === null) return null;
    const log = parseLog(text, key);
    return { probe, head: headToken(log), log };
  }

  async createLog(key: string, log: BoardLog, signal?: AbortSignal): Promise<BoardLogSnapshot> {
    signal?.throwIfAborted();
    await this.ensure();
    if (await this.probe(key) !== null) throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    await this.writeLog(key, log);
    const probe = await this.probe(key);
    return { probe: probe ?? '', head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    options.signal?.throwIfAborted();
    const current = await this.readLog(key, options.signal);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.', { key });
    if (current.head !== options.expectedHead) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key, expected: options.expectedHead ?? 'none', actual: current.head });
    }
    const log = appendEvents(current.log, changes, options.at);
    await this.writeLog(key, log);
    const probe = await this.probe(key);
    return { probe: probe ?? '', head: headToken(log), log };
  }

  async destroy(): Promise<void> {
    // The folder and the published layout belong to the team; disconnecting never deletes them.
  }

  private async writeLog(key: string, log: BoardLog): Promise<void> {
    const encoded = encodeBoardLog(log);
    if (!decodeBoardLog(encoded).ok) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log content is not supported.');
    try { await mkdir(this.boardsPath, { recursive: true }); }
    catch (error) { throw new KanbanError('SHARING_FOLDER_MISSING', 'The board log directory cannot be created.', { path: this.boardsPath, cause: error instanceof Error ? error.message : String(error) }); }
    await this.writeAtomically(this.logPath(key), encoded);
    // A folder offers no conditional write, so the written content is verified.
    const written = await this.readOptional(this.logPath(key));
    if (written === null || headToken(parseLog(written, key)) !== headToken(log)) {
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The board changed while it was being written. Review the team changes before retrying.', { key });
    }
  }

  private async readOptional(file: string): Promise<string | null> {
    try { return await this.readFileText(file); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The team configuration cannot be read.', { path: file, code });
    }
  }

  /** Replace one file through a temporary sibling, so no reader sees a partial file. */
  private async writeAtomically(file: string, text: string): Promise<void> {
    const temporary = path.join(path.dirname(file), TEMP_PREFIX + path.basename(file) + '.' + Math.random().toString(36).slice(2) + '.tmp');
    try {
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof KanbanError) throw error;
      throw new KanbanError('SHARING_FAILED', 'The team configuration could not be written.', { path: file, cause: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** A board-directory entry that is not a log the plugin wrote. */
function looksLikeBoardCopy(name: string): boolean {
  if (!name.endsWith(SHARED_BOARD_EXTENSION)) return false;
  if (name.startsWith(TEMP_PREFIX)) return false;
  const key = name.slice(0, -SHARED_BOARD_EXTENSION.length);
  return !SHARED_BOARD_KEY_PATTERN.test(key);
}

function parseLog(text: string, key: string): BoardLog {
  const decoded = decodeBoardLog(text);
  if (!decoded.ok) {
    if (decoded.reason === 'unsupported-version') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { key, version: decoded.version });
    if (decoded.reason === 'unknown-kind') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration carries a change this plugin does not know. Update the plugin to read or publish it.', { key, kind: decoded.kind });
    throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
  }
  return decoded.log;
}

/** The published layout path of one board, for a provider that needs to name the file itself. */
export { boardLogPath };