import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_DOCUMENT_FILE, serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { LocalFolderSharedConfigStore, createLocalFolderProviderDescriptor } from '../../src/host/sharing/local-folder-store.js';
import { abbreviateHome, absoluteFolderPath, folderIdentity, suggestedFolderPath } from '../../src/host/sharing/local-folder-path.js';
import type { BindingCandidate } from '../../src/host/sharing/provider.js';

const flow = (column = 'backlog'): string => ['name: Flow', 'initial_column: ' + column, 'columns:', '  - id: ' + column, '    label: ' + column, ''].join('\n');
const documentOf = (name: string): SharedHubDocument => ({ version: 1, boards: [{ key: 'flow', name, workflow: flow() }] });

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-local-folder-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function candidate(hubId: string, value: string): BindingCandidate {
  return { hubId, provider: 'local-folder', settings: { path: value } };
}

async function fixture(seed?: SharedHubDocument) {
  const directory = await tempRoot();
  const store = new LocalFolderSharedConfigStore({ directory, state: {} });
  if (seed) await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(seed), 'utf8');
  return { directory, store };
}

describe('local folder path', () => {
  it('expands the home shorthand and resolves a relative path', () => {
    const home = '/home/member';
    expect(absoluteFolderPath('~/Team', { home, cwd: home })).toBe(path.join(home, 'Team'));
    expect(absoluteFolderPath('Team', { home, cwd: home })).toBe(path.join(home, 'Team'));
    expect(absoluteFolderPath('/tmp/team', { home })).toBe('/tmp/team');
  });

  it('reads one directory through two spellings as the same folder', async () => {
    const root = await tempRoot();
    const real = path.join(root, 'real');
    const link = path.join(root, 'link');
    await mkdir(real);
    await symlink(real, link);
    const descriptor = createLocalFolderProviderDescriptor({ home: root });
    const first = await descriptor.prepareBinding!(candidate('hub-a', real), []);
    expect(first.path).toBe(await realpath(real));
    await expect(descriptor.prepareBinding!(candidate('hub-b', link), [{ hubId: 'hub-a', provider: 'local-folder', settings: first }])).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('compares identity case-insensitively only on a case-insensitive platform', () => {
    expect(folderIdentity('/Users/Member/Team', 'darwin')).toBe(folderIdentity('/Users/member/team', 'darwin'));
    expect(folderIdentity('/home/member/Team', 'linux')).not.toBe(folderIdentity('/home/member/team', 'linux'));
  });

  it('refuses a missing directory without creating it', async () => {
    const root = await tempRoot();
    const missing = path.join(root, 'absent');
    const descriptor = createLocalFolderProviderDescriptor({ home: root });
    await expect(descriptor.prepareBinding!(candidate('hub', missing), [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_MISSING' });
    await expect(stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a path that is a file', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'file.txt');
    await writeFile(file, 'x', 'utf8');
    const descriptor = createLocalFolderProviderDescriptor({ home: root });
    await expect(descriptor.prepareBinding!(candidate('hub', file), [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_NOT_DIRECTORY' });
  });

  it('refuses a directory the plugin cannot write', async () => {
    if (process.getuid?.() === 0) return;
    const root = await tempRoot();
    const locked = path.join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o500);
    const descriptor = createLocalFolderProviderDescriptor({ home: root });
    await expect(descriptor.prepareBinding!(candidate('hub', locked), [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_UNWRITABLE' });
    await chmod(locked, 0o700);
  });

  it('refuses a directory inside the managed publishing workspace', async () => {
    const root = await tempRoot();
    const managed = path.join(root, 'managed');
    const inside = path.join(managed, 'hub');
    await mkdir(inside, { recursive: true });
    const descriptor = createLocalFolderProviderDescriptor({ home: root, managedRoot: managed });
    await expect(descriptor.prepareBinding!(candidate('hub', inside), [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_RESERVED' });
  });

  it('suggests one folder per Hub under the home directory', () => {
    const home = '/home/member';
    expect(suggestedFolderPath('hub-a', { home })).toBe(path.join(home, '.dsh-kanban', 'hub-a'));
    expect(suggestedFolderPath('hub-b', { home })).not.toBe(suggestedFolderPath('hub-a', { home }));
    expect(abbreviateHome(path.join(home, '.dsh-kanban', 'hub-a'), home)).toBe(path.join('~', '.dsh-kanban', 'hub-a'));
  });

  it('declares continuous synchronization with a one-minute default', () => {
    const descriptor = createLocalFolderProviderDescriptor({ home: '/home/member' });
    expect(descriptor).toMatchObject({ id: 'local-folder', label: 'Local folder', syncMode: 'continuous', defaultIntervalMinutes: 1, requiresAuthorization: false });
    expect(descriptor.describe({ provider: 'local-folder', intervalMinutes: 1, settings: { path: '/home/member/Team' } })).toBe(path.join('~', 'Team'));
  });

  it('creates only the suggested folder on connect', async () => {
    const home = await tempRoot();
    const suggested = suggestedFolderPath('hub', { home });
    const descriptor = createLocalFolderProviderDescriptor({ home });
    const prepared = await descriptor.prepareBinding!(candidate('hub', suggested), []);
    expect(prepared.path).toBe(await realpath(suggested));
    await expect(descriptor.prepareBinding!(candidate('other', path.join(home, 'typed')), [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_MISSING' });
    await expect(stat(path.join(home, 'typed'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('local folder store', () => {
  it('never creates or modifies anything while ensuring', async () => {
    const { directory, store } = await fixture();
    const before = await readdir(directory);
    await store.ensure();
    expect(await readdir(directory)).toEqual(before);
  });

  it('reports no document for an empty folder', async () => {
    const { store } = await fixture();
    expect(await store.read()).toBeNull();
  });

  it('reads the document when its observation changed', async () => {
    const { directory, store } = await fixture(documentOf('First'));
    const first = await store.read();
    expect(first!.document.boards[0]!.name).toBe('First');
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Second')), 'utf8');
    const second = await new LocalFolderSharedConfigStore({ directory, state: store.state!() }).read(undefined, first);
    expect(second!.document.boards[0]!.name).toBe('Second');
  });

  it('reuses the cached snapshot when the observation is unchanged', async () => {
    const { directory, store } = await fixture(documentOf('First'));
    const first = await store.read();
    const cached = { token: 'stale-but-reused', document: first!.document };
    const second = await new LocalFolderSharedConfigStore({ directory, state: store.state!() }).read(undefined, cached);
    expect(second).toBe(cached);
  });

  it('refuses a stale write and keeps the document', async () => {
    const { directory, store } = await fixture(documentOf('Team'));
    await store.read();
    await expect(store.write(documentOf('Mine'), { expectedToken: 'no-longer-current', message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_STALE_TOKEN' });
    expect(await readFile(path.join(directory, SHARED_DOCUMENT_FILE), 'utf8')).toBe(serializeSharedDocument(documentOf('Team')));
  });

  it('writes the document and leaves no temporary sibling', async () => {
    const { directory, store } = await fixture(documentOf('Team'));
    const current = await store.read();
    await store.write(documentOf('Mine'), { expectedToken: current!.token, message: 'publish' });
    expect(await readFile(path.join(directory, SHARED_DOCUMENT_FILE), 'utf8')).toBe(serializeSharedDocument(documentOf('Mine')));
    expect((await readdir(directory)).filter(name => name !== SHARED_DOCUMENT_FILE)).toEqual([]);
  });

  it('reports a concurrent write when the document changed after the write', async () => {
    const directory = await tempRoot();
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Team')), 'utf8');
    const store = new LocalFolderSharedConfigStore({
      directory,
      state: {},
      renameFile: async (from, to) => { await (await import('node:fs/promises')).rename(from, to); await writeFile(to, serializeSharedDocument(documentOf('Other')), 'utf8'); },
    });
    const current = await store.read();
    await expect(store.write(documentOf('Mine'), { expectedToken: current!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_CONCURRENT_WRITE' });
  });

  it('keeps the previous document when the replacement is interrupted', async () => {
    const directory = await tempRoot();
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Team')), 'utf8');
    const store = new LocalFolderSharedConfigStore({ directory, state: {}, renameFile: async () => { throw Object.assign(new Error('interrupted'), { code: 'EIO' }); } });
    const current = await store.read();
    await expect(store.write(documentOf('Mine'), { expectedToken: current!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_FAILED' });
    expect(await readFile(path.join(directory, SHARED_DOCUMENT_FILE), 'utf8')).toBe(serializeSharedDocument(documentOf('Team')));
    expect((await readdir(directory)).filter(name => name !== SHARED_DOCUMENT_FILE)).toEqual([]);
  });

  it('retries a locked rename and reports the failure when the retries run out', async () => {
    const directory = await tempRoot();
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Team')), 'utf8');
    let attempts = 0;
    const flaky = new LocalFolderSharedConfigStore({
      directory,
      state: {},
      delay: async () => {},
      renameFile: async (from, to) => {
        attempts++;
        if (attempts < 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        await (await import('node:fs/promises')).rename(from, to);
      },
    });
    const current = await flaky.read();
    await expect(flaky.write(documentOf('Mine'), { expectedToken: current!.token, message: 'publish' })).resolves.toMatchObject({ token: sharedDocumentToken(documentOf('Mine')) });
    expect(attempts).toBe(2);

    const locked = new LocalFolderSharedConfigStore({ directory, state: {}, delay: async () => {}, renameFile: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } });
    const fresh = await locked.read();
    await expect(locked.write(documentOf('Other'), { expectedToken: fresh!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_FAILED' });
  });

  it('does not trust an observation for bytes that were replaced while they were read', async () => {
    const directory = await tempRoot();
    const file = path.join(directory, SHARED_DOCUMENT_FILE);
    await writeFile(file, serializeSharedDocument(documentOf('Team')), 'utf8');
    let version = 0;
    // The desktop client replaces the document while this process is reading it.
    const store = new LocalFolderSharedConfigStore({
      directory,
      state: {},
      readDocument: async target => {
        const raw = await readFile(target, 'utf8');
        await writeFile(file, serializeSharedDocument(documentOf('Version ' + (++version))), 'utf8');
        return raw;
      },
    });
    const read = await store.read();
    // Whatever version was returned, it is a complete document.
    expect(read!.document.boards[0]!.name).toMatch(/^(Team|Version \d+)$/);
    // No observation may be remembered, because none describes those bytes.
    expect(store.state!()).toEqual({});
    // A later check therefore re-reads the file instead of trusting the cache.
    const next = await new LocalFolderSharedConfigStore({ directory, state: store.state!() }).read(undefined, read);
    expect(next!.document.boards[0]!.name).not.toBe(read!.document.boards[0]!.name);
  });

  it('reports a concurrent write when the document is replaced during verification', async () => {
    const directory = await tempRoot();
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Team')), 'utf8');
    let insideWrite = 0;
    let counting = false;
    const store = new LocalFolderSharedConfigStore({
      directory,
      state: {},
      readDocument: async target => {
        const raw = await readFile(target, 'utf8');
        if (counting) {
          insideWrite++;
          // The competing write lands after our bytes were read, during verification.
          if (insideWrite === 2) await writeFile(target, serializeSharedDocument(documentOf('Other')), 'utf8');
        }
        return raw;
      },
    });
    const current = await store.read();
    counting = true;
    await expect(store.write(documentOf('Mine'), { expectedToken: current!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_CONCURRENT_WRITE' });
  });

  it('never exposes a partial document to a reader during replacement', async () => {
    const directory = await tempRoot();
    await writeFile(path.join(directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(documentOf('Old')), 'utf8');
    let enterReplacement = () => {};
    const entered = new Promise<void>(resolve => { enterReplacement = resolve; });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writer = new LocalFolderSharedConfigStore({
      directory,
      state: {},
      renameFile: async (from, to) => {
        // The replacement is now pending, with the temporary sibling on disk.
        enterReplacement();
        await gate;
        await (await import('node:fs/promises')).rename(from, to);
      },
    });
    const current = await writer.read();
    const writing = writer.write(documentOf('New'), { expectedToken: current!.token, message: 'publish' });

    try {
      await entered;
      const duringReplacement = await new LocalFolderSharedConfigStore({ directory, state: {} }).read();
      expect(duringReplacement!.document.boards[0]!.name).toBe('Old');
      expect((await readdir(directory)).some(name => name !== SHARED_DOCUMENT_FILE && name.includes('tmp'))).toBe(true);
    } finally {
      release();
    }

    await writing;
    const afterReplacement = await new LocalFolderSharedConfigStore({ directory, state: {} }).read();
    expect(afterReplacement!.document.boards[0]!.name).toBe('New');
  });

  it('leaves the folder and every file when the binding is destroyed', async () => {
    const { directory, store } = await fixture(documentOf('Team'));
    await writeFile(path.join(directory, 'notes.txt'), 'mine', 'utf8');
    await store.read();
    await store.destroy();
    expect((await readdir(directory)).sort()).toEqual([SHARED_DOCUMENT_FILE, 'notes.txt']);
  });
});

describe('local folder conflict copies', () => {
  const copies = ['kanban-hub (conflicted copy 2026-01-01).yaml', 'kanban-hub (1).yaml', 'kanban-hub-MACHINE.yaml', 'kanban-hub (duplicado).yaml'];

  it('names every copy a synchronization client may create', async () => {
    const { directory, store } = await fixture(documentOf('Team'));
    for (const name of copies) await writeFile(path.join(directory, name), 'x', 'utf8');
    await store.ensure();
    expect(store.review!()).toMatchObject({ code: 'SHARING_CONFLICT_COPY', files: [...copies].sort() });
  });

  it('ignores the document, the plugin temporary files, and unrelated files', async () => {
    const { directory, store } = await fixture(documentOf('Team'));
    await writeFile(path.join(directory, '.kanban-hub.yaml.1234.tmp'), 'x', 'utf8');
    await writeFile(path.join(directory, 'notes.txt'), 'x', 'utf8');
    await store.ensure();
    expect(store.review!()).toBeNull();
  });

  it('clears the review once the copies are gone', async () => {
    const { directory } = await fixture(documentOf('Team'));
    await writeFile(path.join(directory, 'kanban-hub (1).yaml'), 'x', 'utf8');
    const withCopy = new LocalFolderSharedConfigStore({ directory, state: {} });
    await withCopy.ensure();
    expect(withCopy.review!()).not.toBeNull();
    await rm(path.join(directory, 'kanban-hub (1).yaml'));
    const withoutCopy = new LocalFolderSharedConfigStore({ directory, state: {} });
    await withoutCopy.ensure();
    expect(withoutCopy.review!()).toBeNull();
  });
});
