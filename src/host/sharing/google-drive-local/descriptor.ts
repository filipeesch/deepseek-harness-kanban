import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DriveDiscoveryView, DriveLocationView } from '../../../shared/types.js';
import { KanbanError, invariant } from '../../../shared/errors.js';
import { DirectorySharedConfigStore, normalizeDirectoryState, type DirectoryStoreOptions } from '../directory-store.js';
import {
  absoluteFolderPath,
  assertOutsideManagedRoot,
  folderIdentity,
  inspectFolder,
  isWithinPath,
  resolveManagedRoot,
  type FolderPathOptions,
} from '../local-folder-path.js';
import type { BindingCandidate, ProviderState, SharingProviderDescriptor } from '../provider.js';
import type { LocatedDriveFolder } from './discovery.js';

/** The discovery surface the descriptor and its store depend on. */
export interface DriveLocationResolver {
  locate(value: string): Promise<LocatedDriveFolder | undefined>;
  roots(): Promise<DriveDiscoveryView>;
  refresh(): Promise<DriveDiscoveryView>;
}

interface PathState { canonical?: string; isDirectory?: boolean; code?: string }

async function inspectCanonical(value: string): Promise<PathState> {
  try {
    const canonical = await realpath(value);
    const info = await stat(canonical);
    return { canonical, isDirectory: info.isDirectory() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ...(code === undefined ? {} : { code }) };
  }
}

function permissionDenied(value: string, cause?: string): KanbanError {
  return new KanbanError('SHARING_DRIVE_PERMISSION_DENIED', 'The operating system denied access to the selected Google Drive folder.', { path: value, ...(cause === undefined ? {} : { cause }) });
}

export interface GoogleDriveLocalStoreOptions extends DirectoryStoreOptions {
  /** The discovered location root the folder was selected in. */
  mountRoot: string;
  discovery: DriveLocationResolver;
  platform: NodeJS.Platform;
}

/**
 * A directory store that also proves its folder still belongs to the stored
 * Google Drive location. It re-resolves both paths before every operation, so a
 * folder replaced by an outward symlink can never be read or written, and it
 * refuses a location that discovery no longer reports.
 */
export class GoogleDriveLocalSharedConfigStore extends DirectorySharedConfigStore {
  constructor(private readonly driveOptions: GoogleDriveLocalStoreOptions) { super(driveOptions); }

  override async ensure(): Promise<void> {
    await this.assertMount();
    return super.ensure();
  }

  override async read(signal?: AbortSignal, cached?: Parameters<DirectorySharedConfigStore['read']>[1]): ReturnType<DirectorySharedConfigStore['read']> {
    await this.assertMount();
    return super.read(signal, cached);
  }

  override async write(document: Parameters<DirectorySharedConfigStore['write']>[0], options: Parameters<DirectorySharedConfigStore['write']>[1], signal?: AbortSignal): ReturnType<DirectorySharedConfigStore['write']> {
    await this.assertMount();
    return super.write(document, options, signal);
  }

  private async assertMount(): Promise<void> {
    const mount = this.driveOptions.mountRoot;
    const root = await inspectCanonical(mount);
    if (root.canonical === undefined || root.isDirectory !== true) {
      if (root.code === 'EACCES' || root.code === 'EPERM') throw permissionDenied(mount, root.code);
      await this.driveOptions.discovery.refresh().catch(() => undefined);
      throw new KanbanError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'The Google Drive location is no longer mounted on this machine.', { path: this.driveOptions.directory, mount });
    }
    const directory = this.driveOptions.directory;
    const folder = await inspectCanonical(directory);
    if (folder.canonical === undefined || folder.isDirectory !== true) {
      if (folder.code === 'EACCES' || folder.code === 'EPERM') throw permissionDenied(directory, folder.code);
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected Google Drive folder is not accessible.', { path: directory });
    }
    if (!isWithinPath(root.canonical, folder.canonical, this.driveOptions.platform)) {
      throw new KanbanError('SHARING_DRIVE_NOT_IN_MOUNT', 'The selected folder no longer resolves inside its Google Drive location.', { path: directory, mount });
    }
    if (await this.isDiscovered(root.canonical)) return;
    const refreshed = await this.driveOptions.discovery.refresh().catch(() => undefined);
    if (refreshed !== undefined && this.containsRoot(refreshed, root.canonical)) return;
    throw new KanbanError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'The Google Drive location is no longer discovered on this machine.', { path: directory, mount });
  }

  private async isDiscovered(canonicalRoot: string): Promise<boolean> {
    const view = await this.driveOptions.discovery.roots().catch(() => undefined);
    return view !== undefined && this.containsRoot(view, canonicalRoot);
  }

  private containsRoot(view: DriveDiscoveryView, canonicalRoot: string): boolean {
    const identity = folderIdentity(canonicalRoot, this.driveOptions.platform);
    return view.locations.some(location => folderIdentity(location.rootPath, this.driveOptions.platform) === identity);
  }
}

