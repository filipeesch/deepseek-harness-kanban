import {
  DirectoryLayoutStore, type DirectoryLayoutStoreOptions,
} from '../layout-directory.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot } from '../ports.js';
import type { BoardChange } from '../../../domain/journal/event.js';
import type { BoardLog } from '../../../domain/journal/log.js';

/**
 * The published layout inside a Google Drive for desktop folder.
 *
 * It is the directory layout, and every operation re-proves that the folder is still
 * the mounted Drive location instead of a local path that happens to resolve.
 */
export class GoogleDriveLocalLayoutStore extends DirectoryLayoutStore {
  constructor(options: DirectoryLayoutStoreOptions, private readonly assertMount: () => Promise<void>) {
    super(options);
  }

  override async ensure(): Promise<void> {
    await this.assertMount();
    return super.ensure();
  }

  override async readStamp(): Promise<LayoutStampSnapshot | null> {
    await this.assertMount();
    return super.readStamp();
  }

  override async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    await this.assertMount();
    return super.writeStamp(version, options);
  }

  override async listLogs(): Promise<readonly { key: string; probe: string }[]> {
    await this.assertMount();
    return super.listLogs();
  }

  override async probe(key: string, signal?: AbortSignal): Promise<string | null> {
    await this.assertMount();
    return super.probe(key, signal);
  }

  override async readLog(key: string, signal?: AbortSignal): Promise<BoardLogSnapshot | null> {
    await this.assertMount();
    return super.readLog(key, signal);
  }

  override async createLog(key: string, log: BoardLog, signal?: AbortSignal): Promise<BoardLogSnapshot> {
    await this.assertMount();
    return super.createLog(key, log, signal);
  }

  override async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    await this.assertMount();
    return super.appendChanges(key, changes, options);
  }
}
