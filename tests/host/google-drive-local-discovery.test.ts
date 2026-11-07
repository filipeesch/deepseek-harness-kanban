import { describe, expect, it } from 'vitest';
import { GoogleDriveLocalDiscovery } from '../../src/host/sharing/google-drive-local/discovery.js';
import { groupForFolderName } from '../../src/host/sharing/google-drive-local/drive-labels.js';
import type { DriveDiscoveryAdapter } from '../../src/host/sharing/google-drive-local/platform.js';
import { FakeDiscoveryFs } from '../support/fake-discovery.js';

const ROOT = '/Users/member/Drive';
const MY_DRIVE = ROOT + '/My Drive';
const PROJECTS = MY_DRIVE + '/Projetos';
const SHARED = ROOT + '/Drives compartilhados';
const DESIGN = SHARED + '/Design';

function fixture(options: { mountRoot?: string; maxEntries?: number } = {}) {
  const mountRoot = options.mountRoot ?? ROOT;
  const fs = new FakeDiscoveryFs([ROOT, MY_DRIVE, PROJECTS, SHARED, DESIGN, ROOT + '/Locked'])
    .file(PROJECTS + '/kanban-hub.yaml');
  let discoveries = 0;
  const adapter: DriveDiscoveryAdapter = {
    model: 'macos',
    async discover() {
      discoveries++;
      return {
        model: 'macos',
        mounts: [{ id: mountRoot, rootPath: mountRoot, kind: 'account', account: 'member@example.test' }],
        sources: [{ id: 'cloud-storage', ok: true }],
        applicationDetected: true,
      };
    },
  };
  let clock = 1_000;
  const discovery = new GoogleDriveLocalDiscovery({
    adapter,
    fs,
    now: () => clock,
    cacheMs: 5_000,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });
  return { discovery, fs, discoveries: () => discoveries, advance: (ms: number) => { clock += ms; } };
}

describe('Drive discovery cache', () => {
  it('reuses a recent result and refreshes on demand', async () => {
    const f = fixture();
    await f.discovery.roots();
    await f.discovery.roots();
    expect(f.discoveries()).toBe(1);
    await f.discovery.refresh();
    expect(f.discoveries()).toBe(2);
    f.advance(6_000);
    await f.discovery.roots();
    expect(f.discoveries()).toBe(3);
  });
});

describe('Drive folder browsing', () => {
  it('lists one level with recognized groups and no document at the root', async () => {
    const f = fixture();
    const page = await f.discovery.browse(ROOT);
    expect(page.parent).toBeNull();
    expect(page.entries.map(entry => entry.name)).toEqual(['Drives compartilhados', 'Locked', 'My Drive']);
    expect(page.entries.find(entry => entry.name === 'My Drive')?.group).toEqual({ id: 'my-drive', label: 'My Drive' });
    expect(page.entries.find(entry => entry.name === 'Drives compartilhados')?.group).toEqual({ id: 'shared-drives', label: 'Shared drives' });
    expect(page.entries.find(entry => entry.name === 'Locked')?.group).toBeUndefined();
    expect(page.hasDocument).toBe(false);
  });

  it('hides the Drive bookkeeping folders at the location root only', async () => {
    const f = fixture();
    f.fs.directory(ROOT + '/.Trash').directory(ROOT + '/.shortcut-targets-by-id').directory(MY_DRIVE + '/.config');
    const rootPage = await f.discovery.browse(ROOT);
    expect(rootPage.entries.some(entry => entry.name === '.Trash')).toBe(false);
    expect(rootPage.entries.some(entry => entry.name === '.shortcut-targets-by-id')).toBe(false);
    const innerPage = await f.discovery.browse(MY_DRIVE);
    expect(innerPage.entries.some(entry => entry.name === '.config')).toBe(true);
  });

  it('reports the document and the parent inside a location', async () => {
    const f = fixture();
    const page = await f.discovery.browse(PROJECTS);
    expect(page.hasDocument).toBe(true);
    expect(page.parent).toBe(MY_DRIVE);
    expect(page.path).toBe(PROJECTS);
  });

  it('keeps an ordinary hidden root folder visible', async () => {
    const f = fixture();
    f.fs.directory(ROOT + '/.team');
    const page = await f.discovery.browse(ROOT);
    expect(page.entries.some(entry => entry.name === '.team')).toBe(true);
  });

  it('keeps an unrecognized folder name literal and reachable', async () => {
    const f = fixture();
    const unknown = ROOT + '/Meus arquivos';
    f.fs.directory(unknown);
    const page = await f.discovery.browse(ROOT);
    const entry = page.entries.find(value => value.name === 'Meus arquivos');
    expect(entry).toEqual({ name: 'Meus arquivos', path: unknown });
  });

  it('bounds the underlying enumeration instead of reading everything', async () => {
    const f = fixture({ maxEntries: 1 });
    const page = await f.discovery.browse(ROOT);
    expect(page.entries).toHaveLength(1);
    expect(page.shown).toBe(1);
    expect(page.truncated).toBe(true);
    // The reader is asked for the page plus bounded headroom, never the whole folder.
    expect(f.fs.listLimits.at(-1)).toBe(65);
  });

  it('refuses a path outside every discovered location', async () => {
    const f = fixture();
    await expect(f.discovery.browse('/tmp/elsewhere')).rejects.toMatchObject({ code: 'SHARING_DRIVE_BROWSE_REFUSED' });
  });

  it('refuses a traversal that leaves the location', async () => {
    const f = fixture();
    await expect(f.discovery.browse(ROOT + '/../elsewhere')).rejects.toMatchObject({ code: 'SHARING_DRIVE_BROWSE_REFUSED' });
  });

  it('refuses a symbolic link that resolves outside the location', async () => {
    const f = fixture();
    f.fs.directory('/tmp/outside').link(ROOT + '/escape', '/tmp/outside');
    await expect(f.discovery.browse(ROOT + '/escape')).rejects.toMatchObject({ code: 'SHARING_DRIVE_BROWSE_REFUSED' });
  });

  it('names a denied folder instead of presenting it empty', async () => {
    const f = fixture();
    f.fs.denied.add(ROOT + '/Locked');
    await expect(f.discovery.browse(ROOT + '/Locked')).rejects.toMatchObject({ code: 'SHARING_DRIVE_PERMISSION_DENIED' });
  });

  it('refuses browsing when the location is unavailable', async () => {
    const f = fixture({ mountRoot: '/Users/member/Removed Drive' });
    const page = await f.discovery.roots();
    expect(page.locations[0]).toMatchObject({ status: 'unavailable' });
    await expect(f.discovery.browse('/Users/member/Removed Drive')).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });
  });
});

