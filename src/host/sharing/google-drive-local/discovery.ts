import path from 'node:path';
import { SHARED_DOCUMENT_FILE } from '../../../domain/sharing/document.js';
import { KanbanError } from '../../../shared/errors.js';
import type { DriveBrowseView, DriveFolderEntry, DriveDiscoveryView, DriveLocationView } from '../../../shared/types.js';
import { folderIdentity, isWithinPath } from '../local-folder-path.js';
import { groupForFolderName } from './drive-labels.js';
import type { DiscoveryFs } from './filesystem.js';
import { projectDiscovery, type DriveMount } from './mounts.js';
import type { DriveDiscoveryAdapter } from './platform.js';

const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_MAX_ENTRIES = 500;
/** Extra entries read so files and bookkeeping entries cannot starve the page. */
const LIST_HEADROOM = 64;

/** Entries the Drive application keeps beside the account containers. */
const BOOKKEEPING_ENTRIES = new Set(['.shortcut-targets-by-id', '.Trash', '.tmp', '.file-revisions-by-id']);

export interface GoogleDriveLocalDiscoveryOptions {
  adapter: DriveDiscoveryAdapter;
  fs: DiscoveryFs;
  now?: () => number;
  cacheMs?: number;
  maxEntries?: number;
}

export interface LocatedDriveFolder {
  location: DriveLocationView;
  /** The canonical path, with symbolic links resolved. */
  path: string;
}

function platformOf(adapter: DriveDiscoveryAdapter): NodeJS.Platform {
  return adapter.model === 'macos' ? 'darwin' : adapter.model === 'windows' ? 'win32' : 'linux';
}

function driveError(code: string, message: string, details: Record<string, unknown> = {}): KanbanError {
  return new KanbanError(code, message, details);
}

/**
 * Device-scoped discovery and browsing for Google Drive for desktop. It reads
 * local evidence only, caches the result briefly, and confines every listing to
 * a discovered location.
 */
export class GoogleDriveLocalDiscovery {
  private readonly now: () => number;
  private readonly cacheMs: number;
  private readonly maxEntries: number;
  private cached: { at: number; view: DriveDiscoveryView } | undefined;

  constructor(private readonly options: GoogleDriveLocalDiscoveryOptions) {
    this.now = options.now ?? (() => Date.now());
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get platform(): NodeJS.Platform { return platformOf(this.options.adapter); }

  /** Path rules follow the discovered platform, not the host running the tests. */
  private get paths(): typeof path { return this.platform === 'win32' ? path.win32 : path.posix; }

  async roots(): Promise<DriveDiscoveryView> {
    if (this.cached !== undefined && this.now() - this.cached.at < this.cacheMs) return this.cached.view;
    return this.refresh();
  }

  /** Re-read every local source, bypassing the cache. */
  async refresh(): Promise<DriveDiscoveryView> {
    const evidence = await this.options.adapter.discover();
    const locations: DriveLocationView[] = [];
    const byIdentity = new Map<string, number>();
    for (const mount of evidence.mounts) {
      const canonical = await this.options.fs.realpath(mount.rootPath);
      const location = await this.projectMount({ ...mount, id: canonical, rootPath: canonical });
      const identity = folderIdentity(canonical, this.platform);
      const index = byIdentity.get(identity);
      if (index === undefined) {
        byIdentity.set(identity, locations.length);
        locations.push(location);
        continue;
      }
      // Two sources described one root: keep the available label and fill gaps.
      const existing = locations[index]!;
      const available = existing.status === 'available' || location.status === 'available';
      const merged: DriveLocationView = {
        ...existing,
        status: available ? 'available' : 'unavailable',
        ...(existing.account === undefined && location.account !== undefined ? { account: location.account } : {}),
        ...(existing.driveName === undefined && location.driveName !== undefined ? { driveName: location.driveName } : {}),
      };
      if (available) delete merged.reason;
      locations[index] = merged;
    }
    const view = projectDiscovery(evidence, locations);
    this.cached = { at: this.now(), view };
    return view;
  }

  /** The discovered location that contains a path, after resolving symbolic links. */
  async locate(value: string): Promise<LocatedDriveFolder | undefined> {
    const view = await this.roots();
    const resolved = await this.options.fs.realpath(value);
    for (const location of view.locations) {
      const root = await this.options.fs.realpath(location.rootPath);
      if (isWithinPath(root, resolved, this.platform)) return { location, path: resolved };
    }
    return undefined;
  }

  /**
   * List one folder level inside a discovered location. Only directories are
   * returned; nothing is written, and `..` or a symbolic link cannot escape the
   * location because the request is resolved first and compared against it.
   */
  async browse(value: string): Promise<DriveBrowseView> {
    const located = await this.locate(value);
    if (located === undefined) throw driveError('SHARING_DRIVE_BROWSE_REFUSED', 'That folder is not inside a discovered Google Drive location.', { path: value });
    if (located.location.status === 'unavailable') throw driveError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'That Google Drive location is not available.', { path: value, root: located.location.rootPath });
    const rootPath = located.location.rootPath;
    const atRoot = folderIdentity(located.path, this.platform) === folderIdentity(rootPath, this.platform);
    let listing;
    try { listing = await this.options.fs.list(located.path, this.maxEntries + LIST_HEADROOM); }
    catch (error) { throw this.listFailure(error, located.path); }
    // The Drive application places its own bookkeeping folders beside the
    // account containers; only those known entries are hidden, and only there.
    const folders = listing.entries
      .filter(entry => entry.directory && !(atRoot && BOOKKEEPING_ENTRIES.has(entry.name)))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));
    const shown = folders.slice(0, this.maxEntries);
    const folderEntries: DriveFolderEntry[] = shown.map(name => {
      const group = atRoot ? groupForFolderName(name) : undefined;
      return { name, path: this.paths.join(located.path, name), ...(group === undefined ? {} : { group }) };
    });
    return {
      rootId: located.location.id,
      path: located.path,
      parent: atRoot ? null : this.paths.dirname(located.path),
      entries: folderEntries,
      hasDocument: listing.entries.some(entry => !entry.directory && entry.name === SHARED_DOCUMENT_FILE),
      truncated: listing.truncated || folders.length > shown.length,
      shown: folderEntries.length,
    };
  }

  private async projectMount(mount: DriveMount): Promise<DriveLocationView> {
    const available = await this.options.fs.isDirectory(mount.rootPath);
    return {
      id: mount.id,
      rootPath: mount.rootPath,
      kind: mount.kind,
      status: available ? 'available' : 'unavailable',
      ...(mount.account === undefined ? {} : { account: mount.account }),
      ...(mount.driveName === undefined ? {} : { driveName: mount.driveName }),
      ...(available ? {} : { reason: mount.reason ?? 'The Google Drive location is not mounted on this machine.' }),
    };
  }

  private listFailure(error: unknown, value: string): KanbanError {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return driveError('SHARING_DRIVE_PERMISSION_DENIED', 'The operating system denied access to that Google Drive folder.', { path: value, code });
    if (code === 'ENOENT' || code === 'ENOTDIR') return driveError('SHARING_FOLDER_MISSING', 'That Google Drive folder does not exist.', { path: value, code });
    return driveError('SHARING_DRIVE_BROWSE_FAILED', 'That Google Drive folder could not be read.', { path: value, code, cause: error instanceof Error ? error.message : String(error) });
  }
}
