import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { NativeExecutionOwnership } from '../../src/host/deterministic/ownership.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const hostFixture = fileURLToPath(new URL('../e2e-dsh/deterministic/native-owner.mjs', import.meta.url));

function identity(pid: number): string | undefined {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8' }).trim() || undefined; }
  catch { return undefined; }
}
function stopSameProcess(pid: number, expected: string | undefined): void {
  if (!expected || identity(pid) !== expected) return;
  // The native provider launched this exact observed group. A changed identity
  // is never authority to signal a reused PID or an unrelated process group.
  const group = Number(expected.split(/\s+/, 1)[0]);
  if (group === pid) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already settled. */ } }
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* Already settled. */ } }
}
async function ready(host: ChildProcess): Promise<{ pid: number; descendants?: number[]; marker?: string }> {
  let errors = '';
  host.stderr!.on('data', chunk => { errors += String(chunk); });
  return await new Promise((resolve, reject) => {
    const lines = createInterface({ input: host.stdout! });
    const timer = setTimeout(() => { lines.close(); reject(new Error('Native fixture did not publish readiness: ' + errors)); }, 10_000);
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (!value.ready || !Number.isSafeInteger(value.pid)) return;
        clearTimeout(timer); lines.close(); resolve(value);
      } catch { /* Ignore native loader diagnostic lines. */ }
    });
    host.once('exit', code => { clearTimeout(timer); lines.close(); reject(new Error('Native host exited before readiness (' + code + '): ' + errors)); });
  });
}

// The raw cases characterize macOS native fallback leakage after SIGKILL.
// Guarded cases are acceptance tests: the authenticated guard drains every process
// that inherited the run's ownership token, including one that left the process
// group with detached: true, and an unrelated sentinel stays live.
// Other platforms need their own backend-specific characterization.
describe.skipIf(process.platform !== 'darwin')('raw native abrupt-host-loss ownership boundary', () => {
  it.each(['bash', 'timer', 'busy', 'guarded-bash', 'guarded-timer', 'guarded-busy', 'guarded-nested', 'guarded-node-child', 'guarded-detached-child', 'guarded-bash-detached'])('characterizes raw and authenticated lifetime ownership for %s', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-native-owner-'));
    const home = join(root, 'home'); await mkdir(home);
    await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    const bundledHost = join(root, 'host.mjs');
    await build({ entryPoints: [hostFixture], outfile: bundledHost, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
    const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: join(home, '.dsh'), TMPDIR: root };
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env, stdio: 'ignore' });
    const host = spawn(process.execPath, [bundledHost, kind, root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let worker: number | undefined;
    let workerIdentity: string | undefined;
    const descendants: Array<{pid:number; identity:string|undefined}> = [];
    try {
      const started = await ready(host);
      // The guard answers for the token it actually put in its children's
      // environment; a different recorded token would make the host's fallback
      // sweep read the wrong set and report a false clean.
      if (started.marker !== undefined) {
        const owners = join(root, 'private', 'owners');
        const records = await Promise.all((await readdir(owners)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(owners, name), 'utf8')) as { guards?: Array<{ marker?: string }> }));
        const markers = records.flatMap(record => (record.guards ?? []).map(guard => guard.marker));
        expect(markers.length).toBeGreaterThan(0);
        for (const marker of markers) expect(marker).toBe(started.marker);
      }
      worker = started.pid;
      descendants.push(...(started.descendants ?? []).map(pid => ({pid, identity:identity(pid)})));
      workerIdentity = identity(worker);
      for (const child of descendants) expect(child.identity).toBeDefined();
      expect(workerIdentity).toBeDefined();
      expect(worker).not.toBe(host.pid);
      const closed = new Promise(resolve => host.once('exit', resolve));
      host.kill('SIGKILL'); await closed;
      await delay(300);
      const survived = identity(worker) === workerIdentity;
      console.log('Native host-loss characterization: ' + kind + ' workerSurvived=' + survived + '; descendantSurvived=' + descendants.some(child => identity(child.pid) === child.identity));
      expect(survived).toBe(!kind.startsWith('guarded-'));
      if (kind.startsWith('guarded-')) {
        await new NativeExecutionOwnership(join(root, 'private')).reclaim('test-execution');
        expect(await readdir(join(root, 'private/owners'))).toEqual([]);
        for (const child of descendants) expect(identity(child.pid)).not.toBe(child.identity);
      }
      expect(identity(unrelated.pid!)).toBeDefined();
    } finally {
      if (host.exitCode === null && host.signalCode === null) { const closed = new Promise(resolve => host.once('exit', resolve)); host.kill('SIGKILL'); await closed; }
      if (kind.startsWith('guarded-')) await new NativeExecutionOwnership(join(root, 'private')).reclaim('test-execution').catch(() => {});
      if (worker !== undefined) stopSameProcess(worker, workerIdentity);
      for (const child of descendants) stopSameProcess(child.pid, child.identity);
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
      unrelated.kill('SIGKILL');
      await Promise.all([host, unrelated].map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(['guarded-detached-child', 'guarded-bash-detached'])('terminates a detached descendant on Stop for %s', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-native-stop-'));
    const home = join(root, 'home'); await mkdir(home);
    await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    const bundledHost = join(root, 'host.mjs');
    await build({ entryPoints: [hostFixture], outfile: bundledHost, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
    const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: join(home, '.dsh'), TMPDIR: root };
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env, stdio: 'ignore' });
    const host = spawn(process.execPath, [bundledHost, kind, root, 'stop'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let worker: { pid: number; identity: string | undefined } | undefined;
    const descendants: Array<{ pid: number; identity: string | undefined }> = [];
    try {
      const started = await ready(host);
      worker = { pid: started.pid, identity: identity(started.pid) };
      descendants.push(...(started.descendants ?? []).map(pid => ({ pid, identity: identity(pid) })));
      expect(worker.identity).toBeDefined(); expect(descendants).toHaveLength(1); expect(descendants[0]!.identity).toBeDefined();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const exited = new Promise<number | null>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Stop did not settle.')), 10_000);
        host.once('exit', code => { clearTimeout(timeout); resolve(code); });
      });
      expect(host.kill('SIGUSR2')).toBe(true);
      expect(await exited).toBe(0);
      expect(identity(worker.pid)).not.toBe(worker.identity);
      expect(identity(descendants[0]!.pid)).not.toBe(descendants[0]!.identity);
      expect(await readdir(join(root, 'private/owners'))).toEqual([]);
      expect(identity(unrelated.pid!)).toBeDefined();
      console.log('Native Stop ownership: ' + kind + ' descendantSurvived=false; ownershipRecordReleased=true');
    } finally {
      if (host.exitCode === null && host.signalCode === null) { const closed = new Promise(resolve => host.once('exit', resolve)); host.kill('SIGKILL'); await closed; }
      if (worker) stopSameProcess(worker.pid, worker.identity);
      for (const child of descendants) stopSameProcess(child.pid, child.identity);
      unrelated.kill('SIGKILL');
      await Promise.all([host, unrelated].map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
