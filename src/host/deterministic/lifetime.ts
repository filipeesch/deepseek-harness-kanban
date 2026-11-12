import { createServer, connect, type Socket } from 'node:net';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NATIVE_LIFETIME_GUARD } from './guard-source.js';
import { failure } from './ports.js';

export interface LifetimeWitness { port: number; token: string; /** Inherited ownership token this witness answers for. */ marker?: string }
export interface NativeLifetime {
  host: LifetimeWitness;
  shell(command: string): string;
  typescriptPrelude(): string;
  stop(): Promise<void>;
  close(): Promise<void>;
}
function quoted(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function proof(token: string, text: string): string { return createHmac('sha256', token).update(text).digest('hex'); }
function matches(expected: string, actual: unknown): boolean { return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
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
      try { const value: unknown = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) callback(value as Record<string, unknown>); else socket.destroy(); } catch { socket.destroy(); }
    }
  });
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
}): Promise<NativeLifetime> {
  const authorization = randomBytes(32).toString('hex');
  // Inherited ownership token: the guard proves no marked process remains before
  // it reports cleanup, which also covers a descendant that left the group.
  const marker = randomBytes(16).toString('hex');
  const sockets = new Set<Socket>();
  const admitted = new Map<Socket, string>();
  let tail = Promise.resolve();
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const server = createServer(socket => {
    if (sockets.size >= 128) { socket.destroy(); return; }
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => { sockets.delete(socket); admitted.delete(socket); });
    socket.setTimeout(5000, () => socket.destroy());
    receive(socket, message => {
      if (message.action === 'reclaim-host' && typeof message.challenge === 'string' && matches(proof(authorization, 'request:reclaim-host:' + message.challenge), message.proof)) {
        const payload = { owned: true }; send(socket, { payload, proof: proof(authorization, 'response:' + message.challenge + ':' + JSON.stringify(payload)) }); socket.end(); return;
      }
      // The ownership token authenticates with the rest of the registration, so a
      // replayed proof cannot substitute a different marker for the fallback sweep.
      if (message.type === 'register' && typeof message.port === 'number' && Number.isInteger(message.port) && message.port > 0 && message.port < 65536 && typeof message.token === 'string' && /^[a-f0-9]{64}$/.test(message.token) && typeof message.marker === 'string' && /^[a-f0-9]{32}$/.test(message.marker) && matches(proof(authorization, 'register:' + String(message.port) + ':' + String(message.token) + ':' + String(message.marker)), message.proof)) {
        // A guarded Bash always reports the token it actually put in its children's
        // environment; the lifetime marker is only a fallback.
        const witness = { port: message.port, token: message.token, marker: message.marker };
        tail = tail.then(async () => { await options.register(witness); admitted.set(socket, witness.token); socket.setTimeout(0); send(socket, { type: 'ack', proof: proof(authorization, 'ack:' + witness.token) }); if (stopping) send(socket, { type: 'finish' }); }).catch(() => { socket.destroy(); });
      } else if (message.type === 'done' && typeof message.token === 'string' && admitted.get(socket) === message.token) {
        const token = message.token;
        tail = tail.then(async () => { await options.settled(token); send(socket, { type: 'done-ack' }); }).catch(() => { socket.destroy(); });
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
    shell(command) { return 'command -v node >/dev/null || { printf \'%s\\n\' \'NATIVE_LIFETIME_UNAVAILABLE: install Node >=24.9 in the execution world for authenticated process-tree cleanup.\' >&2; exit 125; }; exec node -e ' + quoted(NATIVE_LIFETIME_GUARD) + ' ' + quoted(JSON.stringify({ ...config, mode: 'bash', command })); },
    typescriptPrelude() {
      return 'await (async () => { const nativeProcess = (await import("node:process")).default; const cp = await import("node:child_process"); const marker = ' + JSON.stringify(marker) + '; nativeProcess.env.DSH_DETERMINISTIC_RUN = marker; const child = cp.spawn(nativeProcess.execPath, ["-e", ' + JSON.stringify(NATIVE_LIFETIME_GUARD) + ', JSON.stringify({ ...' + JSON.stringify(config) + ', mode: "watch", parent: nativeProcess.pid, marker: marker })], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env: {} }); await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", () => reject(new Error("Native lifetime guard exited before admission."))); child.once("message", message => { if (message && message.ready) resolve(null); }); }); })();\n';
    },
    stop,
    async close() {
      try { await stop(); }
      finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
    },
  };
}
