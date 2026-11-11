/** The two independent steps one teardown runs after the conversations returned. */
export interface TeardownSteps {
  /** Every refusal that must still be decided before either step mutates anything. */
  prepare(): Promise<void>;
  /** Remove the confirmed checkout; resolves true when this execution removed it. */
  remove(): Promise<boolean>;
  /** Archive the task's conversations. */
  archive(): Promise<'done' | 'waiting' | 'skipped'>;
}

/** What the teardown observed, with each step's failure kept apart. */
export interface TeardownOutcome {
  readonly removed: boolean;
  readonly archived: 'done' | 'waiting' | 'skipped';
  readonly removalError?: unknown;
  readonly archivingError?: unknown;
}

/**
 * Runs checkout removal and native archiving concurrently. Both halves touch
 * different subsystems, and neither can observe the other's intermediate state,
 * so they are independent after the directory return. A refusal raised by
 * preparation escapes before either half starts, and the outcome keeps each
 * step's failure so the caller can name the failing phase.
 */
export class TaskTeardown {
  async run(steps: TeardownSteps): Promise<TeardownOutcome> {
    await steps.prepare();
    const [removal, archiving] = await Promise.allSettled([steps.remove(), steps.archive()]);
    return {
      removed: removal.status === 'fulfilled' && removal.value === true,
      archived: archiving.status === 'fulfilled' ? archiving.value : 'done',
      ...(removal.status === 'rejected' ? { removalError: removal.reason } : {}),
      ...(archiving.status === 'rejected' ? { archivingError: archiving.reason } : {}),
    };
  }
}
