/** Runs the pending-work steps that must precede an attention projection tick. */
export interface PendingWorkOptions {
  resumeWorktrees: () => Promise<void>;
  dispatchPending: () => Promise<void>;
  report?: (error: unknown) => void;
}

/**
 * Keeps worktree resume and confirmed-transition driving out of the attention
 * coordinator. A failing step is reported and does not prevent the other.
 */
export class PendingWorkRunner {
  constructor(private readonly options: PendingWorkOptions) {}

  async run(): Promise<void> {
    try {
      await this.options.resumeWorktrees();
    } catch (error) {
      this.options.report?.(error);
    }
    try {
      await this.options.dispatchPending();
    } catch (error) {
      this.options.report?.(error);
    }
  }
}