export interface GoogleDriveLocalProviderOptions extends FolderPathOptions {
  discovery: DriveLocationResolver;
  /** A directory the plugin owns and never accepts as a team storage. */
  managedRoot?: string;
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

function drivePermissionFromInspection(error: unknown): KanbanError | undefined {
  if (!(error instanceof KanbanError) || error.code !== 'SHARING_FOLDER_MISSING') return undefined;
  const detail = error.details ?? {};
  const cause = typeof detail.code === 'string' ? detail.code : typeof detail.cause === 'string' ? detail.cause : undefined;
  if (cause === 'EACCES' || cause === 'EPERM') return permissionDenied(typeof detail.path === 'string' ? detail.path : '', cause);
  return undefined;
}

/** The Google Drive Local descriptor: continuous synchronization over a folder inside a Drive mount. */
export function createGoogleDriveLocalProviderDescriptor(options: GoogleDriveLocalProviderOptions): SharingProviderDescriptor {
  const platform = options.platform ?? process.platform;
  const pathOptions: FolderPathOptions = {
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  };
  const identityOf = (value: string | undefined): string => folderIdentity(absoluteFolderPath(value ?? '', pathOptions), platform);
  return {
    id: 'google-drive-local',
    label: 'Google Drive Local',
    syncMode: 'continuous',
    defaultIntervalMinutes: 1,
    requiresAuthorization: false,
    normalizeSettings(settings) {
      const value = (settings.path ?? '').trim();
      if (value.length === 0) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      if (value.length > 4096 || /[\0\r\n]/.test(value)) throw new KanbanError('INVALID_INPUT', 'The Google Drive folder path is not valid.');
      return {
        path: value,
        ...(text(settings.mountId) === undefined ? {} : { mountId: text(settings.mountId)! }),
        ...(text(settings.account) === undefined ? {} : { account: text(settings.account)! }),
        ...(text(settings.driveName) === undefined ? {} : { driveName: text(settings.driveName)! }),
        ...(text(settings.folderName) === undefined ? {} : { folderName: text(settings.folderName)! }),
      };
    },
    describe(binding) {
      const value = text(binding.settings.path) ?? '';
      const folder = text(binding.settings.folderName) ?? (value.length > 0 ? path.basename(value) : '');
      const parts = [text(binding.settings.account), text(binding.settings.driveName), folder].filter((part): part is string => part !== undefined);
      if (parts.length === 0) return value;
      return parts.join(' / ');
    },
    async prepareBinding(candidate: BindingCandidate, existing: readonly BindingCandidate[]) {
      const received = absoluteFolderPath(candidate.settings.path ?? '', pathOptions);
      let inspected;
      try { inspected = await inspectFolder(received, pathOptions); }
      catch (error) {
        const permission = drivePermissionFromInspection(error);
        if (permission !== undefined) throw permission;
        throw error;
      }
      assertOutsideManagedRoot(inspected.path, await resolveManagedRoot(options.managedRoot));
      const located = await options.discovery.locate(inspected.path);
      if (located === undefined) throw await unsupportedLocationError(options.discovery, inspected.path);
      if (located.location.status !== 'available') throw new KanbanError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'The selected Google Drive location is not available on this machine.', { path: inspected.path, root: located.location.rootPath });
      // A folder belongs to at most one Hub, whichever filesystem-backed storage claims it.
      const occupied = existing.find(record => record.hubId !== candidate.hubId
        && (record.provider === 'local-folder' || record.provider === 'google-drive-local')
        && identityOf(record.settings.path) === inspected.identity);
      invariant(!occupied, 'SHARING_ADDRESS_IN_USE', 'The selected folder is already bound to another Hub.');
      const mountRoot = await realpath(located.location.rootPath).catch(() => located.location.rootPath);
      return {
        path: inspected.path,
        mountId: mountRoot,
        ...(located.location.account === undefined ? {} : { account: located.location.account }),
        ...(located.location.driveName === undefined ? {} : { driveName: located.location.driveName }),
        folderName: path.basename(inspected.path),
      };
    },
    createStore(_hubId, binding, state) {
      if (binding.provider !== 'google-drive-local') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not Google Drive Local.', { provider: binding.provider });
      const directory = text(binding.settings.path);
      const mountRoot = text(binding.settings.mountId);
      if (directory === undefined) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      if (mountRoot === undefined) throw new KanbanError('INVALID_INPUT', 'The Google Drive location for this folder is missing.');
      return new GoogleDriveLocalSharedConfigStore({ directory, mountRoot, discovery: options.discovery, state, platform });
    },
    normalizeState(state: ProviderState): ProviderState { return normalizeDirectoryState(state); },
  };
}

/** A refusal for a path outside every discovery location, naming the discovered condition. */
async function unsupportedLocationError(discovery: DriveLocationResolver, chosen: string): Promise<KanbanError> {
  const view = await discovery.roots().catch(() => undefined);
  if (view?.state === 'unsupported') return new KanbanError('SHARING_DRIVE_UNSUPPORTED', 'Google Drive for desktop is not available on this platform.', { path: chosen });
  if (view?.state === 'app-missing') return new KanbanError('SHARING_DRIVE_APP_MISSING', 'Google Drive for desktop was not detected on this computer.', { path: chosen });
  if (view?.state === 'failed') return new KanbanError('SHARING_DRIVE_DISCOVERY_FAILED', 'The Google Drive settings could not be read on this computer.', { path: chosen });
  return new KanbanError('SHARING_DRIVE_NOT_IN_MOUNT', 'The selected folder is not inside a discovered Google Drive location.', { path: chosen });
}
