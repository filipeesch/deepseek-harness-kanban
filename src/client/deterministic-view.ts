import type { DeterministicSummary } from '../shared/deterministic.js';
import type { Task } from '../shared/types.js';

/** An execution belongs to an entry, never merely to a stage with a matching name. */
export function ownedScript(task: Pick<Task, 'stageEntry'> & Partial<Pick<Task, 'columnId'>>, summary?: DeterministicSummary): DeterministicSummary | undefined {
  return summary !== undefined && task.stageEntry?.id === summary.entryId && (task.columnId === undefined || task.columnId === task.stageEntry.columnId) ? summary : undefined;
}
export function scriptActive(summary?: DeterministicSummary): boolean {
  return summary?.phase === 'active' || summary?.phase === 'stopping';
}
export function scriptLabel(summary: DeterministicSummary): string {
  // A saved result that could not be delivered is a distinct state from a script
  // failure: the program finished and only its route is pending.
  if (summary.phase === 'failed' && summary.deliveryStatus === 'failed') return 'Script result delivery failed';
  if (summary.phase === 'failed' && summary.error?.code === 'PARAMETERS_REQUIRED') return 'Script: parameters required';
  switch (summary.phase) {
    case 'capture-pending': return 'Script: capturing program';
    case 'awaiting-trust': return 'Script: awaiting local trust';
    case 'active': return 'Script running';
    case 'stopping': return 'Script stopping';
    case 'stopped': return 'Script stopped';
    case 'result-ready': return 'Script result awaiting delivery';
    case 'delivering': return 'Script result delivering';
    case 'failed': return 'Script failed';
  }
}
