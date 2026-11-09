import { realpath, stat } from 'node:fs/promises';
import type { DriveDiscoveryView } from '../../../shared/types.js';
import { KanbanError } from '../../../shared/errors.js';
import { folderIdentity, isWithinPath } from '../../paths.js';
import type { DriveLocationResolver } from './descriptor.js';

interface PathState { canonical?: string; isDirectory?: boolean; code?: string }

const inspectCanonical = async (value: string): Promise<PathState> => {
  try {
    const canonical = await realpath(value);
    const info = await stat(canonical);
    return { canonical, isDirectory: info.isDirectory() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ...(code === undefined ? {} : { code }) };
  }
};

/** The refusal for an entry the operating system would not let the plugin inspect. */
export function drivePermissionDenied(value: string, cause?: string): KanbanError {
  return new KanbanError('SHARING_DRIVE_PERMISSION_DENIED', 'The operating system denied access to the selected Google Drive folder.', { path: value, ...(cause === undefined ? {} : { cause }) });
}

export interface DriveMountGuardOptions {
  /** The bound folder. */
  directory: string;
  /** The discovered location root the folder was selected in. */
  mountRoot: string;
  discovery: Pick<DriveLocationResolver, 'roots' | 'refresh'>;
  platform: NodeJS.Platform;
}

/**
 * Re-proves, before every operation, that the bound folder still belongs to the
 * stored Google Drive location. A folder replaced by an outward symlink, a mount
 * that disappeared, and a location discovery no longer reports are each refused
 * with the storage's own typed error, so a team file operation can never act on
 * a redirected path.
 */
export function createDriveMountGuard(options: DriveMountGuardOptions): () => Promise<void> {
  const containsRoot = (view: DriveDiscoveryView, canonicalRoot: string): boolean => {
    const identity = folderIdentity(canonicalRoot, options.platform);
    return view.locations.some(location => folderIdentity(location.rootPath, options.platform) === identity);
  };
  const isDiscovered = async (canonicalRoot: string): Promise<boolean> => {
    const view = await options.discovery.roots().catch(() => undefined);
    return view !== undefined && containsRoot(view, canonicalRoot);
  };
  return async () => {
    const mount = options.mountRoot;
    const root = await inspectCanonical(mount);
    if (root.canonical === undefined || root.isDirectory !== true) {
      if (root.code === 'EACCES' || root.code === 'EPERM') throw drivePermissionDenied(mount, root.code);
      await options.discovery.refresh().catch(() => undefined);
      throw new KanbanError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'The Google Drive location is no longer mounted on this machine.', { path: options.directory, mount });
    }
    const directory = options.directory;
    const folder = await inspectCanonical(directory);
    if (folder.canonical === undefined || folder.isDirectory !== true) {
      if (folder.code === 'EACCES' || folder.code === 'EPERM') throw drivePermissionDenied(directory, folder.code);
      throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected Google Drive folder is not accessible.', { path: directory });
    }
    if (!isWithinPath(root.canonical, folder.canonical, options.platform)) {
      throw new KanbanError('SHARING_DRIVE_NOT_IN_MOUNT', 'The selected folder no longer resolves inside its Google Drive location.', { path: directory, mount });
    }
    if (await isDiscovered(root.canonical)) return;
    const refreshed = await options.discovery.refresh().catch(() => undefined);
    if (refreshed !== undefined && containsRoot(refreshed, root.canonical)) return;
    throw new KanbanError('SHARING_DRIVE_MOUNT_UNAVAILABLE', 'The Google Drive location is no longer discovered on this machine.', { path: directory, mount });
  };
}
