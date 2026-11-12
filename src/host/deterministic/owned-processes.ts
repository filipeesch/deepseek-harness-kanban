import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/** Whether a process with an unreadable environment belongs to this user. */
function foreignOrOwned(pid: number): 'own' | 'foreign' | 'uncertain' {
  let status: string;
  try { status = readFileSync('/proc/' + pid + '/status', 'utf8'); } catch { return 'uncertain'; }
  const uid = /^Uid:\s*([0-9]+)/m.exec(status);
  const self = process.getuid?.();
  if (!uid || self === undefined) return 'uncertain';
  return Number(uid[1]) === self ? 'own' : 'foreign';
}

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
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ESRCH') continue;
        if (code !== 'EACCES' && code !== 'EPERM') throw error;
        if (foreignOrOwned(pid) === 'foreign') continue;
        throw new Error('Owned process membership could not be read.');
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
