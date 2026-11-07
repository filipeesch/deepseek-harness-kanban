import { describe, expect, it } from 'vitest';
import { GoogleDriveLocalDiscovery } from '../../src/host/sharing/google-drive-local/discovery.js';
import { createDriveDiscoveryAdapter } from '../../src/host/sharing/google-drive-local/platform.js';
import { normalizeMountPoint, parseMountPoint, parseVolumeRoots } from '../../src/host/sharing/google-drive-local/platform-windows.js';
import { FakeDiscoveryFs, fakeRunner } from '../support/fake-discovery.js';

const HOME = '/Users/member';
const CLOUD = HOME + '/Library/CloudStorage';
const ACCOUNT = CLOUD + '/GoogleDrive-member@example.test';
const PREFERENCES = 'defaults read com.google.drivefs.settings PerAccountPreferences';
const DRIVE_APP = HOME + '/Library/Application Support/Google/DriveFS';

function preferences(mountPoint: string): string {
  return JSON.stringify({ per_account_preferences: [{ key: '101', value: { mount_point_path: mountPoint } }] });
}

function macos(fs: FakeDiscoveryFs, outputs: Record<string, { exitCode?: number; stdout?: string; stderr?: string }> = {}) {
  const { runner, calls } = fakeRunner(outputs);
  const adapter = createDriveDiscoveryAdapter({ platform: 'darwin', home: HOME, fs, runner });
  const discovery = new GoogleDriveLocalDiscovery({ adapter, fs, cacheMs: 0 });
  return { discovery, calls };
}

describe('macOS Drive discovery', () => {
  it('finds File Provider accounts and ignores other providers', async () => {
    const fs = new FakeDiscoveryFs([CLOUD, ACCOUNT, CLOUD + '/OneDrive-member']).directory(DRIVE_APP);
    const { discovery } = macos(fs);
    const view = await discovery.refresh();
    expect(view.state).toBe('ready');
    expect(view.locations).toEqual([expect.objectContaining({ rootPath: ACCOUNT, kind: 'account', status: 'available', account: 'member@example.test' })]);
  });

  it('falls back to the preferences mount point when CloudStorage is unreadable', async () => {
    const fs = new FakeDiscoveryFs([DRIVE_APP]).directory(ACCOUNT);
    const { discovery } = macos(fs, { [PREFERENCES]: { exitCode: 0, stdout: preferences(ACCOUNT) } });
    const view = await discovery.refresh();
    expect(view.state).toBe('ready');
    expect(view.locations).toHaveLength(1);
    expect(view.locations[0]).toMatchObject({ rootPath: ACCOUNT, account: 'member@example.test' });
  });

  it('reports one location when two sources describe the same root', async () => {
    const fs = new FakeDiscoveryFs([CLOUD, ACCOUNT, DRIVE_APP]);
    const { discovery } = macos(fs, { [PREFERENCES]: { exitCode: 0, stdout: preferences(ACCOUNT) } });
    const view = await discovery.refresh();
    expect(view.locations).toHaveLength(1);
  });

  it('merges a trailing-slash mount point with the visible account', async () => {
    const fs = new FakeDiscoveryFs([CLOUD, ACCOUNT, DRIVE_APP]);
    const { discovery } = macos(fs, { [PREFERENCES]: { exitCode: 0, stdout: preferences(ACCOUNT + '/') } });
    const view = await discovery.refresh();
    expect(view.locations).toHaveLength(1);
    expect(view.locations[0]).toMatchObject({ rootPath: ACCOUNT, account: 'member@example.test' });
  });

  it('keeps a failed source beside a successful one', async () => {
    const fs = new FakeDiscoveryFs([CLOUD, ACCOUNT, DRIVE_APP]);
    const { discovery } = macos(fs, { [PREFERENCES]: { exitCode: 1, stdout: '', stderr: 'domain not found' } });
    const view = await discovery.refresh();
    expect(view.sources).toEqual(expect.arrayContaining([{ id: 'cloud-storage', ok: true }, expect.objectContaining({ id: 'preferences', ok: false })]));
  });

  it('finds the legacy volume mount', async () => {
    const fs = new FakeDiscoveryFs(['/Volumes', '/Volumes/GoogleDrive-member@example.test', DRIVE_APP]);
    const { discovery } = macos(fs);
    const view = await discovery.refresh();
    expect(view.locations).toEqual([expect.objectContaining({ rootPath: '/Volumes/GoogleDrive-member@example.test', kind: 'legacy' })]);
  });

  it('reports the application as missing when nothing is installed', async () => {
    const { discovery } = macos(new FakeDiscoveryFs());
    const view = await discovery.refresh();
    expect(view).toMatchObject({ state: 'app-missing', locations: [] });
    expect(view.sources).toHaveLength(3);
  });

  it('reports a failure when the app exists but every source is unreadable', async () => {
    const fs = new FakeDiscoveryFs([DRIVE_APP]);
    const { discovery } = macos(fs, { [PREFERENCES]: { exitCode: 1, stdout: '', stderr: 'domain not found' } });
    const view = await discovery.refresh();
    expect(view.state).toBe('failed');
    expect(view.reason?.code).toBe('SHARING_DRIVE_DISCOVERY_FAILED');
  });

  it('reads local evidence only', async () => {
    const fs = new FakeDiscoveryFs([CLOUD, ACCOUNT, DRIVE_APP]);
    const { discovery, calls } = macos(fs, { [PREFERENCES]: { exitCode: 0, stdout: preferences(ACCOUNT) } });
    await discovery.refresh();
    expect(calls).toEqual([[ 'defaults', 'read', 'com.google.drivefs.settings', 'PerAccountPreferences' ]]);
    expect(fs.calls.every(call => /^(exists|isDirectory|list|realpath):/.test(call))).toBe(true);
  });
});

