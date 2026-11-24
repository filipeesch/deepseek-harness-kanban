import type { QuestionRound } from '../shared/types.js';

/** One human message from the conversation's canonical history. */
export interface HumanReply {
  readonly seq: number;
  readonly text: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Whether a human message is the textual answer a submitted round produces.
 *
 * The dock submits a round as one reply whose blocks are `### <n>. <question>` followed
 * by the answer (`Answer:` or `Other:`). A steering message never carries that shape,
 * so it can never retire a round.
 */
export function isAnswerReply(pageQuestions: readonly string[], text: string): boolean {
  const body = normalize(text);
  if (body === '') return false;
  let cursor = 0;
  for (let index = 0; index < pageQuestions.length; index += 1) {
    const marker = normalize('### ' + (index + 1) + '. ' + pageQuestions[index]);
    const at = body.indexOf(marker, cursor);
    if (at < 0) return false;
    cursor = at + marker.length;
    const answer = body.indexOf('Answer:', cursor);
    const other = body.indexOf('Other:', cursor);
    const label = answer >= 0 && (other < 0 || answer < other) ? 'Answer:' : other >= 0 ? 'Other:' : undefined;
    if (label === undefined) return false;
    const valueStart = body.indexOf(label, cursor) + label.length;
    const nextBlock = body.indexOf('### ', valueStart);
    if (body.slice(valueStart, nextBlock < 0 ? undefined : nextBlock).trim() === '') return false;
  }
  return true;
}

/**
 * The unresolved rounds whose own submission reply already exists in the conversation.
 *
 * A round's reply is sent after the round was asked and before the next round is asked,
 * so the messages are bounded by the rounds' own order. This reconstructs the durable
 * retirement of a round answered before the plugin recorded one, without ever treating
 * an ordinary steering message as an answer.
 */
export function answeredRoundIds(rounds: readonly QuestionRound[], replies: readonly HumanReply[]): string[] {
  const open = rounds
    .filter(round => round.complete && !round.answered && round.pages.length > 0)
    .sort((left, right) => Number(left.turnId) - Number(right.turnId));
  if (open.length === 0 || replies.length === 0) return [];
  const matched = new Set<string>();
  for (const reply of [...replies].sort((left, right) => left.seq - right.seq)) {
    // The newest round the message can belong to wins, so identical questions in an
    // older round cannot steal a newer round's answer.
    for (let index = open.length - 1; index >= 0; index -= 1) {
      const round = open[index]!;
      if (matched.has(round.id)) continue;
      const last = Math.max(...round.pages.map(page => page.sequence));
      if (reply.seq <= last) continue;
      const next = open[index + 1];
      if (next !== undefined && reply.seq >= Math.min(...next.pages.map(page => page.sequence))) continue;
      if (!isAnswerReply(round.pages.map(page => page.page.question), reply.text)) continue;
      matched.add(round.id);
      break;
    }
  }
  return [...matched];
}
