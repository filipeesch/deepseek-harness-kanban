import { access, constants, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SHARED_DOCUMENT_FILE, parseSharedDocument, serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../domain/sharing/document.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import {
  abbreviateHome,
  absoluteFolderPath,
  assertOutsideManagedRoot,
  createSuggestedFolder,
  folderIdentity,
  inspectFolder,
  resolveManagedRoot,
  suggestedFolderPath,
  type FolderPathOptions,
} from './local-folder-path.js';
import type { BindingCandidate, ProviderState, SharingProviderDescriptor } from './provider.js';
import type { SharedConfigStore, SharedDocumentSnapshot, StorageReview } from './store.js';
import { assertExpectedToken, assertWrittenToken } from './verified-write.js';

/** A partially written document is never named like the document itself. */
const TEMP_PREFIX = '.' + SHARED_DOCUMENT_FILE + '.';
const DOCUMENT_BASE = path.basename(SHARED_DOCUMENT_FILE, path.extname(SHARED_DOCUMENT_FILE));
const RENAME_ATTEMPTS = 4;
const READ_ATTEMPTS = 3;
const RENAME_BACKOFF_MS = 30;

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

/** Directory state persisted beside the binding: the observation of the bytes last read. */
function normalizeState(state: ProviderState): ProviderState {
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

export interface LocalFolderStoreOptions {
  directory: string;
  state: ProviderState;
  /** Test seam: the rename primitive, its backoff clock, and the document reader. */
  renameFile?: typeof rename;
  delay?: (ms: number) => Promise<void>;
  readDocument?: (file: string) => Promise<string>;
}

/** What identifies one version of the document on disk. */
interface Observation { mtimeMs: number; ctimeMs: number; size: number; ino: number }

/** A read is only trustworthy when the observation describes exactly those bytes. */
type ObservedRead =
  | { kind: 'absent' }
  | { kind: 'stable'; raw: string; observation: Observation }
  | { kind: 'unstable'; raw: string };

function sameObservation(left: Observation, right: Observation): boolean {
  return left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size && left.ino === right.ino;
}

/**
 * One Hub document in a directory that the user synchronizes with any desktop
 * client. It owns the whole-document read/write contract, the change
 * observation, and the conflict-copy review; it never touches another file.
 */
export class LocalFolderSharedConfigStore implements SharedConfigStore {
  private readonly stateValue: ProviderState;
  private readonly renameFile: typeof rename;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly readDocument: (file: string) => Promise<string>;
  private reviewValue: StorageReview | null = null;
  private ready: Promise<void> | undefined;

  constructor(private readonly options: LocalFolderStoreOptions) {
    this.stateValue = normalizeState(options.state);
    this.renameFile = options.renameFile ?? rename;
    this.delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.readDocument = options.readDocument ?? (file => readFile(file, 'utf8'));
  }

  private get documentPath(): string { return path.join(this.options.directory, SHARED_DOCUMENT_FILE); }

  state(): ProviderState { return { ...this.stateValue }; }

  review(): StorageReview | null { return this.reviewValue; }

  async ensure(): Promise<void> {
    if (this.ready === undefined) this.ready = this.prepare().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  private async prepare(): Promise<void> {
    let info;
    try { info = await stat(this.options.directory); }
    catch { throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder is not accessible.', { path: this.options.directory }); }
    if (!info.isDirectory()) throw new KanbanError('SHARING_FOLDER_NOT_DIRECTORY', 'The selected path is not a folder.', { path: this.options.directory });
    try { await access(this.options.directory, constants.W_OK); }
    catch { throw new KanbanError('SHARING_FOLDER_UNWRITABLE', 'The selected folder is not writable.', { path: this.options.directory }); }
    this.reviewValue = await this.detectConflictCopies();
  }

  private async detectConflictCopies(): Promise<StorageReview | null> {
    let entries: string[];
    try { entries = await readdir(this.options.directory); }
    catch { throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected folder is not accessible.', { path: this.options.directory }); }
    const files = entries
      .filter(name => name !== SHARED_DOCUMENT_FILE && !name.startsWith(TEMP_PREFIX) && name.startsWith(DOCUMENT_BASE))
      .sort();
    if (files.length === 0) return null;
    return {
      code: 'SHARING_CONFLICT_COPY',
      message: 'Another copy of the team document is in this folder: ' + files.join(', ') + '. Review the copies before synchronizing.',
      files,
    };
  }

  /** The document's current observation, or null when there is no document. */
  private async observe(): Promise<Observation | null> {
    try {
      const info = await stat(this.documentPath);
      if (!info.isFile()) return null;
      return { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size, ino: info.ino };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The team document cannot be inspected.', { path: this.options.directory, code });
    }
  }

  private unchanged(observed: Observation): boolean {
    return number(this.stateValue.mtimeMs) === observed.mtimeMs
      && number(this.stateValue.ctimeMs) === observed.ctimeMs
      && number(this.stateValue.size) === observed.size
      && number(this.stateValue.ino) === observed.ino;
  }

  /**
   * Remember the observation of the bytes that were just read. A remembered
   * observation is what lets the next check skip reading; remembering one that
   * describes a different version would make the cache authoritative for
   * content it never contained.
   */
  private remember(observed: Observation): void {
    this.stateValue.mtimeMs = observed.mtimeMs;
    this.stateValue.ctimeMs = observed.ctimeMs;
    this.stateValue.size = observed.size;
    this.stateValue.ino = observed.ino;
  }

  private forget(): void {
    delete this.stateValue.mtimeMs;
    delete this.stateValue.ctimeMs;
    delete this.stateValue.size;
    delete this.stateValue.ino;
  }

  /**
   * Read the document together with the observation that describes exactly
   * those bytes. The observation is taken before and after the read; when the
   * two differ another writer replaced the file during the read, and the bytes
   * cannot be paired with any observation.
   */
  private async readObserved(): Promise<ObservedRead> {
    let last: string | null = null;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const before = await this.observe();
      if (before === null) return { kind: 'absent' };
      let raw: string;
      try { raw = await this.readDocument(this.documentPath); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' };
        throw new KanbanError('SHARING_FOLDER_MISSING', 'The team document cannot be read.', { path: this.options.directory, code });
      }
      last = raw;
      const after = await this.observe();
      if (after !== null && sameObservation(before, after)) return { kind: 'stable', raw, observation: after };
    }
    return last === null ? { kind: 'absent' } : { kind: 'unstable', raw: last };
  }

  /**
   * The token of the document on disk, used only to decide whether a write may
   * proceed. It deliberately records no observation: the remembered
   * observation must keep describing the last document the caller received, so
   * that a refused write is followed by a real read instead of a cached one.
   */
  private async currentToken(): Promise<string | null> {
    const observed = await this.readObserved();
    if (observed.kind === 'absent') return null;
    if (observed.kind === 'unstable') {
      this.forget();
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The team document changed while it was being read. Review the team changes before retrying.');
    }
    return sharedDocumentToken(parseSharedDocument(observed.raw));
  }

  async read(signal?: AbortSignal, cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null> {
    signal?.throwIfAborted();
    await this.ensure();
    const hint = await this.observe();
    if (hint === null) { this.forget(); return null; }
    if (cached && this.unchanged(hint)) return cached;
    signal?.throwIfAborted();
    const observed = await this.readObserved();
    if (observed.kind === 'absent') { this.forget(); return null; }
    const document = parseSharedDocument(observed.raw);
    // A version read while another writer replaced it gets no observation, so
    // the next check reads again instead of trusting this snapshot.
    if (observed.kind === 'stable') this.remember(observed.observation); else this.forget();
    return { token: sharedDocumentToken(document), document };
  }

  async write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    await this.ensure();
    const token = sharedDocumentToken(document);
    const text = serializeSharedDocument(document);
    assertExpectedToken(options.expectedToken, await this.currentToken());
    signal?.throwIfAborted();
    await this.replace(text);
    // A missing document after the write is a concurrent change too, not a success.
    assertWrittenToken(token, (await this.verify()) ?? '');
    return { token };
  }

  /** Replace the document through a temporary sibling so no reader sees a partial file. */
  private async replace(text: string): Promise<void> {
    const temporary = path.join(this.options.directory, TEMP_PREFIX + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, text, 'utf8');
      await this.renameWithRetry(temporary, this.documentPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof KanbanError) throw error;
      throw new KanbanError('SHARING_FAILED', 'The team document could not be written.', { path: this.options.directory, cause: error instanceof Error ? error.message : String(error) });
    }
  }

  /** A sync client, an antivirus, or an indexer can hold the file briefly. */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await this.renameFile(from, to); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code === 'EBUSY' || code === 'EPERM') && attempt < RENAME_ATTEMPTS - 1) { await this.delay(RENAME_BACKOFF_MS * (attempt + 1)); continue; }
        throw error;
      }
    }
  }

  /**
   * Verify what is on disk after a write. The document was replaced during the
   * verification when the observation does not describe the bytes read, so
   * neither an unstable read nor a missing document can be reported as success.
   */
  private async verify(): Promise<string | null> {
    const observed = await this.readObserved();
    if (observed.kind !== 'stable') { this.forget(); return null; }
    this.remember(observed.observation);
    return sharedDocumentToken(parseSharedDocument(observed.raw));
  }

  async destroy(): Promise<void> {
    // The folder and the document belong to the team; disconnecting never deletes them.
  }
}

