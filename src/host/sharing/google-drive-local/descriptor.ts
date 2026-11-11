import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DriveDiscoveryView, DriveLocationView } from '../../../shared/types.js';
import { TEAM_FILES_DIRECTORY } from '../../../shared/types.js';
import { KanbanError, invariant } from '../../../shared/errors.js';
import { GoogleDriveLocalLayoutStore, normalizeDirectoryLayoutState } from './layout-store.js';
import { GuardedTeamFileStore } from '../guarded-team-file-store.js';
import { DirectoryTeamFileStore, TeamFileDirectory } from '../team-file-directory.js';
import {
  absoluteFolderPath,
  assertOutsideManagedRoot,
  folderIdentity,
  inspectFolder,
  resolveManagedRoot,
  type FolderPathOptions,
} from '../local-folder-path.js';
import type { BindingCandidate, ProviderState, SharingProviderDescriptor } from '../provider.js';
import type { LocatedDriveFolder } from './discovery.js';
import { createDriveMountGuard, drivePermissionDenied, type DriveMountGuardOptions } from './mount-guard.js';

/** The discovery surface the descriptor and its store depend on. */
export interface DriveLocationResolver {
  locate(value: string): Promise<LocatedDriveFolder | undefined>;
  roots(): Promise<DriveDiscoveryView>;
  refresh(): Promise<DriveDiscoveryView>;
}

export interface GoogleDriveLocalProviderOptions {
  readonly discovery: DriveLocationResolver;
  /** Home directory that owns the default team folder suggestion. */
  readonly home?: string;
  /** Directory used to resolve a relative selection. */
  readonly cwd?: string;
  /** The plugin's managed publishing root, which a binding may never point inside. */
  readonly managedRoot?: string;
  readonly platform?: NodeJS.Platform;
}

/** A stored setting that must be a nonempty string. */
function text(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function guardOptions(options: { directory: string; mountRoot: string; discovery: DriveLocationResolver; platform: NodeJS.Platform }): DriveMountGuardOptions {
  return { directory: options.directory, mountRoot: options.mountRoot, discovery: options.discovery, platform: options.platform };
}

function drivePermissionFromInspection(error: unknown): KanbanError | undefined {
  if (!(error instanceof KanbanError) || error.code !== 'SHARING_FOLDER_MISSING') return undefined;
  const detail = error.details ?? {};
  const cause = typeof detail.code === 'string' ? detail.code : typeof detail.cause === 'string' ? detail.cause : undefined;
  if (cause === 'EACCES' || cause === 'EPERM') return drivePermissionDenied(typeof detail.path === 'string' ? detail.path : '', cause);
  return undefined;
}

/**
 * A directory store that also proves its folder still belongs to the stored
 * Google Drive location. It re-resolves both paths before every operation, so a
 * folder replaced by an outward symlink can never be read or written, and it
 * refuses a location that discovery no longer reports.
 */
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
    syncMode: 'explicit',
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
    createLayoutStore(_hubId, binding) {
      if (binding.provider !== 'google-drive-local') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not Google Drive Local.', { provider: binding.provider });
      const directory = text(binding.settings.path);
      const mountRoot = text(binding.settings.mountId);
      if (directory === undefined) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      if (mountRoot === undefined) throw new KanbanError('INVALID_INPUT', 'The Google Drive location for this folder is missing.');
      const guard = createDriveMountGuard(guardOptions({ directory, mountRoot, discovery: options.discovery, platform }));
      return new GoogleDriveLocalLayoutStore({ directory }, guard);
    },
    createFileStore(_hubId, binding) {
      if (binding.provider !== 'google-drive-local') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not Google Drive Local.', { provider: binding.provider });
      const directory = text(binding.settings.path);
      const mountRoot = text(binding.settings.mountId);
      if (directory === undefined) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      if (mountRoot === undefined) throw new KanbanError('INVALID_INPUT', 'The Google Drive location for this folder is missing.');
      // The file store re-proves the mount before every operation, exactly like
      // the document store, so a redirected folder is never served as current.
      const guard = createDriveMountGuard(guardOptions({ directory, mountRoot, discovery: options.discovery, platform }));
      return new GuardedTeamFileStore(guard, new DirectoryTeamFileStore(new TeamFileDirectory(path.join(directory, TEAM_FILES_DIRECTORY))));
    },
    normalizeState(state: ProviderState): ProviderState { return normalizeDirectoryLayoutState(state); },
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
