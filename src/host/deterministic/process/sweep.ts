import type { ProcessTable } from './types.js';

/** The environment entry every process of one execution inherits. */
export function markerNeedle(marker: string): string {
  return 'DSH_DETERMINISTIC_RUN=' + marker;
}

/** How one sweep repeats, waits, and signals; a test can replace every effect. */
export interface SweepOptions {
  rounds?: number;
  delayMs?: number;
  /** Pids that are known not to be owned, such as a registered guard. */
  exclude?: ReadonlySet<number>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_ROUNDS = 40;
const DEFAULT_DELAY_MS = 50;

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function owned(table: ProcessTable, pid: number, needle: string): boolean {
  return table.membership(pid, needle) === 'owned';
}

/**
 * Terminates the processes that still carry one run's token.
 *
 * Membership is confirmed before a candidate is frozen, membership is confirmed
 * again before it is signalled, and a process that was already stopped by someone
 * else is never resumed. Signals only ever reach a process whose own environment
 * proved it was ours.
 */
export async function sweepOwned(table: ProcessTable, marker: string, options: SweepOptions = {}): Promise<void> {
  const needle = markerNeedle(marker);
  const kill = options.kill ?? defaultKill;
  const sleep = options.sleep ?? defaultSleep;
  const exclude = options.exclude;
  const pending = (): number[] => table.candidates(needle).filter(pid => !exclude?.has(pid));
  const rounds = options.rounds ?? DEFAULT_ROUNDS;
  for (let round = 0; round < rounds; round += 1) {
    const candidates = pending();
    if (candidates.length === 0) return;
    let signalled = 0;
    for (const pid of candidates) {
      if (!owned(table, pid, needle)) continue;
      const wasStopped = table.stopped(pid);
      let froze = false;
      if (wasStopped === false) { try { kill(pid, 'SIGSTOP'); froze = true; } catch { continue; } }
      try {
        if (!owned(table, pid, needle)) { if (froze) { try { kill(pid, 'SIGCONT'); } catch { /* Exited while frozen. */ } } continue; }
        try { kill(pid, 'SIGKILL'); signalled += 1; } catch { /* Exited before the signal. */ }
      } catch (error) { if (froze) { try { kill(pid, 'SIGCONT'); } catch { /* Exited while frozen. */ } } throw error; }
    }
    if (signalled === 0) break;
    await sleep(options.delayMs ?? DEFAULT_DELAY_MS);
  }
  if (pending().length > 0) throw new Error('Owned processes carrying this execution marker survived cleanup.');
}