export interface LocalFolderProviderOptions extends FolderPathOptions {
  /** A directory the plugin owns and never accepts as a team storage. */
  managedRoot?: string;
}

/** The local folder descriptor: continuous synchronization over one directory, no account. */
export function createLocalFolderProviderDescriptor(options: LocalFolderProviderOptions = {}): SharingProviderDescriptor {
  const pathOptions: FolderPathOptions = {
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  };
  return {
    id: 'local-folder',
    label: 'Local folder',
    syncMode: 'continuous',
    defaultIntervalMinutes: 1,
    requiresAuthorization: false,
    normalizeSettings(settings) {
      const value = (settings.path ?? settings.folder ?? settings.address ?? '').trim();
      if (value.length === 0) throw new KanbanError('INVALID_INPUT', 'A folder path is required.');
      if (value.length > 4096 || /[\0\r\n]/.test(value)) throw new KanbanError('INVALID_INPUT', 'The folder path is not valid.');
      return { path: value };
    },
    describe(binding) {
      const value = text(binding.settings.path);
      if (value === undefined) return '';
      return abbreviateHome(absoluteFolderPath(value, pathOptions), options.home ?? os.homedir());
    },
    async prepareBinding(candidate: BindingCandidate, existing: readonly BindingCandidate[]) {
      const received = absoluteFolderPath(candidate.settings.path ?? '', pathOptions);
      const suggested = suggestedFolderPath(candidate.hubId, pathOptions);
      // Only the location the plugin itself proposed may be created on connect.
      if (folderIdentity(received, options.platform) === folderIdentity(suggested, options.platform)) await createSuggestedFolder(candidate.hubId, pathOptions);
      const inspected = await inspectFolder(received, pathOptions);
      assertOutsideManagedRoot(inspected.path, await resolveManagedRoot(options.managedRoot));
      const identityOf = (value: string | undefined): string => folderIdentity(absoluteFolderPath(value ?? '', pathOptions), options.platform);
      const occupied = existing.find(record => record.hubId !== candidate.hubId && record.provider === 'local-folder' && identityOf(record.settings.path) === inspected.identity);
      invariant(!occupied, 'SHARING_ADDRESS_IN_USE', 'The selected folder is already bound to another Hub.');
      return { path: inspected.path };
    },
    createStore(hubId, binding, state) {
      if (binding.provider !== 'local-folder') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not a local folder.', { provider: binding.provider });
      const directory = text(binding.settings.path);
      if (directory === undefined) throw new KanbanError('INVALID_INPUT', 'A folder path is required.');
      return new LocalFolderSharedConfigStore({ directory, state });
    },
    normalizeState,
  };
}
