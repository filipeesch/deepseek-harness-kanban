import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeterministicScope } from './ports.js';
import { failure } from './ports.js';
import { scopeKey } from './variables.js';
import { askWitness, type LifetimeWitness } from './lifetime.js';
import { ownedProcesses, terminateOwned } from './process/index.js';

export interface OwnershipLease {
  (): Promise<void>;
  register(witness: LifetimeWitness): Promise<void>;
  settled(token: string): Promise<void>;
}
interface OwnerRecord { execution: string; nonce: string; host?: LifetimeWitness; guards: LifetimeWitness[] }
/**
 * The guard's positive answer, or the host's own read of the same inherited token.
 * A guard can be force-killed before it answers, for example when a native command
 * deadline escalates; an empty owned set is still proof that nothing it owned runs.
 */
async function witnessClean(witness: LifetimeWitness, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const outcome = await askWitness(witness, 'reclaim');
    if (outcome.clean === true) return true;
    if (typeof outcome.reason === 'string' && outcome.reason.length > 0) failure('OWNERSHIP_UNCERTAIN', 'Native lifetime witness reported: ' + outcome.reason);
  }
  catch {
    // A guard can be force-killed before it answers, for example when a native
    // command deadline escalates. The host reads the same inherited token, so an
    // empty owned set is the proof the guard would have given.
    if (witness.marker !== undefined) {
      // A guard can be force-killed before it finishes, so the host completes the
      // same ownership sweep instead of leaving the tree to the provider's grace.
      try { await terminateOwned(witness.marker, platform); if (ownedProcesses(witness.marker, platform).length === 0) return true; }
      catch { /* An unreadable or unkillable set, or a platform with no primitive, cannot prove anything; fail closed. */ }
    }
  }
  failure('OWNERSHIP_UNCERTAIN', 'Native lifetime witnesses have not confirmed whole-tree cleanup.');
}
/** Exclusive resource bookkeeping only; task transactions are the sole execution authority. */
export class NativeExecutionOwnership {
  constructor(private readonly root: string, private readonly platform: NodeJS.Platform = process.platform) {}
  private get directory(): string { return join(this.root, 'owners'); }
  async acquire(scope: DeterministicScope, executionId: string, taskId = executionId, host?: LifetimeWitness): Promise<OwnershipLease> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); scopeKey(scope);
    const ownerKey = createHash('sha256').update(JSON.stringify([scope.hubId, scope.projectId, taskId])).digest('hex');
    const path = join(this.directory, ownerKey + '.json');
    const record: OwnerRecord = { execution: createHash('sha256').update(executionId).digest('hex'), nonce: randomUUID(), ...(host ? { host } : {}), guards: [] };
    let file;
    try { file = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') failure('OWNERSHIP_UNCERTAIN', 'Another native owner or interrupted host holds this task execution lease. Reclaim its authenticated lifetime witnesses before launching replacement code.');
      throw error;
    }
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
    const current = async (): Promise<OwnerRecord> => {
      const value = JSON.parse(await readFile(path, 'utf8')) as OwnerRecord;
      if (value.nonce !== record.nonce) failure('OWNERSHIP_UNCERTAIN', 'The native resource lease changed; refusing to change another owner.');
      return value;
    };
    const save = async () => {
      await current(); const temporary = path + '.' + record.nonce + '.tmp'; const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
    };
    const release = async () => {
      await current();
      // A command deadline may close its host socket before the final done message.
      // Reconcile only authenticated witnesses; a closed pipe alone is not cleanup proof.
      for (const witness of [...record.guards]) {
        if (!await witnessClean(witness, this.platform)) failure('OWNERSHIP_UNCERTAIN', 'Native lifetime witnesses have not confirmed whole-tree cleanup.');
        record.guards = record.guards.filter(value => value.token !== witness.token); await save();
      }
      await current(); await unlink(path);
    };
    return Object.assign(release, {
      async register(witness: LifetimeWitness) { if (!record.guards.some(item => item.token === witness.token)) record.guards.push(witness); await save(); },
      async settled(token: string) { record.guards = record.guards.filter(item => item.token !== token); await save(); },
    });
  }
  async reclaim(executionId: string): Promise<void> {
    const expected = createHash('sha256').update(executionId).digest('hex');
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(this.directory, name);
      let record: OwnerRecord;
      try { record = JSON.parse(await readFile(path, 'utf8')) as OwnerRecord; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; failure('OWNERSHIP_UNCERTAIN', 'An interrupted native resource lease is unreadable; establish ownership before replacement.'); }
      if (record.execution !== expected) continue;
      await this.reclaimRecord(path, record);
    }
  }
  /** Check the task's owner even after its old stage entry was replaced. */
  async reclaimTask(scope: DeterministicScope, taskId: string): Promise<void> {
    const key = createHash('sha256').update(JSON.stringify([scope.hubId, scope.projectId, taskId])).digest('hex');
    const path = join(this.directory, key + '.json');
    let record: OwnerRecord;
    try { record = JSON.parse(await readFile(path, 'utf8')) as OwnerRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; return failure('OWNERSHIP_UNCERTAIN', 'The task native ownership record is unreadable.'); }
    await this.reclaimRecord(path, record);
  }
  private async reclaimRecord(path: string, record: OwnerRecord): Promise<void> {
    if (!record.host || !Array.isArray(record.guards)) failure('OWNERSHIP_UNCERTAIN', 'This native owner has no authenticated lifetime proof.');
    try {
      const host = await askWitness(record.host, 'reclaim-host', true);
      if (host.absent !== true) failure('OWNERSHIP_UNCERTAIN', 'The original host still owns this execution.');
      for (const witness of record.guards) {
        if (!await witnessClean(witness, this.platform)) failure('OWNERSHIP_UNCERTAIN', 'Native predecessor cleanup is unconfirmed.');
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'OWNERSHIP_UNCERTAIN') throw error;
      failure('OWNERSHIP_UNCERTAIN', 'Native lifetime evidence is unavailable or failed authentication.');
    }
    const current = JSON.parse(await readFile(path, 'utf8')) as OwnerRecord;
    if (current.nonce !== record.nonce) failure('OWNERSHIP_UNCERTAIN', 'Native ownership changed during reclamation.');
    await unlink(path);
  }
}
