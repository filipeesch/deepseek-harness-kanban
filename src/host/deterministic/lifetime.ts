import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failure } from './ports.js';

export interface LifetimeWitness {
  port: number;
  token: string;
  /** Inherited ownership token this witness answers for. */
  marker?: string;
  /** The guard process itself, which its own sweep must never treat as owned. */
  pid?: number;
}
export interface NativeLifetime {
  host: LifetimeWitness;
  shell(command: string): string;
  typescriptPrelude(): string;
  stop(): Promise<void>;
  close(): Promise<void>;
}
function quoted(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function proof(token: string, text: string): string { return createHmac('sha256', token).update(text).digest('hex'); }
const PROOF = /^[a-f0-9]{64}$/;
function matches(expected: string, actual: unknown): boolean { return typeof actual === 'string' && PROOF.test(actual) && PROOF.test(expected) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
function send(socket: Socket, data: unknown): void { socket.write(JSON.stringify(data) + '\n'); }
function receive(socket: Socket, callback: (message: Record<string, unknown>) => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data;
    if (Buffer.byteLength(buffer) > 8192) { socket.destroy(); return; }
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const value: unknown = JSON.parse(line); if (!value || typeof value !== 'object' || Array.isArray(value)) { socket.destroy(); return; } callback(value as Record<string, unknown>); } catch { socket.destroy(); }
    }
  });
}
/** A guard configuration file is private to the executing user and removed when the run settles. */
const CONFIG_NAME = /^[a-f0-9]{16}\.json$/;
const PROGRAM_NAME = /^[a-f0-9]{16}\.sh$/;
const GUARD_ARTIFACT = './guard.mjs';
const MISSING_ARTIFACT = 'NATIVE_LIFETIME_UNAVAILABLE: the built guard artifact is missing; rebuild the plugin before running this script.';

/** Remove guard configurations a host that did not finish left behind. */
export function clearGuardConfigurations(directory: string): void {
  const target = join(directory, 'guards');
  let names: string[];
  try { names = readdirSync(target); } catch { return; }
  for (const name of names) {
    if (!CONFIG_NAME.test(name) && !PROGRAM_NAME.test(name)) continue;
    try { unlinkSync(join(target, name)); } catch { /* Already removed by its guard or host. */ }
  }
}

export async function askWitness(witness: LifetimeWitness, action: string, allowAbsent = false): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: witness.port });
    let response: Record<string, unknown> | undefined;
    socket.setTimeout(5000, () => socket.destroy(new Error('Native ownership witness did not respond.')));
    const challenge = randomBytes(32).toString('hex');
    socket.once('connect', () => send(socket, { challenge, action, proof: proof(witness.token, 'request:' + action + ':' + challenge) }));
    receive(socket, message => {
      const payload = message.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !matches(proof(witness.token, 'response:' + challenge + ':' + JSON.stringify(payload)), message.proof)) { socket.destroy(new Error('Native lifetime witness authentication failed.')); return; }
      response = payload as Record<string, unknown>;
    });
    socket.once('error', error => {
      if (allowAbsent && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve({ absent: true });
      else reject(error);
    });
    socket.once('close', () => { if (response) resolve(response); else reject(new Error('Native ownership witness closed without authenticated proof.')); });
  });
}

