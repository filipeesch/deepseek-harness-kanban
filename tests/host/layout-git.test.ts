import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitLayoutStore } from '../../src/host/sharing/layout-git.js';
import { describeLayoutStoreContract, contractManifest, CONTRACT_WORKFLOW } from '../support/layout-store-contract.js';
import { serializeSharedManifest, SHARED_MANIFEST_FILE } from '../../src/domain/sharing/manifest.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';

const roots: string[] = [];
let seed = 0;

function git(cwd: string, args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

/** A bare repository, optionally seeded with a manifest and one board log. */
async function repository(withLayout: boolean): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-kanban-layout-git-'));
  roots.push(root);
  const remote = path.join(root, 'team.git');
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', remote]);
  if (withLayout) {
    const checkout = path.join(root, 'seed');
    git(root, ['clone', '--quiet', remote, checkout]);
    await writeFile(path.join(checkout, SHARED_MANIFEST_FILE), serializeSharedManifest(contractManifest()), 'utf8');
    execFileSync('git', ['add', '--', SHARED_MANIFEST_FILE], { cwd: checkout });
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '--quiet', '-m', 'seed'], { cwd: checkout });
    execFileSync('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], { cwd: checkout });
  }
  seed += 1;
  return remote;
}

function storeFor(remote: string): GitLayoutStore {
  return new GitLayoutStore({ root: path.join(path.dirname(remote), 'shared'), hubId: 'hub' + seed, repository: remote });
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describeLayoutStoreContract(
  'git layout store',
  async () => {
    const remote = await repository(true);
    const store = storeFor(remote);
    await store.createLog('delivery', CONTRACT_WORKFLOW);
    return store;
  },
  async () => storeFor(await repository(true)),
);

describe('git layout store on a repository', () => {
  it('refuses a stale manifest write and accepts the fetched token', async () => {
    const remote = await repository(true);
    const store = storeFor(remote);
    const read = await store.readManifest();
    await expect(store.writeManifest(contractManifest(['delivery', 'ops']), { expectedToken: null, message: 'm' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
    const written = await store.writeManifest(contractManifest(['delivery', 'ops']), { expectedToken: read!.token, message: 'm' });
    const after = await storeFor(remote).readManifest();
    expect(after!.manifest.boards.map(board => board.key)).toEqual(['delivery', 'ops']);
    expect(after!.token).toBe(written.token);
  });

  it('creates a board log and appends to it across clones', async () => {
    const remote = await repository(true);
    const first = storeFor(remote);
    const created = await first.createLog('delivery', CONTRACT_WORKFLOW);
    const second = storeFor(remote);
    const read = await second.readLog('delivery');
    expect(read!.head).toBe(created.head);
    const appended = await second.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    const third = storeFor(remote);
    expect((await third.readLog('delivery'))!.log.events.map(event => event.seq)).toEqual([1]);
    expect(appended.head).not.toBe(created.head);
  });

  it('refuses a stale append from another clone', async () => {
    const remote = await repository(true);
    const first = storeFor(remote);
    await first.createLog('delivery', CONTRACT_WORKFLOW);
    const stale = storeFor(remote);
    const read = await stale.readLog('delivery');
    await first.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Other' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    await expect(stale.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('removes a board log', async () => {
    const remote = await repository(true);
    const store = storeFor(remote);
    await store.createLog('delivery', CONTRACT_WORKFLOW);
    expect(await store.readLog('delivery')).not.toBeNull();
    await store.removeLog('delivery');
    expect(await storeFor(remote).readLog('delivery')).toBeNull();
  });

  it('reports nothing for an empty repository', async () => {
    const store = storeFor(await repository(false));
    expect(await store.readManifest()).toBeNull();
    expect(await store.probe('delivery')).toBeNull();
    expect(await store.readLog('delivery')).toBeNull();
  });
});
