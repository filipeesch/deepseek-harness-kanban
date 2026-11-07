import { accountFromCloudStorageName } from './drive-labels.js';
import type { DiscoveryFs } from './filesystem.js';
import type { DiscoveryEvidence, DiscoverySourceResult, DriveMount } from './mounts.js';
import { expandHome } from '../local-folder-path.js';
import type { SharingCommandRunner } from '../command-runner.js';

const COMMAND_TIMEOUT_MS = 5_000;
const PREFERENCES_DOMAIN = 'com.google.drivefs.settings';
const PREFERENCES_KEY = 'PerAccountPreferences';

export interface MacosAdapterOptions {
  home: string;
  fs: DiscoveryFs;
  runner: SharingCommandRunner;
}

/** One `PerAccountPreferences` entry that names a mount point. */
interface AccountPreferences { per_account_preferences?: Array<{ key?: unknown; value?: { mount_point_path?: unknown } }> }

function parsePreferences(raw: string): Array<{ key?: string; mountPoint: string }> {
  const trimmed = raw.trim().replace(/^"(.*)"$/s, '$1');
  const parsed = JSON.parse(trimmed) as AccountPreferences;
  const entries = Array.isArray(parsed.per_account_preferences) ? parsed.per_account_preferences : [];
  return entries.flatMap(entry => {
    const mountPoint = entry.value?.mount_point_path;
    if (typeof mountPoint !== 'string' || mountPoint.trim().length === 0) return [];
    return [{ ...(typeof entry.key === 'string' ? { key: entry.key } : {}), mountPoint: mountPoint.trim() }];
  });
}

/**
 * macOS evidence: the File Provider locations under `~/Library/CloudStorage`,
 * the per-account mount points in the Drive preferences, and the legacy
 * `/Volumes` mounts older builds used. Any source may be missing.
 */
export class MacosDriveDiscoveryAdapter {
  readonly model = 'macos' as const;

  constructor(private readonly options: MacosAdapterOptions) {}

  async discover(): Promise<DiscoveryEvidence> {
    const mounts: DriveMount[] = [];
    const sources: DiscoverySourceResult[] = [];
    await this.addCloudStorage(mounts, sources);
    await this.addPreferences(mounts, sources);
    await this.addLegacyVolumes(mounts, sources);
    const applicationDetected = mounts.length > 0
      || await this.options.fs.exists(`${this.options.home}/Library/Application Support/Google/DriveFS`);
    return { model: 'macos', mounts: this.deduplicate(mounts), sources, applicationDetected };
  }

  private async addCloudStorage(mounts: DriveMount[], sources: DiscoverySourceResult[]): Promise<void> {
    const root = `${this.options.home}/Library/CloudStorage`;
    try {
      const { entries } = await this.options.fs.list(root);
      for (const entry of entries) {
        if (!entry.directory) continue;
        const account = accountFromCloudStorageName(entry.name);
        if (account === undefined) continue;
        mounts.push({ id: `${root}/${entry.name}`, rootPath: `${root}/${entry.name}`, kind: 'account', account });
      }
      sources.push({ id: 'cloud-storage', ok: true });
    } catch (error) {
      sources.push({ id: 'cloud-storage', ok: false, reason: this.reasonOf(error) });
    }
  }

  private async addPreferences(mounts: DriveMount[], sources: DiscoverySourceResult[]): Promise<void> {
    let result;
    try { result = await this.options.runner(['defaults', 'read', PREFERENCES_DOMAIN, PREFERENCES_KEY], this.options.home, COMMAND_TIMEOUT_MS); }
    catch (error) {
      sources.push({ id: 'preferences', ok: false, reason: this.reasonOf(error) });
      return;
    }
    if (result.exitCode !== 0) {
      sources.push({ id: 'preferences', ok: false, reason: (result.stderr || result.stdout).trim() || 'preferences are not readable' });
      return;
    }
    try {
      const entries = parsePreferences(result.stdout);
      for (const entry of entries) {
        const expanded = expandHome(entry.mountPoint, this.options.home);
        const value = expanded.length > 1 && expanded.endsWith('/') ? expanded.replace(/\/+$/, '') : expanded;
        if (!value.startsWith('/')) continue;
        const account = this.findAccount(mounts, value) ?? accountFromCloudStorageName(value.split('/').pop() ?? '');
        mounts.push({ id: value, rootPath: value, kind: value.startsWith('/Volumes/') ? 'legacy' : 'account', ...(account === undefined ? {} : { account }) });
      }
      sources.push({ id: 'preferences', ok: true });
    } catch (error) {
      sources.push({ id: 'preferences', ok: false, reason: this.reasonOf(error) });
    }
  }

  private async addLegacyVolumes(mounts: DriveMount[], sources: DiscoverySourceResult[]): Promise<void> {
    try {
      const { entries } = await this.options.fs.list('/Volumes');
      for (const entry of entries) {
        if (!entry.directory) continue;
        if (!entry.name.startsWith('GoogleDrive')) continue;
        const rootPath = `/Volumes/${entry.name}`;
        const account = accountFromCloudStorageName(entry.name) ?? (entry.name.length > 'GoogleDrive'.length ? entry.name.slice('GoogleDrive'.length).replace(/^[-_ ]/, '') : undefined);
        mounts.push({ id: rootPath, rootPath, kind: 'legacy', ...(account ? { account } : {}) });
      }
      sources.push({ id: 'legacy-volumes', ok: true });
    } catch (error) {
      sources.push({ id: 'legacy-volumes', ok: false, reason: this.reasonOf(error) });
    }
  }

  /** The account label already known for a mount that contains the new path. */
  private findAccount(mounts: DriveMount[], value: string): string | undefined {
    const found = mounts.find(mount => value === mount.rootPath || value.startsWith(mount.rootPath.replace(/\/+$/, '') + '/'));
    return found?.account;
  }

  /** One root reported once; the first evidence wins and later ones merge labels. */
  private deduplicate(mounts: DriveMount[]): DriveMount[] {
    const byIdentity = new Map<string, DriveMount>();
    for (const mount of mounts) {
      const identity = mount.rootPath.toLocaleLowerCase();
      const existing = byIdentity.get(identity);
      if (existing === undefined) byIdentity.set(identity, mount);
      else if (existing.account === undefined && mount.account !== undefined) existing.account = mount.account;
    }
    return [...byIdentity.values()];
  }

  private reasonOf(error: unknown): string {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'missing';
    return error instanceof Error ? error.message : String(error);
  }
}
