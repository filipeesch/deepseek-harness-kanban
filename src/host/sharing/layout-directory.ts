import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { KanbanError } from '../../shared/errors.js';
import {
  boardLogPath, readSharedConfiguration, serializeSharedManifest, sharedManifestToken,
  SHARED_BOARD_DIRECTORY, SHARED_MANIFEST_FILE, type SharedHubManifest,
} from '../../domain/sharing/manifest.js';
import { appendEvents, BOARD_LOG_VERSION, createBoardLog, decodeBoardLog, encodeBoardLog, headToken, type BoardLogFile } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import type { AppendOptions, BoardLogSnapshot, ManifestSnapshot, SharedLayoutStore } from './ports.js';
import type { StorageReview } from './ports.js';

/**
 * The published layout in a directory: the manifest beside a directory of board
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

  private get manifestPath(): string { return path.join(this.options.directory, SHARED_MANIFEST_FILE); }

  private logPath(key: string): string {
    return path.join(this.options.directory, SHARED_BOARD_DIRECTORY, key + '.yaml');
  }

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

  /** A copy of the manifest a synchronization client left beside it requires a decision. */
  private async detectConflictCopies(): Promise<StorageReview | null> {
    let entries: string[];
    try { entries = await readdir(this.options.directory); }
    catch { throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder is not accessible.', { path: this.options.directory }); }
    const base = path.basename(SHARED_MANIFEST_FILE, path.extname(SHARED_MANIFEST_FILE));
    const files = entries
      .filter(name => name !== SHARED_MANIFEST_FILE && !name.startsWith(TEMP_PREFIX) && name.startsWith(base))
      .sort();
    if (files.length === 0) return null;
    return {
      code: 'SHARING_CONFLICT_COPY',
      message: 'Another copy of the team configuration is in this folder: ' + files.join(', ') + '. Review the copies before synchronizing.',
      files,
    };
  }

  async readManifest(_signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null> {
    const text = await this.readOptional(this.manifestPath);
    if (text === null) return null;
    const read = readSharedConfiguration(text);
    const token = sharedManifestToken(read.manifest);
    if (cached !== null && cached !== undefined && cached.token === token) return cached;
    return { token, manifest: read.manifest, legacyWorkflows: read.legacyWorkflows };
  }

  async writeManifest(manifest: SharedHubManifest, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    await this.ensure();
    const current = await this.readManifest();
    if ((current?.token ?? null) !== options.expectedToken) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedToken ?? 'none', actual: current?.token ?? 'none' });
    }
    const token = sharedManifestToken(manifest);
    await this.writeAtomically(this.manifestPath, serializeSharedManifest(manifest));
    const verified = await this.readManifest();
    if (verified?.token !== token) throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The team configuration changed while it was being written. Review the team changes before retrying.');
    return { token };
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

  async readLog(key: string, signal?: AbortSignal, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null> {
    signal?.throwIfAborted();
    const probe = await this.probe(key, signal);
    if (probe === null) return null;
    if (cached !== null && cached !== undefined && cached.probe === probe) return cached;
    const text = await this.readOptional(this.logPath(key));
    if (text === null) return null;
    const log = this.parseLog(text, key);
    return { probe, head: headToken(log), log };
  }

  async createLog(key: string, text: string, signal?: AbortSignal): Promise<BoardLogSnapshot> {
    signal?.throwIfAborted();
    await this.ensure();
    if (await this.probe(key) !== null) throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    const log = createBoardLog(text);
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

  async removeLog(key: string): Promise<void> {
    await rm(this.logPath(key), { force: true });
  }

  async destroy(): Promise<void> {
    // The folder and the published layout belong to the team; disconnecting never deletes them.
  }

  private parseLog(text: string, key: string): BoardLogFile {
    let raw: unknown;
    try { raw = parseYaml(text); }
    catch (error) { throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is not valid YAML.', { key, cause: error instanceof Error ? error.message : String(error) }); }
    const decoded = decodeBoardLog(raw);
    if (!decoded.ok) {
      if (decoded.reason === 'unsupported-version') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { key, version: decoded.version });
      if (decoded.reason === 'unknown-kind') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration carries a change this plugin does not know. Update the plugin to read or publish it.', { key, kind: decoded.kind });
      throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
    }
    return decoded.log;
  }

  private async writeLog(key: string, log: BoardLogFile): Promise<void> {
    const directory = path.join(this.options.directory, SHARED_BOARD_DIRECTORY);
    try { await mkdir(directory, { recursive: true }); }
    catch (error) { throw new KanbanError('SHARING_FOLDER_MISSING', 'The board log directory cannot be created.', { path: directory, cause: error instanceof Error ? error.message : String(error) }); }
    await this.writeAtomically(this.logPath(key), stringifyYaml(encodeBoardLog(log), { lineWidth: 0 }));
    if (log.version !== BOARD_LOG_VERSION) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log version is not supported.');
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

/** The observation state a directory provider persists, kept for the provider descriptor. */
export function normalizeDirectoryLayoutState(state: Record<string, unknown>): Record<string, unknown> {
  const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const mtimeMs = number(state.mtimeMs);
  const ctimeMs = number(state.ctimeMs);
  const size = number(state.size);
  const ino = number(state.ino);
  return {
    ...(mtimeMs === undefined ? {} : { mtimeMs }),
    ...(ctimeMs === undefined ? {} : { ctimeMs }),
    ...(size === undefined ? {} : { size }),
    ...(ino === undefined ? {} : { ino }),
  };
}

/** The published layout path of one board, for a provider that needs to name the file itself. */
export { boardLogPath };
