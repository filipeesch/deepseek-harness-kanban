import type { ChildProcess } from 'node:child_process';
import type { ProcessOwnership } from '../process/types.js';
import type { GuardMode } from './config.js';

/** How one guard proves that nothing it started survives. */
export interface QuiescenceOptions {
  mode: GuardMode;
  marker: string;
  ownership: ProcessOwnership;
  /** The worker whose process group a watch guard supervises. */
  parent?: number;
  /** The detached leader of a Bash call, once the host admitted the guard. */
  inner: () => ChildProcess | undefined;
}

/** The memoized cleanup one guard performs before it reports anything. */
export interface Quiescence {
  run(): Promise<void>;
  /** Whether cleanup already proved an empty owned set. */
  cleaned(): boolean;
}

const LEADER_GRACE_MS = 5000;
const GROUP_GRACE_MS = 5000;
const GROUP_POLL_MS = 20;

/**
 * Whether one process group still has members. A group id is the pid of the process
 * that created it, so a successful probe against a live parent also proves that the
 * parent is its group's leader — without any external process-listing program.
 */
function groupExists(pgid: number): boolean {
  try { process.kill(-pgid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/** Wait, without signalling anything, for one process group to disappear. */
async function waitGroupGone(pgid: number, description: string): Promise<void> {
  const deadline = Date.now() + GROUP_GRACE_MS;
  while (groupExists(pgid)) {
    if (Date.now() >= deadline) throw new Error(description);
    await new Promise<void>(resolve => setTimeout(resolve, GROUP_POLL_MS));
  }
}

/** Signal the group this guard owns, then prove that no owned process remains. */
export function createQuiescence(options: QuiescenceOptions): Quiescence {
  let cleanup: Promise<void> | undefined;
  let cleaned = false;
  const run = (): Promise<void> => {
    cleanup ??= (async () => {
      if (options.mode === 'watch') {
        const parent = options.parent;
        if (parent === undefined) throw new Error('The native worker process group is unknown.');
        if (process.ppid === parent) {
          // Only signal a group whose leader is this guard's live parent.
          if (!groupExists(parent)) throw new Error('The native worker is not its own verifiable process-group leader.');
          try { process.kill(-parent, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
          await waitGroupGone(parent, 'The native worker process group did not empty.');
          await new Promise<void>(resolve => { if (!process.connected) return resolve(); process.once('disconnect', resolve); });
        } else if (groupExists(parent)) {
          // Native shutdown may have reaped the leader first. Never signal an
          // unanchored id; only certify cleanup when no member remains.
          throw new Error('The unanchored worker group still has members.');
        }
      } else {
        const inner = options.inner();
        const leader = inner?.pid;
        if (inner !== undefined && inner.exitCode === null && inner.signalCode === null) {
          // Ask the live leader to kill ITS OWN group; no cached child pid is signal authority.
          try { inner.send({ terminate: true }, () => {}); } catch { /* IPC loss makes the inner leader self-terminate. */ }
          await new Promise<void>(resolve => {
            if (inner.exitCode !== null || inner.signalCode !== null) return resolve();
            const timer = setTimeout(resolve, LEADER_GRACE_MS);
            inner.once('close', () => { clearTimeout(timer); resolve(); });
          });
        }
        // The leader owns its group while it lives. Once it is gone its id is no longer
        // signal authority: a numeric group id can be reused, and a probe only proves
        // that some group has that number. Probe without signalling and fail closed
        // instead of risking an unrelated group.
        if (leader !== undefined) await waitGroupGone(leader, 'The guarded command process group still has members.');
      }
      await options.ownership.sweep(options.marker);
      cleaned = true;
    })();
    return cleanup;
  };
  return { run, cleaned: () => cleaned };
}
