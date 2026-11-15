import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { BoundedCapture, STDERR_LIMIT, STDOUT_LIMIT } from './capture.js';
import { createCompletion } from './completion.js';
import { parseGuardConfig, type GuardConfig } from './config.js';
import { spawnLeader } from './leader.js';
import { createGuardOwnership, guardOwnershipSupported } from './ownership.js';
import { matches, proof } from './proof.js';
import { line, messages } from './protocol.js';
import { createQuiescence } from './quiesce.js';

/** The diagnostic a platform without an ownership primitive reports. */
const UNSUPPORTED = 'NATIVE_LIFETIME_UNSUPPORTED: configure a provider with proven Windows whole-tree host-loss cleanup.';
const ADMISSION_TIMEOUT_MS = 10000;
const SWEEP_TIMEOUT_MS = 15000;
const MAX_PENDING_SOCKETS = 16;
const RECLAIM_SOCKET_TIMEOUT_MS = 5000;
const DONE_ACK_TIMEOUT_MS = 5000;
// A guard whose host disappeared cannot prove anything itself; it stays briefly so a
// reclaiming host can ask, then leaves instead of becoming a permanent orphan.
const ORPHAN_GRACE_MS = 5000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): void {
  process.stderr.write(message + '\n');
  process.exit(125);
}

/** Read the private configuration the host wrote and enter the requested mode. */
export function main(argv: readonly string[]): void {
  const [path, parentValue] = argv;
  if (path === undefined) { fail('NATIVE_GUARD_CONFIG_INVALID: the configuration path is missing.'); return; }
  // No execution mode is supported here, so the refusal names the platform before any
  // configuration is read and before any code runs.
  if (!guardOwnershipSupported(process.platform)) { fail(UNSUPPORTED); return; }
  let config: GuardConfig;
  try {
    config = parseGuardConfig(JSON.parse(readFileSync(path, 'utf8')), parentValue === undefined ? undefined : Number(parentValue));
  } catch (error) {
    fail('NATIVE_LIFETIME_UNAVAILABLE: ' + reason(error));
    return;
  }
  run(config);
}