describe('recognized container names', () => {
  it('recognizes the English and Portuguese spellings', () => {
    expect(groupForFolderName('My Drive')?.id).toBe('my-drive');
    expect(groupForFolderName('O meu disco')?.id).toBe('my-drive');
    expect(groupForFolderName('Shared drives')?.id).toBe('shared-drives');
    expect(groupForFolderName('Discos partilhados')?.id).toBe('shared-drives');
    expect(groupForFolderName('Arquivo morto')).toBeUndefined();
  });
});

describe('Windows-style browsing', () => {
  it('navigates a Windows location with Windows path rules', async () => {
    const root = 'C:\\Drive';
    const folder = root + '\\Team';
    const fs = new FakeDiscoveryFs([root, folder]).file(folder + '\\kanban-hub.yaml');
    const adapter: DriveDiscoveryAdapter = {
      model: 'windows',
      async discover() {
        return { model: 'windows', mounts: [{ id: root, rootPath: root, kind: 'account' }], sources: [{ id: 'registry', ok: true }], applicationDetected: true };
      },
    };
    const discovery = new GoogleDriveLocalDiscovery({ adapter, fs });
    const page = await discovery.browse(folder);
    expect(page.path).toBe(folder);
    expect(page.parent).toBe(root);
    expect(page.hasDocument).toBe(true);
  });
});

describe('discovery identity and diagnostics', () => {
  it('reports one location for two spellings of one discovered root', async () => {
    const fs = new FakeDiscoveryFs([ROOT]);
    const adapter: DriveDiscoveryAdapter = {
      model: 'macos',
      async discover() {
        return {
          model: 'macos',
          mounts: [
            { id: ROOT, rootPath: ROOT, kind: 'account', account: 'member@example.test' },
            { id: ROOT + '/', rootPath: ROOT + '/', kind: 'account' },
          ],
          sources: [{ id: 'cloud-storage', ok: true }],
          applicationDetected: true,
        };
      },
    };
    const discovery = new GoogleDriveLocalDiscovery({ adapter, fs });
    const view = await discovery.refresh();
    expect(view.locations).toHaveLength(1);
    expect(view.locations[0]).toMatchObject({ rootPath: ROOT, account: 'member@example.test' });
  });

  it('keeps a failed source visible beside a successful one', async () => {
    const fs = new FakeDiscoveryFs([ROOT]);
    const adapter: DriveDiscoveryAdapter = {
      model: 'macos',
      async discover() {
        return {
          model: 'macos',
          mounts: [{ id: ROOT, rootPath: ROOT, kind: 'account' }],
          sources: [{ id: 'cloud-storage', ok: true }, { id: 'preferences', ok: false, reason: 'domain not found' }],
          applicationDetected: true,
        };
      },
    };
    const view = await new GoogleDriveLocalDiscovery({ adapter, fs }).refresh();
    expect(view.state).toBe('ready');
    expect(view.sources).toEqual([{ id: 'cloud-storage', ok: true }, { id: 'preferences', ok: false, reason: 'domain not found' }]);
  });
});
