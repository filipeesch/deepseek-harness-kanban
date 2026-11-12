/** Trusted native child infrastructure, never evaluated in the plugin process. */
export const NATIVE_LIFETIME_GUARD = String.raw`
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
function proof(token, text) { return createHmac('sha256', token).update(text).digest('hex'); }
function matches(expected, actual) { return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
const config = JSON.parse(process.argv[1]);
if (config.mode === 'bash' && process.platform === 'win32') { process.stderr.write('NATIVE_LIFETIME_UNSUPPORTED: configure a provider with proven Windows whole-tree host-loss cleanup.\n'); process.exit(125); }
let marker = typeof config.marker === 'string' && /^[a-f0-9]{32}$/.test(config.marker) ? config.marker : randomBytes(16).toString('hex');
// A guard owns its own tree; a sweeping guard must never kill another guard.
const GUARD = 'NATIVE_LIFETIME_GUARD_V1';
// The owner pipe can disappear before cleanup finishes; a broken stream must not
// abort the authenticated quiescence handshake.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
let parentConnected = true;
let registered = false;
let admitted = false;
let cleaned = false;
let cleanup;
let finishing = false;
let inner;
let finishAck;
let stdout = []; let stderr = []; let stdoutBytes = 0; let stderrBytes = 0; let overflow = false;
const token = randomBytes(32).toString('hex');
const pendingClose = new Set();
function line(socket, value) { socket.write(JSON.stringify(value) + '\n'); }
function messages(socket, callback) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', text => {
    buffer += text;
    if (buffer.length > 8192) return socket.destroy();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const value = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { callback(JSON.parse(value)); } catch { socket.destroy(); }
    }
  });
}
// Identity of a process that cannot be inspected. A descendant of this run must
// have started after this guard, so an older process of any user cannot carry the
// token; a same-user process that started later may, and is therefore uncertain.
function ticks(pid) {
  const stat = require('node:fs').readFileSync('/proc/' + pid + '/stat', 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
}
function foreignOrOwned(pid) {
  const fs = require('node:fs');
  let status;
  try { status = fs.readFileSync('/proc/' + pid + '/status', 'utf8'); } catch { return 'uncertain'; }
  const uid = /^Uid:\s*([0-9]+)/m.exec(status);
  if (!uid) return 'uncertain';
  if (Number(uid[1]) !== process.getuid()) return 'foreign';
  try { return ticks(pid) >= ticks(process.pid) ? 'own' : 'older'; } catch { return 'uncertain'; }
}
// One run token is inherited through the environment, so an ownership sweep can
// find a descendant that left the process group. Membership is the only authority:
// a bare pid, or a pid plus a timestamp read separately, never proves ownership.
function candidates(needle) {
  const found = [];
  if (process.platform === 'linux') {
    const fs = require('node:fs');
    for (const name of fs.readdirSync('/proc')) {
      if (!/^[0-9]+$/.test(name)) continue;
      const pid = Number(name);
      if (pid === process.pid || pid === process.ppid) continue;
      let environment;
      try { environment = fs.readFileSync('/proc/' + name + '/environ'); }
      catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
        if (foreignOrOwned(pid) !== 'own') continue;
        throw new Error('Process membership of an owned candidate could not be read.');
      }
      if (!environment.includes(needle)) continue;
      let cmdline;
      try { cmdline = fs.readFileSync('/proc/' + name + '/cmdline', 'utf8'); } catch { continue; }
      if (cmdline.includes(GUARD)) continue;
      found.push(pid);
    }
    return found;
  }
  const table = execFileSync('ps', ['-E', '-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 67108864, env: Object.assign({}, process.env, { LC_ALL: 'C' }) });
  for (const line of table.split('\n')) {
    const match = /^\s*([0-9]+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    if (!match[2].includes(needle)) continue;
    if (match[2].includes(GUARD)) continue;
    found.push(pid);
  }
  return found;
}
// Observe one candidate's own environment. Only a process that still carries the
// token is owned; an unreadable environment of our own user is uncertain.
function inspect(pid, needle) {
  if (process.platform === 'linux') {
    const fs = require('node:fs');
    let environment;
    try { environment = fs.readFileSync('/proc/' + pid + '/environ'); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return 'absent';
      if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
      return foreignOrOwned(pid) === 'own' ? 'uncertain' : 'not-owned';
    }
    return environment.includes(needle) ? 'owned' : 'not-owned';
  }
  let table;
  try { table = execFileSync('ps', ['-p', String(pid), '-E', '-o', 'command='], { encoding: 'utf8', maxBuffer: 4194304, env: Object.assign({}, process.env, { LC_ALL: 'C' }) }); }
  catch { return 'absent'; }
  if (table.trim().length === 0) return 'absent';
  if (table.includes(GUARD)) return 'not-owned';
  return table.includes(needle) ? 'owned' : 'not-owned';
}
// Whether a candidate was already stopped by someone else, so a freeze we did not
// create is never resumed by us.
function stopped(pid) {
  if (process.platform === 'linux') {
    try { const stat = require('node:fs').readFileSync('/proc/' + pid + '/stat', 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] === 'T'; }
    catch { return undefined; }
  }
  try { const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', env: Object.assign({}, process.env, { LC_ALL: 'C' }) }).trim(); return state.startsWith('T'); }
  catch { return undefined; }
}
async function sweep() {
  if (process.platform === 'win32') return;
  const needle = 'DSH_DETERMINISTIC_RUN=' + marker;
  for (let round = 0; round < 20; round += 1) {
    const pending = candidates(needle);
    if (pending.length === 0) return;
    let signalled = 0;
    for (const pid of pending) {
      // Membership is verified before the candidate is touched, so an unverified
      // pid is never paused on the strength of an older table read.
      const before = inspect(pid, needle);
      if (before === 'absent' || before === 'not-owned') continue;
      if (before === 'uncertain') throw new Error('Owned process membership could not be confirmed.');
      const wasStopped = stopped(pid);
      let froze = false;
      if (wasStopped === false) { try { process.kill(pid, 'SIGSTOP'); froze = true; } catch (error) { if (error.code === 'ESRCH') continue; } }
      try {
        const state = inspect(pid, needle);
        if (state === 'uncertain') throw new Error('Owned process membership could not be confirmed.');
        if (state !== 'owned') { if (froze) { try { process.kill(pid, 'SIGCONT'); } catch { /* Exited while frozen. */ } } continue; }
        try { process.kill(pid, 'SIGKILL'); signalled += 1; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      } catch (error) { if (froze) { try { process.kill(pid, 'SIGCONT'); } catch { /* Exited while frozen. */ } } throw error; }
    }
    if (signalled === 0) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (candidates(needle).length > 0) throw new Error('Owned processes carrying this execution marker survived cleanup.');
}
function quiesce() {
  cleanup ??= (async () => {
    if (config.mode === 'watch') {
      // Only signal a verified process group while its live leader is our parent.
      // A direct-PID kill does not prove the parent's children were stopped.
      if (process.ppid === config.parent) {
        const group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(config.parent)], { encoding: 'utf8' }).trim());
        if (group !== config.parent || process.ppid !== config.parent) throw new Error('The native worker is not its own verifiable process-group leader.');
        try { process.kill(-config.parent, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await new Promise(resolve => { if (!process.connected) return resolve(); process.once('disconnect', resolve); });
      } else {
        // Native shutdown may have reaped the leader first. Never signal an unanchored
        // id; only certify cleanup when no process remains in its recorded group.
        const groups = execFileSync('ps', ['-axo', 'pgid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
        if (groups.includes(config.parent)) throw new Error('The unanchored worker group still has members.');
      }
    } else if (inner) {
      // Ask the live leader to kill ITS OWN group; no cached child PID is signal authority.
      if (inner.exitCode === null && inner.signalCode === null) {
        try { inner.send({ terminate: true }, () => {}); } catch { /* IPC loss makes the inner leader self-terminate. */ }
      }
      await new Promise(resolve => {
        if (inner.exitCode !== null || inner.signalCode !== null) return resolve();
        inner.once('close', resolve);
      });
    }
    await sweep();
    cleaned = true;
  })();
  return cleanup;
}
function exit(code) {
  if (finishing) return;
  finishing = true;
  server.close(); host.destroy();
  for (const socket of pendingClose) socket.destroy();
  process.exit(code);
}
let completion;
function complete(code) {
  completion ??= (async () => {
    // An unproven tree must not report completion; stay reachable so reclaim can
    // answer that cleanup failed, then leave without claiming quiescence.
    try { await quiesce(); }
    catch (error) {
      process.stderr.write('NATIVE_LIFETIME_UNCLEAN: ' + (error && error.message ? error.message : String(error)) + '\n');
      setTimeout(() => exit(125), 10000);
      return;
    }
    if (!parentConnected) return;
    if (config.mode === 'bash') process.stdout.write(JSON.stringify({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), overflow }) + '\n');
    const ack = new Promise(resolve => { finishAck = resolve; });
    line(host, { type: 'done', token });
    await ack;
    exit(code);
  })();
  return completion;
}
const server = net.createServer(socket => {
  if (pendingClose.size >= 16) return socket.destroy();
  pendingClose.add(socket); socket.once('close', () => pendingClose.delete(socket));
  socket.setTimeout(5000, () => socket.destroy());
  messages(socket, async message => {
    if (message.action !== 'reclaim' || typeof message.challenge !== 'string' || !matches(proof(token, 'request:reclaim:' + message.challenge), message.proof)) return socket.destroy();
    const reply = payload => line(socket, { payload, proof: proof(token, 'response:' + message.challenge + ':' + JSON.stringify(payload)) });
    if (parentConnected) { reply({ owned: true }); return socket.end(); }
    try {
      await quiesce(); reply({ clean: true });
      socket.once('close', () => exit(0)); socket.end();
    } catch (error) { reply({ clean: false, reason: error && error.message ? String(error.message).slice(0, 300) : 'unknown' }); socket.end(); }
  });
});
let host;
const admissionDeadline = setTimeout(() => { if (!admitted && parentConnected) void complete(125); }, 10000);
server.listen(0, '127.0.0.1', () => {
  host = net.connect({ host: '127.0.0.1', port: config.port });
  const hostLost = () => { parentConnected = false; void quiesce().then(() => { if (!registered) exit(125); }); };
  host.on('error', hostLost);
  host.on('close', hostLost);
  host.on('connect', () => { registered = true; line(host, { type: 'register', proof: proof(config.authorization, 'register:' + server.address().port + ':' + token + ':' + marker), port: server.address().port, token, marker }); });
  messages(host, message => {
    if (message.type === 'ack' && matches(proof(config.authorization, 'ack:' + token), message.proof)) {
      admitted = true; clearTimeout(admissionDeadline);
      if (config.mode === 'watch') { if (process.send) process.send({ ready: true }); return; }
      const source = "const {spawn}=require('node:child_process');const terminate=()=>process.kill(-process.pid,'SIGKILL');process.on('disconnect',terminate);process.on('message',message=>{if(message&&message.terminate)terminate();});const child=spawn('bash',['-c',process.argv[1]],{stdio:['inherit','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('error',()=>process.send({outcome:127}));child.on('close',(code,signal)=>process.send({outcome:code===null?130:code}));setInterval(()=>{},2147483647);";
      inner = spawn(process.execPath, ['-e', source, config.command], { detached: true, stdio: ['inherit', 'pipe', 'pipe', 'ipc'], env: Object.assign({}, process.env, { DSH_DETERMINISTIC_RUN: marker }) });
      inner.stdout.on('data', chunk => { stdoutBytes += chunk.length; if (stdoutBytes > 32000) { overflow = true; void complete(125); } else stdout.push(chunk); });
      inner.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 3000) { overflow = true; void complete(125); } else stderr.push(chunk); });
      inner.on('error', () => { void complete(127); });
      inner.on('message', message => { if (typeof message.outcome === 'number') void complete(message.outcome); });
      inner.on('close', () => { if (!cleaned && !finishing) void complete(130); });
    } else if (message.type === 'finish') { void complete(0); }
    else if (message.type === 'done-ack') { if (finishAck) finishAck(); }
  });
});
if (config.mode === 'watch') process.on('disconnect', () => { if (parentConnected) void complete(0); });
process.on('SIGTERM', () => { void complete(130); });
process.on('SIGINT', () => { void complete(130); });
`;
