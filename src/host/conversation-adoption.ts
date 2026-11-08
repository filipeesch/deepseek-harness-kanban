import { isForkLineage, type ForkLineageFacts } from '../domain/session-lineage.js';

/** Header-derived facts for one announced native session. */
export interface ForkSessionFacts extends ForkLineageFacts {
  readonly sessionId: string;
}

/** The task facts adoption needs; an absent lookup means no task retains the session. */
export interface AdoptionTaskTarget {
  readonly hubId: string;
  readonly taskId: string;
  readonly effectiveCwd: string;
}

/**
 * Everything adoption reads or writes, injected so the coordinator stays
 * independent from the host services and from cordis.
 */
export interface ForkAdoptionPorts {
  /** Resolve the task that retains this exact conversation session, when any. */
  locate(sessionId: string): AdoptionTaskTarget | undefined;
  /** Read the committed effective directory of a native conversation. */
  directory(sessionId: string): Promise<string>;
  /** Move a native conversation to the task's effective directory; the signal cancels native I/O. */
  setDirectory(sessionId: string, directory: string, signal?: AbortSignal): Promise<void>;
  /** Retain the conversation as another conversation of the task at the expected directory. */
  attach(hubId: string, taskId: string, sessionId: string, expectedEffectiveCwd: string): Promise<void>;
  /** Abortable bounded wait used between attachment attempts. */
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  report?(error: unknown): void;
}

export interface ForkAdopterOptions {
  /** Attachment attempts while the task reports a pending context operation. */
  attempts?: number;
  /** Wait before each retry, in milliseconds. */
  retryDelayMs?: number;
}

export type ForkAdoptionOutcome = 'adopted' | 'ignored' | 'failed' | 'cancelled';

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 500;

function isTaskBusy(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'TASK_BUSY');
}

/** Delay used as the default retry wait; rejects when the caller's signal aborts. */
export function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => signal?.reason instanceof Error ? signal.reason : new Error('Conversation adoption was cancelled.');
    if (signal?.aborted) { reject(cancelled()); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Adopt a fork of a task conversation as another conversation of that task.
 *
 * Adoption is best effort and never throws: a failure is reported and the
 * native fork stays usable as an unassociated session.
 */
export class ForkAdopter {
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly ports: ForkAdoptionPorts, options: ForkAdopterOptions = {}) {
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  }

  /** Adopt one announced session when it is a fork of a retained task conversation. */
  async adopt(facts: ForkSessionFacts, signal?: AbortSignal): Promise<ForkAdoptionOutcome> {
    try {
      return await this.run(facts, signal);
    } catch (error) {
      this.report(error);
      return 'failed';
    }
  }

  private async run(facts: ForkSessionFacts, signal?: AbortSignal): Promise<ForkAdoptionOutcome> {
    if (signal?.aborted) return 'cancelled';
    if (!isForkLineage(facts)) return 'ignored';
    // A session already retained by a task is never attached a second time.
    if (this.ports.locate(facts.sessionId)) return 'ignored';
    if (this.ports.locate(facts.parentSessionId) === undefined) return 'ignored';

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      if (signal?.aborted) return 'cancelled';
      // An overlapping announcement may have adopted the session while this one waited.
      if (this.ports.locate(facts.sessionId)) return 'ignored';
      // A pending context operation can move the task while this adoption waits, so the
      // target and the alignment are resolved again immediately before every attempt.
      const target = this.ports.locate(facts.parentSessionId);
      if (target === undefined) return 'ignored';
      const aligned = await this.align(facts.sessionId, target.effectiveCwd, signal);
      if (aligned !== 'aligned') return aligned;
      try {
        await this.ports.attach(target.hubId, target.taskId, facts.sessionId, target.effectiveCwd);
        return 'adopted';
      } catch (error) {
        if (!isTaskBusy(error) || attempt >= this.attempts) {
          this.report(error);
          return 'failed';
        }
      }
      try {
        await this.ports.sleep(this.retryDelayMs, signal);
      } catch (error) {
        // Only a caller abort is a cancellation; any other wait failure is a real failure.
        if (signal?.aborted) return 'cancelled';
        throw error;
      }
    }
    return 'failed';
  }

  /** Apply the same directory alignment an explicit conversation creation applies. */
  private async align(sessionId: string, directory: string, signal?: AbortSignal): Promise<'aligned' | 'cancelled'> {
    const current = await this.ports.directory(sessionId);
    if (signal?.aborted) return 'cancelled';
    if (current === directory) return 'aligned';
    try {
      await this.ports.setDirectory(sessionId, directory, signal);
    } catch (error) {
      // A disposal during the native directory I/O is a cancellation, not a failure.
      if (signal?.aborted) return 'cancelled';
      throw error;
    }
    if (signal?.aborted) return 'cancelled';
    return 'aligned';
  }

  /** Reporting is best effort and must never break the native fork. */
  private report(error: unknown): void {
    try {
      this.ports.report?.(error);
    } catch {
      /* A failing reporter must not escape the coordinator. */
    }
  }
}
