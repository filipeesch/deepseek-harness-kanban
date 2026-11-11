import { stringify as stringifyYaml } from 'yaml';
import { KanbanError } from '../../shared/errors.js';
import {
  readSharedConfiguration, serializeSharedManifest, sharedManifestToken, type SharedHubManifest,
} from '../../domain/sharing/manifest.js';
import { appendEvents, createBoardLog, headToken, readBoardLogText, type BoardLogFile } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import { GoogleDriveClient, type GoogleDriveFile } from './google-drive-client.js';
import type { ProviderState } from './provider.js';
import type { AppendOptions, BoardLogSnapshot, ManifestSnapshot, SharedLayoutStore } from './ports.js';

/**
 * The published layout in a Google Drive Cloud folder.
 *
 * Drive has no directories to speak of, so the manifest keeps its name and each
 * board log is a sibling file named for its board key. Every write is compared
 * before and verified after, because Drive offers no conditional write.
 */
export interface GoogleDriveLayoutStoreOptions {
  readonly client: GoogleDriveClient;
  readonly folderId: string;
  readonly driveId?: string;
  readonly state: ProviderState;
}

export const DRIVE_BOARD_FILE_PREFIX = 'kanban-board-';

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

function normalizeState(state: ProviderState): ProviderState {
  const boardFileIds: Record<string, string> = {};
  const raw = state.boardFileIds;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) boardFileIds[key] = value;
    }
  }
  return {
    ...(text(state.manifestFileId) ? { manifestFileId: text(state.manifestFileId) } : {}),
    ...(text(state.driveId) ? { driveId: text(state.driveId) } : {}),
    ...(Object.keys(boardFileIds).length === 0 ? {} : { boardFileIds }),
  };
}

/** The file name one board's log takes in the bound folder. */
export function driveBoardFileName(key: string): string {
  return DRIVE_BOARD_FILE_PREFIX + key + '.yaml';
}

export class GoogleDriveLayoutStore implements SharedLayoutStore {
  private readonly stateValue: ProviderState;
  private folderChecked = false;

  constructor(private readonly options: GoogleDriveLayoutStoreOptions) {
    this.stateValue = normalizeState(options.state);
    if (options.driveId) this.stateValue.driveId = options.driveId;
  }

  state(): ProviderState { return { ...this.stateValue, ...(this.boardFileIds().size === 0 ? {} : { boardFileIds: Object.fromEntries(this.boardFileIds()) }) }; }

  review(): null { return null; }

  async destroy(): Promise<void> {
    // The folder and the published layout belong to the team; disconnecting never deletes them.
  }

  private get client(): GoogleDriveClient { return this.options.client; }
  private get folderId(): string { return this.options.folderId; }
  private get driveId(): string | undefined { return text(this.stateValue.driveId); }
  private get manifestFileId(): string | undefined { return text(this.stateValue.manifestFileId); }

