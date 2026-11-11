import type { SharedHubManifest } from '../../../domain/sharing/manifest.js';
import { DirectoryLayoutStore, normalizeDirectoryLayoutState, type DirectoryLayoutStoreOptions } from '../layout-directory.js';
import type { AppendOptions, BoardLogSnapshot, ManifestSnapshot } from '../ports.js';
import type { BoardChange } from '../../../domain/journal/event.js';

export { normalizeDirectoryLayoutState };

/**
 * The published layout inside a Google Drive for desktop folder.
 *
 * It is the directory layout, and every operation re-proves that the folder is
 * still the mounted Drive location instead of a local path that happens to resolve.
 */
export class GoogleDriveLocalLayoutStore extends DirectoryLayoutStore {
  constructor(options: DirectoryLayoutStoreOptions, private readonly assertMount: () => Promise<void>) {
    super(options);
  }

  override async ensure(): Promise<void> {
    await this.assertMount();
    return super.ensure();
  }

  override async readManifest(signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null> {
    await this.assertMount();
    return super.readManifest(signal, cached);
  }

  override async writeManifest(manifest: SharedHubManifest, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    await this.assertMount();
    return super.writeManifest(manifest, options, signal);
  }

  override async probe(key: string, signal?: AbortSignal): Promise<string | null> {
    await this.assertMount();
    return super.probe(key, signal);
  }

  override async readLog(key: string, signal?: AbortSignal, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null> {
    await this.assertMount();
    return super.readLog(key, signal, cached);
  }

  override async createLog(key: string, text: string, signal?: AbortSignal): Promise<BoardLogSnapshot> {
    await this.assertMount();
    return super.createLog(key, text, signal);
  }

  override async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    await this.assertMount();
    return super.appendChanges(key, changes, options);
  }

  override async removeLog(key: string): Promise<void> {
    await this.assertMount();
    return super.removeLog(key);
  }
}