const REG = 'reg query HKCU\\Software\\Google\\DriveFS /v DefaultMountPoint';
const REG_MACHINE = 'reg query HKLM\\Software\\Google\\DriveFS /v DefaultMountPoint';
const REG_POLICY = 'reg query HKCU\\Software\\Policies\\Google\\DriveFS /v DefaultMountPoint';
const VOLUMES = 'powershell -NoProfile -NonInteractive -Command [System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }';

function windows(fs: FakeDiscoveryFs, outputs: Record<string, { exitCode?: number; stdout?: string; stderr?: string }> = {}) {
  const { runner, calls } = fakeRunner(outputs);
  const adapter = createDriveDiscoveryAdapter({ platform: 'win32', home: 'C:\\Users\\member', fs, runner, env: { USERPROFILE: 'C:\\Users\\member' } });
  const discovery = new GoogleDriveLocalDiscovery({ adapter, fs, cacheMs: 0 });
  return { discovery, calls };
}

describe('Windows Drive discovery', () => {
  it('reads the mount point value in both letter and folder form', () => {
    expect(parseMountPoint('HKEY_CURRENT_USER\\Software\\Google\\DriveFS\r\n    DefaultMountPoint    REG_SZ    G:\\\r\n')).toBe('G:\\');
    expect(parseMountPoint('    DefaultMountPoint    REG_SZ    C:\\Users\\member\\GoogleDrive')).toBe('C:\\Users\\member\\GoogleDrive');
    expect(parseMountPoint('    DefaultMountPoint    REG_SZ')).toBeUndefined();
  });

  it('normalizes a drive-relative mount point and a trailing separator', () => {
    expect(normalizeMountPoint('G:')).toBe('G:\\');
    expect(normalizeMountPoint('G:\\')).toBe('G:\\');
    expect(normalizeMountPoint('C:\\Users\\member\\GoogleDrive\\')).toBe('C:\\Users\\member\\GoogleDrive');
  });

  it('parses volume roots and ignores other output', () => {
    expect(parseVolumeRoots('C:\\\r\nD:\\\r\nnot a drive\r\n')).toEqual(['C:\\', 'D:\\']);
  });

  it('accepts a non-default configured letter', async () => {
    const fs = new FakeDiscoveryFs(['G:\\']);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 0, stdout: '    DefaultMountPoint    REG_SZ    G:\\' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\nG:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.locations).toEqual([expect.objectContaining({ rootPath: 'G:\\', status: 'available' })]);
  });

  it('accepts a configured folder mount point', async () => {
    const folder = 'C:\\Users\\member\\GoogleDrive';
    const fs = new FakeDiscoveryFs([folder]);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 0, stdout: '    DefaultMountPoint    REG_SZ    %USERPROFILE%\\GoogleDrive' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.locations[0]).toMatchObject({ rootPath: folder });
  });

  it('does not treat an ordinary volume with a My Drive folder as a mount', async () => {
    const fs = new FakeDiscoveryFs(['C:\\', 'C:\\My Drive', 'C:\\Shared drives']);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 1, stdout: '' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.state).toBe('app-missing');
    expect(view.locations).toEqual([]);
  });

  it('reports an installed but unmounted application as empty', async () => {
    const fs = new FakeDiscoveryFs(['C:\\']);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 1, stdout: '' },
      'reg query HKCU\\Software\\Google\\DriveFS': { exitCode: 0, stdout: 'HKEY_CURRENT_USER\\Software\\Google\\DriveFS' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.state).toBe('empty');
    expect(view.locations).toEqual([]);
    expect(view.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'registry:' + 'HKLM\\Software\\Google\\DriveFS', ok: false })]));
  });

  it('treats a malformed mount value as installed without a mount', async () => {
    const fs = new FakeDiscoveryFs(['C:\\']);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 0, stdout: '    DefaultMountPoint    REG_SZ' },
      'reg query HKCU\\Software\\Google\\DriveFS': { exitCode: 0, stdout: 'HKEY_CURRENT_USER\\Software\\Google\\DriveFS' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.state).toBe('empty');
  });

  it('does not treat an ordinary volume as a Drive location', async () => {
    const fs = new FakeDiscoveryFs(['C:\\', 'C:\\Windows']);
    const { discovery } = windows(fs, {
      [REG]: { exitCode: 1, stdout: '' },
      [REG_MACHINE]: { exitCode: 1, stdout: '' },
      [REG_POLICY]: { exitCode: 1, stdout: '' },
      [VOLUMES]: { exitCode: 0, stdout: 'C:\\\r\n' },
    });
    const view = await discovery.refresh();
    expect(view.state).toBe('app-missing');
    expect(view.locations).toEqual([]);
  });
});

describe('unsupported platforms', () => {
  it('reports the platform instead of an empty Drive', async () => {
    const fs = new FakeDiscoveryFs();
    const adapter = createDriveDiscoveryAdapter({ platform: 'linux', home: '/home/member', fs });
    const discovery = new GoogleDriveLocalDiscovery({ adapter, fs, cacheMs: 0 });
    await expect(discovery.refresh()).resolves.toEqual({ state: 'unsupported', locations: [] });
  });
});
