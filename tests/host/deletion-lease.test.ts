import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeExecutionOwnership } from '../../src/host/scripted/ownership.js';
import type { ScriptedScope } from '../../src/host/scripted/ports.js';

const scope: ScriptedScope = { hubId: 'hub', boardId: 'board', projectId: 'project', stageIdentity: 'stage' };
const active: string[] = [];
afterEach(async () => { for (const root of active.splice(0)) await rm(root, { recursive: true, force: true }); });

async function store(): Promise<NativeExecutionOwnership> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-owner-'));
  active.push(root);
  return new NativeExecutionOwnership(root);
}

describe('the read-only execution lease check', () => {
  it('passes when the task holds no lease', async () => {
    const ownership = await store();
    await expect(ownership.assertNoTaskLease(scope, 'task')).resolves.toBeUndefined();
  });

  it('refuses while the task still holds a lease, and reclaims nothing', async () => {
    const ownership = await store();
    const lease = await ownership.acquire(scope, 'execution', 'task');
    await expect(ownership.assertNoTaskLease(scope, 'task')).rejects.toMatchObject({ code: 'OWNERSHIP_EXISTS' });
    // A read-only check never takes the lease away, so the owner keeps it.
    await expect(ownership.assertNoTaskLease(scope, 'task')).rejects.toMatchObject({ code: 'OWNERSHIP_EXISTS' });
    await lease();
    await expect(ownership.assertNoTaskLease(scope, 'task')).resolves.toBeUndefined();
  });

  it('fails closed with recovery direction when the record cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-owner-'));
    active.push(root);
    const ownership = new NativeExecutionOwnership(root);
    const lease = await ownership.acquire(scope, 'execution', 'task');
    // Replace the record with a directory of the same name: the lease exists, but its
    // bytes cannot be read, so the only safe answer is a refusal that says what to do.
    const owners = join(root, 'owners');
    const entry = (await readdir(owners))[0]!;
    await unlink(join(owners, entry));
    await mkdir(join(owners, entry));
    const failure = await ownership.assertNoTaskLease(scope, 'task').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' });
    // The message must direct the person to the interface, not just name the condition.
    expect(String((failure as { message?: string }).message)).toContain('interface');
    await lease().catch(() => undefined);
  });
});

