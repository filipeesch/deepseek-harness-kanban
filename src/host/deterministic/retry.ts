/** How many attempts one guarded Bash call may make, including the first. */
export const BASH_RETRY_ATTEMPTS = 3;
/** The wait before each repetition; the last value repeats for any further attempt. */
export const BASH_RETRY_DELAYS_MS: readonly number[] = [250, 750];

export interface BashRetryOptions {
  /** Total attempts for one call; the default is three. */
  attempts?: number;
  /** Wait in milliseconds before attempt 2, 3, and so on. */
  delaysMs?: readonly number[];
}

/** The bounded repetition policy for a guarded Bash call. */
export interface BashRetry {
  readonly attempts: number;
  /** Wait before the next attempt, or reject as soon as the execution is stopped. */
  wait(attempt: number, signal: AbortSignal): Promise<void>;
}

/**
 * A retry policy the executor asks for a wait instead of owning a timer, so the
 * decision to repeat stays in one place and a test can run it without waiting.
 */
export function createBashRetry(options: BashRetryOptions = {}): BashRetry {
  // A nonfinite attempt count would make the loop unbounded; fall back to the policy.
  const requested = options.attempts ?? BASH_RETRY_ATTEMPTS;
  const attempts = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : BASH_RETRY_ATTEMPTS;
  const delays = (options.delaysMs ?? BASH_RETRY_DELAYS_MS).map(value => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
  return {
    attempts,
    wait: (attempt, signal) => new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const milliseconds = delays.length === 0 ? 0 : delays[Math.min(attempt - 1, delays.length - 1)]!;
      if (milliseconds === 0) return resolve();
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        if (error === undefined) resolve(); else reject(error);
      };
      const timer = setTimeout(() => finish(), milliseconds);
      const stop = (): void => finish(signal.reason instanceof Error ? signal.reason : new Error('The deterministic execution was stopped.'));
      signal.addEventListener('abort', stop, { once: true });
    }),
  };
}