/** Local authenticated control only; user code remains entirely under native confinement. */
export async function createNativeLifetime(options: {
  register(witness: LifetimeWitness): Promise<void>;
  settled(token: string): Promise<void>;
  /** Prove cleanup where the guard cannot read a process table, outside its confinement. */
  sweep(marker: string, exclude: ReadonlySet<number>): Promise<void>;
  /** Where private guard configurations are written; a temporary directory when absent. */
  directory?: string;
  /** The built guard artifact; resolved next to this module when absent. */
  guardPath?: string;
}): Promise<NativeLifetime> {
  const authorization = randomBytes(32).toString('hex');
  // Inherited ownership token: the guard proves no marked process remains before
  // it reports cleanup, which also covers a descendant that left the group.
  const marker = randomBytes(16).toString('hex');
  const sockets = new Set<Socket>();
  const admitted = new Map<Socket, string>();
  const witnesses = new Map<Socket, LifetimeWitness>();
  const configurations = new Set<string>();
  const temporary = options.directory === undefined ? mkdtempSync(join(tmpdir(), 'dsh-guard-')) : undefined;
  const configurationDirectory = temporary ?? join(options.directory as string, 'guards');
  mkdirSync(configurationDirectory, { recursive: true, mode: 0o700 });
  const artifact = options.guardPath ?? fileURLToPath(new URL(GUARD_ARTIFACT, import.meta.url));
  const writePrivate = (suffix: string, value: string): string => {
    const path = join(configurationDirectory, randomBytes(8).toString('hex') + suffix);
    writeFileSync(path, value, { mode: 0o600, flag: 'wx' });
    configurations.add(path);
    return path;
  };
  let tail = Promise.resolve();
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const server = createServer(socket => {
    if (sockets.size >= 128) { socket.destroy(); return; }
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => { sockets.delete(socket); admitted.delete(socket); witnesses.delete(socket); });
    socket.setTimeout(5000, () => socket.destroy());
    receive(socket, message => {
      if (message.action === 'reclaim-host' && typeof message.challenge === 'string' && matches(proof(authorization, 'request:reclaim-host:' + message.challenge), message.proof)) {
        const payload = { owned: true }; send(socket, { payload, proof: proof(authorization, 'response:' + message.challenge + ':' + JSON.stringify(payload)) }); socket.end(); return;
      }
      // The ownership token authenticates with the rest of the registration, so a
      // replayed proof cannot substitute a different marker for the fallback sweep.
      if (message.type === 'register' && typeof message.port === 'number' && Number.isInteger(message.port) && message.port > 0 && message.port < 65536 && typeof message.token === 'string' && /^[a-f0-9]{64}$/.test(message.token) && typeof message.marker === 'string' && /^[a-f0-9]{32}$/.test(message.marker) && typeof message.pid === 'number' && Number.isSafeInteger(message.pid) && message.pid > 0 && matches(proof(authorization, 'register:' + String(message.port) + ':' + String(message.token) + ':' + String(message.marker) + ':' + String(message.pid)), message.proof)) {
        // A guarded Bash always reports the token it actually put in its children's
        // environment; the lifetime marker is only a fallback.
        const witness = { port: message.port, token: message.token, marker: message.marker, pid: message.pid };
        tail = tail.then(async () => { await options.register(witness); admitted.set(socket, witness.token); witnesses.set(socket, witness); socket.setTimeout(0); send(socket, { type: 'ack', proof: proof(authorization, 'ack:' + witness.token) }); if (stopping) send(socket, { type: 'finish' }); }).catch(() => { socket.destroy(); });
      } else if (message.type === 'done' && typeof message.token === 'string' && admitted.get(socket) === message.token) {
        const token = message.token;
        tail = tail.then(async () => { await options.settled(token); send(socket, { type: 'done-ack' }); }).catch(() => { socket.destroy(); });
      } else if (message.type === 'sweep' && typeof message.challenge === 'string' && typeof message.marker === 'string' && /^[a-f0-9]{32}$/.test(message.marker) && matches(proof(authorization, 'request:sweep:' + message.challenge + ':' + message.marker), message.proof)) {
        // The guard cannot read a process table inside its confinement; the host reads
        // the same table it already applies when a guard is force-killed.
        const challenge = message.challenge;
        const swept = message.marker;
        const reply = (payload: Record<string, unknown>): void => send(socket, { type: 'sweep-result', challenge, payload, proof: proof(authorization, 'response:' + challenge + ':' + JSON.stringify(payload)) });
        tail = tail.then(async () => {
          // A live guard is never owned: it does not carry the run token. Excluding its
          // registered pid keeps that true even if the guard process were misclassified.
          const guardPids = [...witnesses.values()].flatMap(witness => witness.pid === undefined ? [] : [witness.pid]);
          try { await options.sweep(swept, new Set(guardPids)); reply({ clean: true }); }
          catch (error) { reply({ clean: false, reason: (error instanceof Error ? error.message : String(error)).slice(0, 300) }); }
        }).catch(() => { socket.destroy(); });
      } else socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') failure('OWNERSHIP_UNAVAILABLE', 'The local native lifetime control endpoint could not be established.');
  const config = { port: address.port, authorization };
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      await tail;
      // A witness may register after this snapshot, and the registration path then
      // requests its finish. Keep waiting until no socket remains, so a tree joined
      // late is drained before the host aborts its process.
      const deadline = Date.now() + 15000;
      for (;;) {
        const open = [...sockets];
        if (open.length === 0) break;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Native lifetime cleanup did not acknowledge quiescence.');
        await Promise.all(open.map(socket => new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { socket.destroy(); reject(new Error('Native lifetime cleanup did not acknowledge quiescence.')); }, remaining);
          socket.once('close', () => { clearTimeout(timer); resolve(); });
          if (socket.destroyed) { clearTimeout(timer); resolve(); return; }
          send(socket, { type: 'finish' });
        })));
        await tail;
      }
    })();
    return stopPromise;
  };
  return {
    host: { port: address.port, token: authorization },
    shell(command) {
      if (!existsSync(artifact)) return 'echo ' + quoted(MISSING_ARTIFACT) + ' >&2; exit 125';
      // The program travels in a private file: a process command line is readable by
      // any same-user process, so neither the source nor the authorization may be there.
      const scriptPath = writePrivate('.sh', command);
      return quoted(process.execPath) + ' ' + quoted(artifact) + ' ' + quoted(writePrivate('.json', JSON.stringify({ ...config, mode: 'bash', marker, scriptPath })));
    },
    typescriptPrelude() {
      if (!existsSync(artifact)) return 'await (async () => { throw new Error(' + JSON.stringify(MISSING_ARTIFACT) + '); })();\n';
      const path = writePrivate('.json', JSON.stringify({ ...config, mode: 'watch', marker }));
      return [
        'await (async () => {',
        'const nativeProcess = (await import("node:process")).default;',
        'const cp = await import("node:child_process");',
        'const marker = ' + JSON.stringify(marker) + ';',
        'nativeProcess.env.DSH_DETERMINISTIC_RUN = marker;',
        'const child = cp.spawn(nativeProcess.execPath, [' + JSON.stringify(artifact) + ', ' + JSON.stringify(path) + ', String(nativeProcess.pid)], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"], env: {} });',
        'let diagnostics = "";',
        'child.stderr.setEncoding("utf8");',
        'child.stderr.on("data", chunk => { if (diagnostics.length < 4096) diagnostics += chunk; });',
        'await new Promise((resolve, reject) => {',
        '  child.once("error", reject);',
        '  child.once("exit", (code, signal) => reject(new Error("Native lifetime guard exited before admission (" + (code === null ? signal : code) + ")" + (diagnostics.trim().length > 0 ? ": " + diagnostics.trim().slice(0, 300) : ""))));',
        '  child.once("message", message => { if (message && message.ready) resolve(null); });',
        '});',
        '})();',
        '',
      ].join('\n');
    },
    stop,
    async close() {
      try { await stop(); }
      finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
        for (const path of configurations) { try { unlinkSync(path); } catch { /* Removed with its execution. */ } }
        if (temporary !== undefined) { try { rmSync(temporary, { recursive: true, force: true }); } catch { /* Already gone. */ } }
      }
    },
  };
}
