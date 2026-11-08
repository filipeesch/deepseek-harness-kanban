export interface StartupReconcilerOptions {
  signal?: AbortSignal;
  report?: (error: unknown) => void;
  /** How many background jobs run at once. */
  concurrency?: number;
}

/**
 * Runs plugin startup reconciliation off the interaction path: bounded concurrency,
 * one reported failure per job, and a settle seam for tests and shutdown. Jobs are
 * expected to be durable recovery steps that read Session history or the workspace
 * registry; the first snapshot never waits for them.
 */
export class StartupReconciler {
  private running: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly options: StartupReconcilerOptions = {}) {}

  run(jobs: ReadonlyArray<() => Promise<void>>): void {
    if (this.disposed || jobs.length === 0) return;
    const previous = this.running;
    this.running = (async () => {
      await previous?.catch(() => undefined);
      await this.execute(jobs);
    })();
  }

  /** Resolves when every scheduled job finished or was skipped after disposal. */
  whenSettled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
  }

  private async execute(jobs: ReadonlyArray<() => Promise<void>>): Promise<void> {
    let next = 0;
    const workers = Math.max(1, Math.min(this.options.concurrency ?? 3, jobs.length));
    await Promise.all(Array.from({ length: workers }, async () => {
      while (!this.disposed && !this.options.signal?.aborted && next < jobs.length) {
        const job = jobs[next];
        next += 1;
        if (job === undefined) continue;
        try {
          await job();
        } catch (error) {
          this.options.report?.(error);
        }
      }
    }));
  }
}
