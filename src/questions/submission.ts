import type { QuestionRound } from '../shared/types.js';

/** One scripted answer to "may this form submit right now, and why not?". */
export type SubmitState =
  | { kind: 'blocked'; reason: 'invalid' | 'awaiting-turn' }
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'failed'; message: string };

export interface SubmitStateInput {
  complete: boolean;
  answersValid: boolean;
  busy: boolean;
  error: string | null;
}

/** Busy wins, then invalid answers, then the turn-completion gate, then a stale admission error. */
export function submitState(input: SubmitStateInput): SubmitState {
  if (input.busy) return { kind: 'submitting' };
  if (!input.answersValid) return { kind: 'blocked', reason: 'invalid' };
  if (!input.complete) return { kind: 'blocked', reason: 'awaiting-turn' };
  if (input.error) return { kind: 'failed', message: input.error };
  return { kind: 'ready' };
}

/** Whether the Additional Notes Submit action is available; a failed admission may retry. */
export function canSubmit(state: SubmitState): boolean { return state.kind === 'ready' || state.kind === 'failed'; }

function lastSequence(round: QuestionRound): number {
  return round.pages.reduce((max, page) => Math.max(max, page.sequence), -1);
}

function compareRounds(left: QuestionRound, right: QuestionRound): number {
  return Number(left.turnId) - Number(right.turnId) || lastSequence(left) - lastSequence(right) || left.id.localeCompare(right.id);
}

/**
 * Every round the composer dock must present, oldest first.
 *
 * The dock stacks all of them, so a round that arrives while another waits can never
 * hide the earlier one. An in-flight submitted round is still returned until the feed
 * confirms its retirement, which is what keeps its mounted form and draft alive for a
 * rollback. A retired round stays out of the stack.
 */
export function selectVisibleRounds(rounds: readonly QuestionRound[], sessionId: string): readonly QuestionRound[] {
  return rounds
    .filter(round => round.sessionId === sessionId && !round.answered && round.pages.length > 0)
    .sort(compareRounds);
}
