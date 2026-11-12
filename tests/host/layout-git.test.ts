import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitLayoutStore } from '../../src/host/sharing/layout-git.js';
import { describeLayoutStoreContract, contractLog } from '../support/layout-store-contract.js';
import { serializeLayoutStamp, SHARED_BOARD_DIRECTORY, SHARED_LAYOUT_FILE } from '../../src/domain/sharing/layout.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';

const roots: string[] = [];
let seed = 0;

function git(cwd: string, args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

/** A bare repository, optionally seeded with the layout stamp and one board log. */
async function repository(withLayout: boolean): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-kanban-layout-git-'));
  roots.push(root);
  const remote = path.join(root, 'team.git');
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', remote]);
  if (withLayout) {
    const checkout = path.join(root, 'seed');
    git(root, ['clone', '--quiet', remote, checkout]);
    await writeFile(path.join(checkout, SHARED_LAYOUT_FILE), serializeLayoutStamp(), 'utf8');
    await mkdir(path.join(checkout, SHARED_BOARD_DIRECTORY), { recursive: true });
    await writeFile(path.join(checkout, SHARED_BOARD_DIRECTORY, 'delivery.jsonl'), exportBoardLogFixture('name: Delivery' + String.fromCharCode(10) + 'columns: []' + String.fromCharCode(10)), 'utf8');
    execFileSync('git', ['add', '--', SHARED_LAYOUT_FILE, SHARED_BOARD_DIRECTORY], { cwd: checkout });
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
  async () => storeFor(await repository(true)),
  async () => storeFor(await repository(true)),
);

describe('git layout store on a repository', () => {
  it('refuses a stale stamp write and accepts the fetched version', async () => {
    const remote = await repository(true);
    const store = storeFor(remote);
    const read = await store.readStamp();
    await expect(store.writeStamp(4, { expectedVersion: null })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
    expect(await store.writeStamp(4, { expectedVersion: read!.version })).toEqual({ version: 4 });
  });

  it('creates a board log and appends to it across clones', async () => {
    const remote = await repository(true);
    const first = storeFor(remote);
    const created = await first.createLog('ops', contractLog());
    const second = storeFor(remote);
    const read = await second.readLog('ops');
    expect(read!.head).toBe(created.head);
    // The commit is the log's probe: without it the mirror could never be saved.
    expect(created.probe).toMatch(/^[0-9a-f]{7,}$/);
    const appended = await second.appendChanges('ops', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    const third = storeFor(remote);
    expect((await third.readLog('ops'))!.log).toHaveLength(read!.log.length + 1);
    expect(appended.head).not.toBe(created.head);
  });

  it('refuses a stale append from another clone', async () => {
    const remote = await repository(true);
    const first = storeFor(remote);
    const stale = storeFor(remote);
    const read = await stale.readLog('delivery');
    await first.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Other' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    await expect(stale.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('reports nothing for an empty repository', async () => {
    const store = storeFor(await repository(false));
    expect(await store.readStamp()).toBeNull();
    expect(await store.probe('delivery')).toBeNull();
    expect(await store.readLog('delivery')).toBeNull();
    expect(await store.listLogs()).toEqual([]);
  });
});
