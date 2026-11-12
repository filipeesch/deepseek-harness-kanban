import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Sandbox from '@deepseek-ai/dsh-sandbox-local';
import { describe, expect, it } from 'vitest';
import { createProcessOwnership, type ProcessOwnership } from '../../src/host/deterministic/process/index.js';
import { buildGuard } from '../support/guard-artifact.js';

/** The exact argv the mounted sandbox provider would run for this policy. */
async function confinedInvocation(argv: string[], root: string, mode: 'workspace-write' | 'read-only'): Promise<string[]> {
  const ctx = new Context();
  await ctx.plugin(Sandbox, {});
  try {
    const confined = await ctx.sandbox.confine(argv, { mode, workspaceRoot: root });
    return [...confined.argv];
  } finally {
    await ctx.fiber.dispose();
  }
}

interface FakeHost {
  port: number;
  sweeps: number;
  settled: Promise<void>;
  close(): Promise<void>;
}

/** The host half of the lifetime channel: admission, completion, and the delegated sweep. */
async function startHost(authorization: string, ownership: ProcessOwnership, closeAfterMs?: number): Promise<FakeHost> {
  const sign = (text: string): string => createHmac('sha256', authorization).update(text).digest('hex');
  let sweeps = 0;
  let settle: () => void = () => {};
  const settled = new Promise<void>(resolve => { settle = resolve; });
  const server = createServer(socket => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', text => {
      buffer += text;
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const message = JSON.parse(frame) as Record<string, unknown>;
        if (message.type === 'register') {
          socket.write(JSON.stringify({ type: 'ack', proof: sign('ack:' + String(message.token)) }) + '\n');
          // Simulate the host losing its lifetime channel while the command runs.
          if (closeAfterMs !== undefined) setTimeout(() => socket.destroy(), closeAfterMs);
        }
        else if (message.type === 'done') { socket.write(JSON.stringify({ type: 'done-ack' }) + '\n'); settle(); }
        else if (message.type === 'sweep') {
          sweeps += 1;
          const challenge = String(message.challenge);
          const reply = (payload: Record<string, unknown>): void => { socket.write(JSON.stringify({ type: 'sweep-result', challenge, payload, proof: sign('response:' + challenge + ':' + JSON.stringify(payload)) }) + '\n'); };
          ownership.sweep(String(message.marker)).then(() => reply({ clean: true }), error => reply({ clean: false, reason: String((error as Error).message) }));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the fake host did not bind.');
  return {
    port: address.port,
    get sweeps() { return sweeps; },
    settled,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the real guard under the real confinement profile of this platform. */
async function runGuard(root: string, command: string, mode: 'workspace-write' | 'read-only' = 'workspace-write', closeAfterMs?: number): Promise<{ run: Run; host: FakeHost }> {
  const guard = await buildGuard(join(root, 'guard.mjs'));
  const authorization = randomBytes(32).toString('hex');
  const marker = randomBytes(16).toString('hex');
  const host = await startHost(authorization, createProcessOwnership(), closeAfterMs);
  try {
    const config = join(root, 'config.json');
    const scriptPath = join(root, 'program.sh');
    await writeFile(scriptPath, command, { mode: 0o600 });
    await writeFile(config, JSON.stringify({ port: host.port, authorization, mode: 'bash', marker, scriptPath }));
    const invocation = await confinedInvocation([process.execPath, guard, config], root, mode);
    const child = spawn(invocation[0]!, invocation.slice(1), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise<number | null>(resolve => child.once('close', value => resolve(value)));
    return { run: { code, stdout, stderr }, host };
  } finally { /* the host is closed by the caller after its assertions. */ }
}

const confined = process.platform === 'darwin';

describe.skipIf(!confined)('guarded execution under the real macOS confinement profile', () => {
  it('returns the command result under workspace-write instead of failing closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-guard-confined-'));
    try {
      const { run, host } = await runGuard(root, 'printf "hello from the sandbox"');
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ stdout: 'hello from the sandbox', overflow: false });
      expect(host.sweeps).toBeGreaterThan(0);
      await host.settled;
      await host.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000);

  it('returns the command result under read-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-guard-readonly-'));
    try {
      const { run, host } = await runGuard(root, 'printf "read only"', 'read-only');
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ stdout: 'read only' });
      await host.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000);

  it('reaches a loopback service from inside the confinement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-guard-network-'));
    const service = createHttpServer((_request, response) => { response.end('loopback'); });
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve));
    const address = service.address();
    if (address === null || typeof address === 'string') throw new Error('the loopback service did not bind.');
    try {
      const command = 'node -e \'fetch("http://127.0.0.1:' + address.port + '/").then(r => r.text()).then(body => process.stdout.write(body))\'';
      const { run, host } = await runGuard(root, command);
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ stdout: 'loopback' });
      await host.close();
    } finally {
      await new Promise<void>(resolve => service.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);

  it('never looks like an empty retryable run when the host channel is lost after the command started', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-guard-hostloss-'));
    try {
      const command = 'printf "run\\n" >> ran.txt; sleep 2';
      const { run, host } = await runGuard(root, command, 'workspace-write', 300);
      // No result envelope, and the loss is reported as an unproven tree.
      expect(run.stdout.trim()).toBe('');
      expect(run.stderr).toContain('NATIVE_LIFETIME_UNCLEAN');
      // The admitted command ran once and is not retried by the host.
      const ran = await readFile(join(root, 'ran.txt'), 'utf8');
      expect(ran.trim().split('\n')).toHaveLength(1);
      await host.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000);

  it('terminates a descendant that detached into its own session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-guard-detached-'));
    try {
      const command = 'node -e \'const cp=require("node:child_process");const c=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});c.unref();require("fs").writeFileSync("child.pid",String(c.pid));\' ; printf "spawned"';
      const { run, host } = await runGuard(root, command);
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ stdout: 'spawned' });
      const pid = Number((await readFile(join(root, 'child.pid'), 'utf8')).trim());
      expect(Number.isInteger(pid)).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
      await host.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000);
});
