import type { TaskSummary } from './hub-repository.js';

/**
 * The task ids that currently hold a confirmed pending transition. It is derived from
 * repository state on every change, so command paths can skip the dispatch scan entirely
 * when nothing is pending instead of walking every task.
 */
export class PendingTransitionIndex {
  private ids: readonly string[] = [];

  refresh(summaries: readonly TaskSummary[]): readonly string[] {
    this.ids = summaries.filter(summary => summary.hasPendingTransition).map(summary => summary.taskId);
    return this.ids;
  }

  list(): readonly string[] {
    return this.ids;
  }

  get empty(): boolean {
    return this.ids.length === 0;
  }
}
