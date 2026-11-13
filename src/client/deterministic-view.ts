import type { DeterministicHold, DeterministicSummary } from '../shared/deterministic.js';
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
    case 'awaiting-trust': return 'Script: awaiting local trust';
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
  // A held result shares the narrow card row with its actions, so it names the state
  // without repeating the full drawer label the notice already explains.
  if (summary.phase === 'result-ready' && summary.hold !== undefined) return 'Result held';
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

const HOLD_REASONS: Record<DeterministicHold['code'], string> = {
  'task-operation': 'Waiting for a task directory operation to finish.',
  'project-operation': 'Waiting for the project relocation to finish.',
  'pending-transition': 'Waiting for the recorded stage transition to settle.',
  'worktree-not-ready': 'Waiting for the task worktree to be ready.',
  'project-directory-missing': 'The project has no directory. Adopt it, then deliver this result.',
  'execution-directory-changed': 'The execution directory changed. Repair the binding, then deliver this result.',
  'auto-mode-hold': 'The task is paused. Resume it to deliver this result.',
  'context-reserved': 'Waiting for another task context operation to finish.',
  'conversation-active': 'Waiting for the task conversation to finish its turn.',
  'background-work': 'Waiting for background work to finish.',
  'pending-user-work': 'Waiting for your answer in the task conversation.',
  'conversation-unreadable': 'The task conversation could not be read. Delivery is retried when it reports activity.',
  'stale-authority': 'This saved result no longer owns the stage entry.',
};
const PENDING_LABELS: Record<NonNullable<DeterministicHold['pending']>[number], string> = {
  'decision-question': 'A question in this task', 'native-question': 'A native question', approval: 'An approval request', 'queued-prompt': 'A queued prompt',
};
/** The one sentence that explains why a saved result has not been delivered. */
export function holdLabel(hold: DeterministicHold): string { return HOLD_REASONS[hold.code]; }
/** The bounded facts behind a hold: named background work and pending user work. */
export function holdDetail(hold: DeterministicHold): string[] {
  const facts: string[] = [];
  for (const fact of hold.background ?? []) facts.push((fact.kind === 'job' ? 'Job: ' : 'Schedule: ') + fact.label);
  for (const kind of hold.pending ?? []) facts.push('Waiting for: ' + PENDING_LABELS[kind]);
  return facts;
}
/** The jobs the drawer may cancel for this hold; only a real job id is offered. */
export function holdJobs(hold: DeterministicHold): Array<{ id: string; label: string }> {
  return (hold.background ?? []).flatMap(fact => fact.kind === 'job' && fact.id !== undefined ? [{ id: fact.id, label: fact.label }] : []);
}
/** What the user can do about this hold, or the wait it explains. */
export function holdNextStep(hold: DeterministicHold): string {
  if (hold.code === 'background-work') return holdJobs(hold).length > 0 ? 'Cancel the blocking job to deliver now, or wait for it to finish.' : 'Delivery resumes when the schedule is idle.';
  if (hold.code === 'pending-user-work') return 'Answer the pending work; delivery resumes then.';
  if (hold.code === 'auto-mode-hold') return 'Resume the task to deliver this result.';
  if (hold.code === 'pending-transition') return 'Resolve the recorded transition; delivery resumes then.';
  if (hold.code === 'conversation-active') return 'Delivery resumes when the turn ends.';
  return 'Delivery resumes when this condition clears.';
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
