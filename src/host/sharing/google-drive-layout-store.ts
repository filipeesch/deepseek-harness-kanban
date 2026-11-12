import { KanbanError } from '../../shared/errors.js';
import {
  driveBoardFileName, readLayoutStamp, serializeLayoutStamp,
  DRIVE_BOARD_FILE_PREFIX, SHARED_LAYOUT_VERSION,
} from '../../domain/sharing/layout.js';
import { appendEvents, decodeBoardLog, encodeBoardLog, headToken, type BoardLog } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import { GoogleDriveClient, type GoogleDriveFile } from './google-drive-client.js';
import type { ProviderState } from './provider.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot, SharedLayoutStore } from './ports.js';

/**
 * The published layout in a Google Drive Cloud folder.
 *
 * Drive has no directories to speak of, so the stamp keeps its name and each board log
 * is a sibling file named for its board key. Every write is compared before and
 * verified after, because Drive offers no conditional write.
 */
export interface GoogleDriveLayoutStoreOptions {
  readonly client: GoogleDriveClient;
  readonly folderId: string;
  readonly driveId?: string;
  readonly state: ProviderState;
}

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
    ...(text(state.stampFileId) ? { stampFileId: text(state.stampFileId) } : {}),
    ...(text(state.driveId) ? { driveId: text(state.driveId) } : {}),
    ...(Object.keys(boardFileIds).length === 0 ? {} : { boardFileIds }),
  };
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
  private get stampFileId(): string | undefined { return text(this.stateValue.stampFileId); }

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
    const fileId = this.stampFileId;
    if (fileId !== undefined) {
      const file = await this.client.getFile(fileId);
      if (file.trashed === true) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration is in the Drive trash.');
      return;
    }
    const found = await this.client.findLayoutStamp(this.folderId, this.driveId);
    if (found !== null) this.stateValue.stampFileId = found.id;
  }

  async readStamp(): Promise<LayoutStampSnapshot | null> {
    await this.ensure();
    if (this.stampFileId === undefined) return null;
    const content = await this.client.getContent(this.stampFileId);
    return { version: readLayoutStamp(content.content).version };
  }

  async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    if (version !== SHARED_LAYOUT_VERSION) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'This installation writes a single layout version.');
    await this.ensure();
    const current = await this.readStamp();
    const actual = current?.version ?? null;
    if (actual !== options.expectedVersion) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed since it was read. Get the team updates before publishing.', { expected: options.expectedVersion ?? 'none', actual: actual ?? 'none' });
    }
    const serialized = serializeLayoutStamp();
    if (this.stampFileId === undefined) {
      const created = await this.client.createLayoutStamp(this.folderId, serialized);
      this.stateValue.stampFileId = created.id;
    } else {
      await this.client.updateContent(this.stampFileId, serialized);
    }
    // Verify what is stored, because Drive offers no conditional write.
    const verified = await this.client.getContent(this.stampFileId!);
    if (readLayoutStamp(verified.content).version !== version) {
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The team configuration changed while it was being written. Review the team changes before retrying.');
    }
    return { version };
  }

  async listLogs(): Promise<readonly { key: string; probe: string }[]> {
    await this.ensure();
    const files = await this.client.listFiles(this.folderId, DRIVE_BOARD_FILE_PREFIX, this.driveId);
    const listed: Array<{ key: string; probe: string }> = [];
    for (const file of files) {
      if (file.trashed === true) continue;
      const key = keyOf(file);
      if (key === null) continue;
      this.rememberBoardFile(key, file.id);
      listed.push({ key, probe: file.headRevisionId ?? file.id });
    }
    return listed;
  }

  async probe(key: string): Promise<string | null> {
    await this.ensure();
    const file = await this.boardFile(key);
    return file === null ? null : (file.headRevisionId ?? file.id);
  }

  async readLog(key: string): Promise<BoardLogSnapshot | null> {
    await this.ensure();
    const file = await this.boardFile(key);
    if (file === null) return null;
    const probe = file.headRevisionId ?? file.id;
    const content = await this.client.getContent(file.id);
    const log = parseLog(content.content, key);
    return { probe, head: headToken(log), log };
  }

  async createLog(key: string, log: BoardLog): Promise<BoardLogSnapshot> {
    await this.ensure();
    if (await this.boardFile(key) !== null) throw new KanbanError('SHARING_STALE_TOKEN', 'The board already has a published log.', { key });
    const created = await this.client.createFile(this.folderId, driveBoardFileName(key), encodeBoardLog(log));
    this.rememberBoardFile(key, created.id);
    return { probe: created.headRevisionId ?? created.id, head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    options.signal?.throwIfAborted();
    const current = await this.readLog(key);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.', { key });
    if (current.head !== options.expectedHead) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board changed since it was read. Get the team updates before publishing.', { key, expected: options.expectedHead ?? 'none', actual: current.head });
    }
    const log = appendEvents(current.log, changes, options.at);
    const file = await this.boardFile(key);
    const written = await this.client.updateContent(file!.id, encodeBoardLog(log));
    // Verify the head that landed, because two writers can race on one file.
    const content = await this.client.getContent(file!.id);
    if (headToken(parseLog(content.content, key)) !== headToken(log)) {
      throw new KanbanError('SHARING_CONCURRENT_WRITE', 'The board changed while it was being written. Review the team changes before retrying.', { key });
    }
    return { probe: written.headRevisionId ?? file!.id, head: headToken(log), log };
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
}

function keyOf(file: GoogleDriveFile): string | null {
  const name = file.name;
  if (typeof name !== 'string' || !name.startsWith(DRIVE_BOARD_FILE_PREFIX) || !name.endsWith('.jsonl')) return null;
  const key = name.slice(DRIVE_BOARD_FILE_PREFIX.length, -'.jsonl'.length);
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(key) ? key : null;
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
