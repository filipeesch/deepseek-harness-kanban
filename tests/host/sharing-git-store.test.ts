import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSharedDocument, serializeSharedDocument, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { GitSharedConfigStore, GitSharedConfigStoreFactory } from '../../src/host/sharing/git-store.js';

const flow = (column = 'backlog'): string => ['name: Flow', 'initial_column: ' + column, 'columns:', '  - id: ' + column, '    label: ' + column, ''].join('\n');
const documentOf = (name: string): SharedHubDocument => ({ version: 1, boards: [{ key: 'flow', name, workflow: flow() }] });

let root: string;
function git(cwd: string, args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }
interface Fixture { remote: string; shared: string }
async function fixture(seed: SharedHubDocument | string | null): Promise<Fixture> {
  root = await mkdtemp(path.join(os.tmpdir(), 'dsh-kanban-sharing-'));
  const remote = path.join(root, 'team.git');
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', remote]);
  if (seed !== null) {
    const checkout = path.join(root, 'seed');
    git(root, ['clone', '--quiet', remote, checkout]);
    await writeFile(path.join(checkout, 'kanban-hub.yaml'), typeof seed === 'string' ? seed : serializeSharedDocument(seed), 'utf8');
    git(checkout, ['add', '--', 'kanban-hub.yaml']);
    git(checkout, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'seed']);
    git(checkout, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  }
  return { remote, shared: path.join(root, 'shared') };
}
function storeFor(remote: string, hubId = 'hub'): GitSharedConfigStore {
  return new GitSharedConfigStore({ root: path.join(root, 'shared'), hubId, repository: remote });
}
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('Git publishing store', () => {
  it('reads, publishes with the expected token, and rejects a stale token', async () => {
    const { remote } = await fixture(documentOf('Team Flow'));
    const store = storeFor(remote);
    const initial = await store.read();
    expect(initial?.document.boards[0]?.name).toBe('Team Flow');

    const changed = documentOf('Renamed Flow');
    const written = await store.write(changed, { expectedToken: initial!.token, message: 'Rename board' });
    expect(written.token).toBe((await store.read())!.token);
    expect((await store.read())!.document.boards[0]!.name).toBe('Renamed Flow');

    await expect(store.write(documentOf('Third'), { expectedToken: initial!.token, message: 'stale' })).rejects.toMatchObject({ code: 'SHARING_STALE_TOKEN' });
    expect((await store.read())!.document.boards[0]!.name).toBe('Renamed Flow');
    const checkout = path.join(root, 'verify');
    git(root, ['clone', '--quiet', remote, checkout]);
    const text = await readFile(path.join(checkout, 'kanban-hub.yaml'), 'utf8');
    expect(parseSharedDocument(text).boards[0]!.name).toBe('Renamed Flow');
  });

  it('publishes the first document into an empty repository', async () => {
    const { remote } = await fixture(null);
    const store = storeFor(remote);
    expect(await store.read()).toBeNull();
    const written = await store.write(documentOf('First'), { expectedToken: null, message: 'Initial' });
    expect(written.token).toBeTruthy();
    expect((await store.read())!.document.boards[0]!.name).toBe('First');
  });

  it('reports an unreachable repository and a missing document distinctly', async () => {
    const { remote } = await fixture(documentOf('Team'));
    await expect(storeFor(path.join(root, 'absent.git')).read()).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    const emptyDocumentRepo = path.join(root, 'other.git');
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', emptyDocumentRepo]);
    const checkout = path.join(root, 'readme');
    git(root, ['clone', '--quiet', emptyDocumentRepo, checkout]);
    await writeFile(path.join(checkout, 'README.md'), 'no kanban here\n', 'utf8');
    git(checkout, ['add', '--', 'README.md']);
    git(checkout, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'readme']);
    git(checkout, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    expect(await storeFor(emptyDocumentRepo).read()).toBeNull();
    expect(remote).toContain('team.git');
  });

  it('replaces a managed clone that belongs to a different repository', async () => {
    const { remote } = await fixture(documentOf('First'));
    const sharedRoot = path.join(root, 'shared');
    const first = new GitSharedConfigStore({ root: sharedRoot, hubId: 'hub', repository: remote });
    expect((await first.read())!.document.boards[0]!.name).toBe('First');
    const secondRemote = path.join(root, 'second.git');
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', secondRemote]);
    const checkout = path.join(root, 'seed-second');
    git(root, ['clone', '--quiet', secondRemote, checkout]);
    await writeFile(path.join(checkout, 'kanban-hub.yaml'), serializeSharedDocument(documentOf('Second')), 'utf8');
    git(checkout, ['add', '--', 'kanban-hub.yaml']);
    git(checkout, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'seed']);
    git(checkout, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    const replacement = new GitSharedConfigStore({ root: sharedRoot, hubId: 'hub', repository: secondRemote });
    expect((await replacement.read())!.document.boards[0]!.name).toBe('Second');
  });

  it('rejects a malformed published document', async () => {
    const { remote } = await fixture('version: 1\nboards:\n  - key: bad key\n    name: ""\n    workflow: "columns: []"\n');
    await expect(storeFor(remote).read()).rejects.toMatchObject({ code: 'SHARING_INVALID_DOCUMENT' });
  });

  it('rejects an unsupported provider before any operation', () => {
    expect(() => new GitSharedConfigStoreFactory({ root: path.join(root, 'shared') }).create('hub', { provider: 'folder' as never, repository: '/team/repo', intervalMinutes: 5 })).toThrow(/not supported/);
  });

  it('removes the managed clone on destroy', async () => {
    const { remote } = await fixture(documentOf('Team'));
    const store = storeFor(remote);
    await store.read();
    await store.destroy();
    await expect(readFile(path.join(root, 'shared', 'hub', 'kanban-hub.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
