import type { QuestionRound } from '../shared/types.js';

/** One deterministic answer to "may this form submit right now, and why not?". */
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
 * The one round the composer dock shows. A rolled-back round wins so its retry is
 * visible, then an in-flight submitted round so its mounted form keeps the draft;
 * otherwise the newest unresolved round wins.
 */
export function selectActiveRound(
  rounds: readonly QuestionRound[],
  sessionId: string,
  isSubmitted: (roundId: string) => boolean,
  focusedRoundId?: string,
): QuestionRound | undefined {
  const candidates = rounds.filter(round => round.sessionId === sessionId && !round.answered && round.pages.length > 0).sort(compareRounds);
  const focused = focusedRoundId === undefined ? undefined : candidates.find(round => round.id === focusedRoundId);
  if (focused) return focused;
  return candidates.findLast(round => isSubmitted(round.id)) ?? candidates.at(-1);
}
