import type { DeterministicSummary } from '../shared/deterministic.js';
import type { Task } from '../shared/types.js';
import { FAILURE_ORIGIN_LABELS, type FailureOrigin } from '../shared/deterministic-failure.js';
import { failureDetail } from '../domain/deterministic-failure.js';

/** An execution belongs to an entry, never merely to a stage with a matching name. */
export function ownedScript(task: Pick<Task, 'stageEntry'> & Partial<Pick<Task, 'columnId'>>, summary?: DeterministicSummary): DeterministicSummary | undefined {
  return summary !== undefined && task.stageEntry?.id === summary.entryId && (task.columnId === undefined || task.columnId === task.stageEntry.columnId) ? summary : undefined;
}
export function scriptActive(summary?: DeterministicSummary): boolean {
  return summary?.phase === 'active' || summary?.phase === 'stopping';
}
/** One predicate for the phase every surface names "awaiting approval". */
export function scriptAwaitingApproval(summary?: DeterministicSummary): boolean {
  return summary?.phase === 'awaiting-trust';
}
export function scriptFailureOrigin(summary: DeterministicSummary): FailureOrigin | undefined {
  return failureDetail(summary.error?.details)?.origin;
}
/** The drawer heading: names the failure origin when the record carries one. */
export function scriptLabel(summary: DeterministicSummary): string {
  // A saved result that could not be delivered is a distinct state from a script
  // failure: the program finished and only its route is pending.
  if (summary.phase === 'failed' && summary.deliveryStatus === 'failed') return 'Script result delivery failed';
  if (summary.phase === 'failed' && summary.error?.code === 'PARAMETERS_REQUIRED') return 'Script: parameters required';
  if (summary.phase === 'failed') {
    const origin = scriptFailureOrigin(summary);
    if (origin === 'infrastructure') return 'Script: infrastructure failure';
    if (origin === 'configuration') return 'Script: configuration failure';
    if (origin === 'contract') return 'Script: completion rejected';
  }
  switch (summary.phase) {
    case 'capture-pending': return 'Script: capturing program';
    case 'awaiting-trust': return 'Script: awaiting approval';
    case 'active': return 'Script running';
    case 'stopping': return 'Script stopping';
    case 'stopped': return 'Script stopped';
    case 'result-ready': return 'Script result awaiting delivery';
    case 'delivering': return 'Script result delivering';
    case 'failed': return 'Script failed';
  }
}
/** The card label: short enough for a narrow column, with the detail left to the drawer. */
export function scriptCardLabel(summary: DeterministicSummary): string {
  if (summary.phase === 'failed' && summary.deliveryStatus === 'failed') return 'Script result delivery failed';
  if (summary.phase === 'failed' && summary.error?.code === 'PARAMETERS_REQUIRED') return 'Script: parameters required';
  if (summary.phase === 'failed') {
    const origin = scriptFailureOrigin(summary);
    if (origin === 'infrastructure') return 'Script: tool failure';
    if (origin === 'configuration') return 'Script: setup problem';
    if (origin === 'contract') return 'Script: completion rejected';
    return 'Script failed';
  }
  return scriptLabel(summary);
}

/** One labeled fact the script panel shows beside the failure message. */
export interface ScriptFailureFact { readonly label: string; readonly value: string }

function admissionText(admission: 'not-admitted' | 'started' | 'unknown'): string {
  return admission === 'started' ? 'command started' : admission === 'not-admitted' ? 'command not admitted' : 'admission unknown';
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
}

/**
 * The failure facts a card or drawer presents: the origin, the code, the attempts
 * it made, the nested cause and what the guard observed. A record written before
 * this vocabulary existed has no facts, and the panel keeps the generic label.
 */
export function scriptFailureFacts(summary: DeterministicSummary): ScriptFailureFact[] {
  if (summary.phase !== 'failed' || summary.error === undefined) return [];
  const detail = failureDetail(summary.error.details);
  if (detail === undefined) return [];
  const facts: ScriptFailureFact[] = [
    { label: 'Failure origin', value: FAILURE_ORIGIN_LABELS[detail.origin] },
    { label: 'Failure code', value: summary.error.code },
  ];
  const attempts = detail.attempts?.length ?? 0;
  if (attempts > 0) facts.push({ label: 'Attempts', value: String(attempts) });
  if (detail.cause !== undefined) {
    facts.push({ label: 'Cause', value: detail.cause.message.trim() ? detail.cause.code + ' — ' + truncate(detail.cause.message.trim(), 200) : detail.cause.code });
  }
  const guard = detail.guard;
  if (guard !== undefined) {
    facts.push({ label: 'Guard', value: admissionText(guard.admission) });
    facts.push({ label: 'Guard exit', value: guard.signal === null ? (guard.exitCode === null ? 'no status' : String(guard.exitCode)) : 'signal ' + guard.signal });
    facts.push({ label: 'Guard time', value: guard.elapsedMs + ' ms' });
    facts.push({ label: 'Guard output', value: guard.stdoutBytes + ' B stdout · ' + guard.stderrBytes + ' B stderr' });
    const stdout = guard.stdoutHead.trim();
    if (stdout.length > 0) facts.push({ label: 'Guard stdout', value: stdout.slice(0, 256) });
    const diagnostic = guard.stderrTail.trim();
    if (diagnostic.length > 0) facts.push({ label: 'Guard diagnostic', value: diagnostic.slice(0, 512) });
  }
  return facts;
}
