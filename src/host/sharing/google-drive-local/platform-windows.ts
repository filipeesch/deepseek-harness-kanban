import type { DiscoveryFs } from './filesystem.js';
import type { DiscoveryEvidence, DiscoverySourceResult, DriveMount } from './mounts.js';
import { expandHome } from '../local-folder-path.js';
import type { SharingCommandRunner } from '../command-runner.js';

const COMMAND_TIMEOUT_MS = 5_000;
const REGISTRY_KEYS = [
  'HKCU\\Software\\Google\\DriveFS',
  'HKLM\\Software\\Google\\DriveFS',
  'HKCU\\Software\\Policies\\Google\\DriveFS',
];
const VOLUMES_COMMAND = ['powershell', '-NoProfile', '-NonInteractive', '-Command', '[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }'];

export interface WindowsAdapterOptions {
  home: string;
  fs: DiscoveryFs;
  runner: SharingCommandRunner;
  env?: NodeJS.ProcessEnv;
}

/** A configured mount point is a volume root or a folder path, never a drive-relative `G:`. */
export function normalizeMountPoint(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '');
  return /^[A-Za-z]:$/.test(trimmed) ? trimmed + '\\' : trimmed;
}

/** Expand `%USERPROFILE%`-style variables, then a leading tilde. */
function expandEnvironment(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => env[name] ?? env[name.toUpperCase()] ?? match);
}

/** The `DefaultMountPoint` value from one `reg query` result, or undefined. */
export function parseMountPoint(output: string): string | undefined {
  const match = /DefaultMountPoint\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im.exec(output);
  if (!match?.[1]) return undefined;
  const value = match[1].trim();
  return value.length === 0 ? undefined : value;
}

/** Every volume root the system reports. */
export function parseVolumeRoots(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .map(line => /^([A-Za-z]:)\\?$/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(value => value + '\\');
}

/** The volume root a configured mount point lives on, when it starts with a drive. */
function volumeRootOf(value: string): string | undefined {
  const match = /^([A-Za-z]:)[\\/]/.exec(value);
  return match?.[1] === undefined ? undefined : match[1].toUpperCase() + '\\';
}

/**
 * Windows evidence: the configured mount point in the DriveFS registry keys
 * (user, machine, and policy), whether the DriveFS key itself exists, and the
 * volumes the system reports. A folder name never establishes a mount by
 * itself, so an ordinary volume that happens to contain `My Drive` is not
 * treated as Google Drive.
 */
export class WindowsDriveDiscoveryAdapter {
  readonly model = 'windows' as const;

  constructor(private readonly options: WindowsAdapterOptions) {}

  async discover(): Promise<DiscoveryEvidence> {
    const mounts: DriveMount[] = [];
    const sources: DiscoverySourceResult[] = [];
    const configured: string[] = [];
    let keyPresent = false;
    for (const key of REGISTRY_KEYS) {
      const value = await this.query(['reg', 'query', key, '/v', 'DefaultMountPoint']);
      if (value !== undefined) {
        const parsed = parseMountPoint(value);
        if (parsed !== undefined) {
          configured.push(normalizeMountPoint(expandHome(expandEnvironment(parsed, this.options.env ?? process.env), this.options.home)));
          sources.push({ id: 'registry:' + key, ok: true });
          keyPresent = true;
          continue;
        }
      }
      // Distinguish an existing key with no value from a missing or denied key.
      const exists = await this.query(['reg', 'query', key]);
      if (exists !== undefined) {
        keyPresent = true;
        sources.push({ id: 'registry:' + key, ok: true, reason: 'no mount point configured' });
      } else {
        sources.push({ id: 'registry:' + key, ok: false, reason: 'not readable' });
      }
    }
    const volumes = await this.query(VOLUMES_COMMAND);
    const volumeRoots = volumes === undefined ? [] : parseVolumeRoots(volumes);
    sources.push(volumes === undefined ? { id: 'volumes', ok: false, reason: 'not readable' } : { id: 'volumes', ok: true });
    for (const candidate of configured) {
      const volume = volumeRootOf(candidate);
      const mounted = await this.options.fs.isDirectory(candidate);
      const reason = !mounted && volume !== undefined && !volumeRoots.includes(volume)
        ? 'The configured drive letter is not mounted.'
        : undefined;
      mounts.push({ id: candidate, rootPath: candidate, kind: 'account', ...(reason === undefined ? {} : { reason }) });
    }
    return { model: 'windows', mounts: this.deduplicate(mounts), sources, applicationDetected: keyPresent || configured.length > 0 };
  }

  private async query(argv: string[]): Promise<string | undefined> {
    try {
      const result = await this.options.runner(argv, this.options.home, COMMAND_TIMEOUT_MS);
      return result.exitCode === 0 ? result.stdout : undefined;
    } catch { return undefined; }
  }

  private deduplicate(mounts: DriveMount[]): DriveMount[] {
    const byIdentity = new Map<string, DriveMount>();
    for (const mount of mounts) {
      const identity = mount.rootPath.toLocaleLowerCase();
      if (!byIdentity.has(identity)) byIdentity.set(identity, mount);
    }
    return [...byIdentity.values()];
  }
}
