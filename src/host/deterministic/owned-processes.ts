import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/** Whether a process with an unreadable environment belongs to this user. */
/**
 * Processes that still carry this run's ownership token, read from the host.
 *
 * The guard uses the same predicate before it reports clean. Reading it here as
 * well lets the host decide when a guard disappeared before it could answer, and
 * it is verification only: a sweep never signals a process by itself.
 *
 * An unreadable environment is not evidence of absence. A process of this user
 * whose membership cannot be read makes the whole answer unknown, while another
 * user's process cannot be one of ours and is skipped.
 */

/** Whether a process was already stopped by its owner before we touched it. */
function stopped(pid: number, platform: NodeJS.Platform): boolean | undefined {
  try {
    if (platform === 'linux') {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] === 'T';
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim().startsWith('T');
  } catch { return undefined; }
}

/** Re-read one candidate's own environment; a frozen pid cannot be recycled. */
function stillOwned(pid: number, needle: string, platform: NodeJS.Platform): boolean {
  if (platform === 'linux') {
    try { return readFileSync('/proc/' + pid + '/environ').includes(needle); }
    catch { return false; }
  }
  try {
    const table = execFileSync('ps', ['-p', String(pid), '-E', '-o', 'command='], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    return table.includes(needle) && !table.includes('NATIVE_LIFETIME_GUARD_V1');
  } catch { return false; }
}

/**
 * Terminates the processes that still carry this run's token.
 *
 * The guard normally does this itself; the host repeats it when a guard was
 * force-killed before it could finish, so cleanup does not depend on the guard
 * outliving the provider's escalation. Only a process that carries the token is
 * touched, membership is confirmed before a candidate is frozen, and a process
 * that was already stopped is never resumed.
 */
export async function terminateOwned(marker: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'win32') return;
  const needle = 'DSH_DETERMINISTIC_RUN=' + marker;
  for (let round = 0; round < 40; round += 1) {
    const pids = ownedProcesses(marker, platform);
    if (pids.length === 0) return;
    let signalled = 0;
    for (const pid of pids) {
      if (!stillOwned(pid, needle, platform)) continue;
      const wasStopped = stopped(pid, platform);
      let froze = false;
      if (wasStopped === false) { try { process.kill(pid, 'SIGSTOP'); froze = true; } catch { continue; } }
      try {
        if (!stillOwned(pid, needle, platform)) { if (froze) { try { process.kill(pid, 'SIGCONT'); } catch { /* exited */ } } continue; }
        try { process.kill(pid, 'SIGKILL'); signalled += 1; } catch { /* exited */ }
      } catch { if (froze) { try { process.kill(pid, 'SIGCONT'); } catch { /* exited */ } } }
    }
    if (signalled === 0) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (ownedProcesses(marker, platform).length > 0) throw new Error('Owned processes carrying this execution marker survived cleanup.');
}
export function ownedProcesses(marker: string, platform: NodeJS.Platform = process.platform): number[] {
  const needle = 'DSH_DETERMINISTIC_RUN=' + marker;
  if (platform === 'linux') {
    const found: number[] = [];
    for (const name of readdirSync('/proc')) {
      if (!/^[0-9]+$/.test(name)) continue;
      const pid = Number(name);
      if (pid === process.pid || pid === process.ppid) continue;
      let environment: Buffer;
      try { environment = readFileSync('/proc/' + name + '/environ'); }
      catch (error) {
        // An unreadable environment cannot be inspected, so it is outside the
        // tracked set (the documented credential-change residual).
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ESRCH' || code === 'EACCES' || code === 'EPERM') continue;
        throw error;
      }
      if (environment.includes(needle)) found.push(pid);
    }
    return found;
  }
  // Read the environment-bearing command column only: its launch-time prefix is
  // localized, and this read never signals anything.
  const table = execFileSync('ps', ['-E', '-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  const found: number[] = [];
  for (const line of table.split('\n')) {
    const value = /^\s*([0-9]+)\s+(.*)$/.exec(line);
    if (!value) continue;
    const pid = Number(value[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    if (!value[2]!.includes(needle)) continue;
    if (value[2]!.includes('NATIVE_LIFETIME_GUARD_V1')) continue;
    found.push(pid);
  }
  return found;
}