function run(config: GuardConfig): void {
  const token = randomBytes(32).toString('hex');
  const marker = config.marker;
  let host: Socket | undefined;
  let server: Server | undefined;
  let parentConnected = true;
  let registered = false;
  let admitted = false;
  let finishing = false;
  let inner: ChildProcess | undefined;
  let finishAck: (() => void) | undefined;
  const stdout = new BoundedCapture(STDOUT_LIMIT);
  const stderr = new BoundedCapture(STDERR_LIMIT);
  let overflow = false;
  // A guard that was never admitted never ran the command, so it must not report one.
  let emitResult = true;
  const pendingClose = new Set<Socket>();
  const pendingSweeps = new Map<string, (outcome: { clean: boolean; reason?: string }) => void>();

  // The owner pipe can disappear before cleanup finishes; a broken stream must not
  // abort the authenticated quiescence handshake.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});

  const settleSweeps = (outcome: { clean: boolean; reason?: string }): void => {
    for (const settle of pendingSweeps.values()) settle(outcome);
    pendingSweeps.clear();
  };

  /** Ask the one party that can read the process table to prove cleanup. */
  const requestSweep = (requested: string): Promise<void> => {
    const socket = host;
    if (socket === undefined || socket.destroyed) return Promise.reject(new Error('The host channel is unavailable for the ownership sweep.'));
    const challenge = randomBytes(32).toString('hex');
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pendingSweeps.delete(challenge); reject(new Error('The host did not answer the ownership sweep.')); }, SWEEP_TIMEOUT_MS);
      pendingSweeps.set(challenge, outcome => {
        clearTimeout(timer);
        if (outcome.clean) { resolve(); return; }
        reject(new Error(outcome.reason !== undefined && outcome.reason.length > 0 ? outcome.reason : 'The host could not prove whole-tree cleanup.'));
      });
      line(socket, { type: 'sweep', challenge, marker: requested, proof: proof(config.authorization, 'request:sweep:' + challenge + ':' + requested) });
    });
  };

  const ownership = createGuardOwnership({ platform: process.platform, requestSweep });
  const quiescence = createQuiescence({ mode: config.mode, marker, ownership, ...(config.parent === undefined ? {} : { parent: config.parent }), inner: () => inner });

  const exit = (code: number): void => {
    if (finishing) return;
    finishing = true;
    server?.close();
    host?.destroy();
    for (const socket of pendingClose) socket.destroy();
    process.exit(code);
  };

  const complete = createCompletion({
    mode: config.mode,
    quiesce: () => quiescence.run(),
    connected: () => parentConnected,
    emitResult: () => emitResult,
    result: () => ({ stdout: stdout.text(), stderr: stderr.text(), overflow }),
    writeStdout: text => { process.stdout.write(text); },
    writeStderr: text => { process.stderr.write(text); },
    sendDone: () => new Promise<void>(resolve => {
      const socket = host;
      if (socket === undefined || socket.destroyed) { resolve(); return; }
      // A live but stalled host must not keep the guard alive forever; the result is
      // already written, and the host's own cleanup deadline owns the rest.
      const timer = setTimeout(resolve, DONE_ACK_TIMEOUT_MS);
      const settle = (): void => { clearTimeout(timer); resolve(); };
      finishAck = settle;
      socket.once('close', settle);
      line(socket, { type: 'done', token });
    }),
    exit,
  });

  // A guard owns its own tree; reclaim asks a surviving guard to finish its cleanup.
  const control = createServer(socket => {
    if (pendingClose.size >= MAX_PENDING_SOCKETS) { socket.destroy(); return; }
    pendingClose.add(socket);
    socket.once('close', () => pendingClose.delete(socket));
    socket.setTimeout(RECLAIM_SOCKET_TIMEOUT_MS, () => socket.destroy());
    messages(socket, async message => {
      if (message.action !== 'reclaim' || typeof message.challenge !== 'string' || !matches(proof(token, 'request:reclaim:' + message.challenge), message.proof)) { socket.destroy(); return; }
      const challenge = message.challenge;
      const reply = (payload: Record<string, unknown>): void => line(socket, { payload, proof: proof(token, 'response:' + challenge + ':' + JSON.stringify(payload)) });
      if (parentConnected) { reply({ owned: true }); socket.end(); return; }
      try {
        await quiescence.run();
        reply({ clean: true });
        socket.once('close', () => exit(0));
        socket.end();
      } catch (error) {
        reply({ clean: false, reason: reason(error).slice(0, 300) });
        socket.end();
      }
    });
  });

  server = control;
  const admissionDeadline = setTimeout(() => {
    if (admitted || !parentConnected) return;
    emitResult = false;
    process.stderr.write('NATIVE_LIFETIME_UNAVAILABLE: the host did not admit this execution within its admission deadline.\n');
    void complete(125);
  }, ADMISSION_TIMEOUT_MS);

  control.listen(0, '127.0.0.1', () => {
    const address = control.address();
    if (address === null || address === undefined || typeof address === 'string') { fail('NATIVE_LIFETIME_UNAVAILABLE: the guard control endpoint could not be established.'); return; }
    const endpoint = address.port;
    const socket = connect({ host: '127.0.0.1', port: config.port });
    host = socket;
    let lost = false;
    const hostLost = (): void => {
      // A socket can report both an error and a close; the guard owns one cleanup.
      if (lost) return;
      lost = true;
      parentConnected = false;
      settleSweeps({ clean: false, reason: 'The host channel closed before the ownership sweep answered.' });
      void quiescence.run().catch(() => {}).then(() => {
        // Before admission the command provably never ran, so silence keeps the host's
        // bounded retry available.
        if (!registered) { exit(125); return; }
        // After admission the command may already have produced effects. Reporting an
        // empty 125 would make the host classify it as "never started" and repeat it, so
        // the guard states that its tree was not proven clean.
        if (admitted || inner !== undefined) process.stderr.write('NATIVE_LIFETIME_UNCLEAN: the host lifetime channel closed after the command started.\n');
        setTimeout(() => exit(125), ORPHAN_GRACE_MS);
      });
    };
    socket.on('error', hostLost);
    socket.on('close', hostLost);
    messages(socket, message => {
      if (message.type === 'ack' && matches(proof(config.authorization, 'ack:' + token), message.proof)) {
        admitted = true;
        clearTimeout(admissionDeadline);
        if (config.mode === 'watch') { if (process.send) process.send({ ready: true }); return; }
        if (config.scriptPath === undefined) return;
        const child = spawnLeader(config.scriptPath, marker);
        inner = child;
        child.stdout?.on('data', (chunk: Buffer) => { if (!stdout.push(chunk)) { overflow = true; void complete(125); } });
        child.stderr?.on('data', (chunk: Buffer) => { if (!stderr.push(chunk)) { overflow = true; void complete(125); } });
        child.on('error', () => { void complete(127); });
        child.on('message', value => {
          const outcome = (value as { outcome?: unknown } | null)?.outcome;
          if (typeof outcome === 'number') void complete(outcome);
        });
        child.on('close', () => { if (!quiescence.cleaned() && !finishing) void complete(130); });
        return;
      }
      if (message.type === 'finish') { void complete(0); return; }
      if (message.type === 'done-ack') { finishAck?.(); return; }
      if (message.type === 'sweep-result' && typeof message.challenge === 'string') {
        const settle = pendingSweeps.get(message.challenge);
        if (settle === undefined) return;
        pendingSweeps.delete(message.challenge);
        const payload = message.payload;
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !matches(proof(config.authorization, 'response:' + message.challenge + ':' + JSON.stringify(payload)), message.proof)) {
          settle({ clean: false, reason: 'The host ownership sweep answer failed authentication.' });
          return;
        }
        const value = payload as Record<string, unknown>;
        settle({ clean: value.clean === true, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) });
        return;
      }
      socket.destroy();
    });
    socket.on('connect', () => {
      registered = true;
      line(socket, { type: 'register', proof: proof(config.authorization, 'register:' + endpoint + ':' + token + ':' + marker + ':' + process.pid), port: endpoint, token, marker, pid: process.pid });
    });
  });

  if (config.mode === 'watch') process.on('disconnect', () => { if (parentConnected) void complete(0); });
  process.on('SIGTERM', () => { void complete(130); });
  process.on('SIGINT', () => { void complete(130); });
}
