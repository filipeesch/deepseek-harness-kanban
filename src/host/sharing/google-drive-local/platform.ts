import os from 'node:os';
import { defaultSharingCommandRunner, type SharingCommandRunner } from '../command-runner.js';
import { nodeDiscoveryFs, type DiscoveryFs } from './filesystem.js';
import type { DiscoveryEvidence } from './mounts.js';
import { MacosDriveDiscoveryAdapter } from './platform-macos.js';
import { UnsupportedDriveDiscoveryAdapter } from './platform-unsupported.js';
import { WindowsDriveDiscoveryAdapter } from './platform-windows.js';

export interface DriveDiscoveryAdapter {
  readonly model: 'macos' | 'windows' | 'unsupported';
  discover(): Promise<DiscoveryEvidence>;
}

export interface DriveDiscoveryAdapterOptions {
  platform: NodeJS.Platform;
  home?: string;
  fs?: DiscoveryFs;
  runner?: SharingCommandRunner;
  env?: NodeJS.ProcessEnv;
}

/**
 * Pick the adapter for the current platform. The platform is injected so the
 * Windows and macOS parsers can be exercised from any test machine.
 */
export function createDriveDiscoveryAdapter(options: DriveDiscoveryAdapterOptions): DriveDiscoveryAdapter {
  const home = options.home ?? os.homedir();
  const fs = options.fs ?? nodeDiscoveryFs;
  const runner = options.runner ?? defaultSharingCommandRunner;
  if (options.platform === 'darwin') return new MacosDriveDiscoveryAdapter({ home, fs, runner });
  if (options.platform === 'win32') return new WindowsDriveDiscoveryAdapter({ home, fs, runner, ...(options.env === undefined ? {} : { env: options.env }) });
  return new UnsupportedDriveDiscoveryAdapter();
}