  private boardFileIds(): Map<string, string> {
    const raw = this.stateValue.boardFileIds;
    const result = new Map<string, string>();
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) if (typeof value === 'string') result.set(key, value);
    }
    return result;
  }

  private rememberBoardFile(key: string, fileId: string): void {
    this.stateValue.boardFileIds = Object.fromEntries(new Map([...this.boardFileIds(), [key, fileId]]));
  }

  async ensure(): Promise<void> {
    if (!this.folderChecked) {
      this.folderChecked = true;
      try {
        const folder = await this.client.getFile(this.folderId);
        if (folder.driveId) this.stateValue.driveId = folder.driveId;
      } catch (error) {
        if (error instanceof KanbanError && error.code === 'SHARING_DOCUMENT_MISSING') {
          throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected Google Drive folder is not accessible.', { folderId: this.folderId });
        }
        throw error;
      }
    }
    const fileId = this.manifestFileId;
    if (fileId !== undefined) {
      const file = await this.client.getFile(fileId);
      if (file.trashed === true) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration is in the Drive trash.');
      return;
    }
    const found = await this.client.findDocument(this.folderId, this.driveId);
    if (found !== null) this.stateValue.manifestFileId = found.id;
  }

  async readManifest(_signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null> {
    await this.ensure();
    const fileId = this.manifestFileId;
    if (fileId === undefined) return null;
    const content = await this.client.getContent(fileId);
    const read = readSharedConfiguration(content.content);
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
    const serialized = serializeSharedManifest(manifest);
    const fileId = this.manifestFileId;
    if (fileId === undefined) {
      const created = await this.client.createFile(this.folderId, 'kanban-hub.yaml', serialized);
      this.stateValue.manifestFileId = created.id;
    } else {
      await this.client.updateContent(fileId, serialized);
    }
    // Verify what is stored, because Drive offers no conditional write.
    const verified = await this.client.getContent(this.manifestFileId!);
    if (sharedManifestToken(readSharedConfiguration(verified.content).manifest) !== token) {
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The team configuration changed while it was being written. Review the team changes before retrying.');
    }
    return { token };
  }

  /** The file that holds one board's log, found by id or adopted by name. */
  private async boardFile(key: string): Promise<GoogleDriveFile | null> {
    const known = this.boardFileIds().get(key);
    if (known !== undefined) {
      const file = await this.client.getFile(known);
      return file.trashed === true ? null : file;
    }
    const found = await this.client.findFile(this.folderId, driveBoardFileName(key), this.driveId);
    if (found !== null) this.rememberBoardFile(key, found.id);
    return found;
  }

  async probe(key: string): Promise<string | null> {
    await this.ensure();
    const file = await this.boardFile(key);
    return file === null ? null : (file.headRevisionId ?? file.id);
  }

  async readLog(key: string, _signal?: AbortSignal, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null> {
    await this.ensure();
    const file = await this.boardFile(key);
    if (file === null) return null;
    const probe = file.headRevisionId ?? file.id;
    if (cached !== null && cached !== undefined && cached.probe === probe) return cached;
    const content = await this.client.getContent(file.id);
    const log = this.parse(content.content, key);
    return { probe, head: headToken(log), log };
  }

  async createLog(key: string, text: string, signal?: AbortSignal): Promise<BoardLogSnapshot> {
    signal?.throwIfAborted();
    await this.ensure();
    if (await this.boardFile(key) !== null) throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    const log = createBoardLog(text);
    const created = await this.client.createFile(this.folderId, driveBoardFileName(key), this.serialize(log));
    this.rememberBoardFile(key, created.id);
    return { probe: created.headRevisionId ?? created.id, head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    options.signal?.throwIfAborted();
    const current = await this.readLog(key, options.signal);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.', { key });
    if (current.head !== options.expectedHead) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key, expected: options.expectedHead ?? 'none', actual: current.head });
    }
    const log = appendEvents(current.log, changes, options.at);
    const file = await this.boardFile(key);
    const written = await this.client.updateContent(file!.id, this.serialize(log));
    // Verify the head that landed, because two writers can race on one file.
    const content = await this.client.getContent(file!.id);
    if (headToken(this.parse(content.content, key)) !== headToken(log)) {
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The board changed while it was being written. Review the team changes before retrying.', { key });
    }
    return { probe: written.headRevisionId ?? file!.id, head: headToken(log), log };
  }

  async removeLog(): Promise<void> {
    // Drive keeps the file: the manifest stops naming the board, which is what removes it.
  }

  private parse(text: string, key: string): BoardLogFile {
    const decoded = readBoardLogText(text);
    if (!decoded.ok) {
      if (decoded.reason === 'unsupported-version') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { key, version: decoded.version });
      if (decoded.reason === 'unknown-kind') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration carries a change this plugin does not know. Update the plugin to read or publish it.', { key, kind: decoded.kind });
      throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
    }
    return decoded.log;
  }

  private serialize(log: BoardLogFile): string {
    return stringifyYaml({ version: log.version, snapshot: { seq: log.snapshot.seq, text: log.snapshot.text }, events: log.events }, { lineWidth: 0 });
  }
}
