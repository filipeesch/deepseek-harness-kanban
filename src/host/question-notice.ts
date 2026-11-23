import type { Context } from '@deepseek-ai/cordis';
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { QuestionRound } from '../shared/types.js';
import { registerPreStepInjection } from './pre-step-injection.js';

/** Durable source kind that marks the open-round notice injected before a step. */
export const QUESTION_NOTICE_SOURCE_KIND = 'question-notice';

/** Producer marker of the model-facing reminder that question rounds are still open. */
export interface KanbanQuestionNoticeSource {
  readonly kind: 'question-notice';
  /** One-off account the host shows on the collapsed context row. */
  readonly form: 'notice';
  readonly summary: string;
  /** The rounds the notice names; the transcript never carries it as the person's reply. */
  readonly roundIds: readonly string[];
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'question-notice': KanbanQuestionNoticeSource;
  }
}

/** The most rounds one notice names; a longer stack is summarized instead of listed. */
export const NOTICE_MAX_ROUNDS = 5;
/** The longest one question may be in a notice line. */
const NOTICE_MAX_QUESTION = 160;
/** The longest one round's line may be, so a stack of long questions stays bounded. */
const NOTICE_MAX_LINE = 240;

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : clean.slice(0, limit - 3) + '...';
}

/**
 * What the agent is told about the conversation's unanswered rounds.
 *
 * The transcript already carries the pages the agent asked for; this notice only names
 * the rounds that are still open, so the agent can avoid repeating them. It is bounded
 * in rounds and characters, and it never states or invents an answer.
 */
export function openRoundNotice(rounds: readonly QuestionRound[]): string | undefined {
  const open = rounds.filter(round => !round.answered && round.pages.length > 0);
  if (open.length === 0) return undefined;
  const shown = open.slice(0, NOTICE_MAX_ROUNDS);
  const lines = shown.map((round, index) => {
    const pages = [...round.pages].sort((left, right) => left.sequence - right.sequence || left.callId.localeCompare(right.callId));
    const questions = pages.map(page => clip(page.page.question, NOTICE_MAX_QUESTION)).join(' | ');
    const count = pages.length === 1 ? '1 page' : pages.length + ' pages';
    return clip('Round ' + (index + 1) + ' (' + count + '): ' + questions, NOTICE_MAX_LINE);
  });
  if (open.length > shown.length) lines.push((open.length - shown.length) + ' more unanswered rounds are open.');
  return [
    'Open question rounds in this conversation: the person has not answered them yet.',
    ...lines,
    'Do not ask these questions again; wait for the answer, and build on it when it arrives.',
  ].join('\n');
}

export interface QuestionNoticeOptions {
  /** The conversation's rounds, as its question projection currently holds them. */
  rounds(sessionId: string): readonly QuestionRound[];
}

/**
 * Tell the agent, before a step, which question rounds of its conversation are still
 * open. The notice goes before the step's own messages and carries a host source, so the
 * question projection never counts it as the person's reply and no round is retired by it.
 */
export function registerQuestionNotice(ctx: Context, options: QuestionNoticeOptions): () => void {
  return registerPreStepInjection(ctx, {
    async select({ agent, signal }) {
      if (signal.aborted) return undefined;
      const rounds = options.rounds(agent.id);
      const text = openRoundNotice(rounds);
      if (text === undefined) return undefined;
      const named = rounds.filter(round => !round.answered && round.pages.length > 0).slice(0, NOTICE_MAX_ROUNDS);
      const source: KanbanQuestionNoticeSource = {
        kind: QUESTION_NOTICE_SOURCE_KIND,
        form: 'notice',
        summary: boundContextSummary('Open questions'),
        // Only the rounds the text names, so a long stack cannot flood the recorded context.
        roundIds: named.map(round => round.id),
      };
      const message: UserMessage = createUserMessage({ content: [{ type: 'text', text }], source });
      return message;
    },
  });
}
