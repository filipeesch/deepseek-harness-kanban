import { describe, expect, it } from 'vitest';
import { answeredRoundIds, isAnswerReply, type HumanReply } from '../../src/questions/answer-reply.js';
import type { QuestionPage, QuestionRound } from '../../src/shared/types.js';

function page(question: string, type: QuestionPage['type'] = 'freetext'): { callId: string; sequence: number; page: QuestionPage } {
  return { callId: 'call-' + question, sequence: 1, page: { question, type } as QuestionPage };
}

function round(id: string, turnId: string, questions: readonly string[], answered = false): QuestionRound {
  return {
    id,
    sessionId: 's',
    turnId,
    complete: true,
    answered,
    pages: questions.map((question, index) => ({ ...page(question), callId: 'call-' + turnId + '-' + index, sequence: Number(turnId) + index })),
  };
}

const reply = (seq: number, text: string): HumanReply => ({ seq, text });

describe('answer reply recognition', () => {
  it('recognizes the textual answer a submitted round produces', () => {
    expect(isAnswerReply(['Ship it?'], '### 1. Ship it?\n\nAnswer: yes')).toBe(true);
    expect(isAnswerReply(['A?', 'B?'], '### 1. A?\n\nAnswer: one\n\n### 2. B?\n\nOther: two')).toBe(true);
  });

  it('never treats a steering message or a partial answer as a submission', () => {
    expect(isAnswerReply(['Ship it?'], 'Continue with the next step.')).toBe(false);
    expect(isAnswerReply(['Ship it?'], '### 1. Ship it?')).toBe(false);
    expect(isAnswerReply(['Ship it?'], '### 1. Ship it?\n\nAnswer:')).toBe(false);
  });

  it('retires only the round its reply belongs to', () => {
    const first = round('r1', '1', ['Ship it?']);
    const second = round('r2', '2', ['Ship it?']);
    // The reply arrives after the second round was asked: it belongs to the second.
    const ids = answeredRoundIds([first, second], [reply(10, '### 1. Ship it?\n\nAnswer: yes')]);
    expect(ids).toEqual(['r2']);
  });

  it('leaves an unanswered round open when the next round was answered', () => {
    const first = round('r1', '1', ['First?']);
    const second = round('r2', '2', ['Second?']);
    const ids = answeredRoundIds([first, second], [reply(10, '### 1. Second?\n\nAnswer: yes')]);
    expect(ids).toEqual(['r2']);
  });

  it('ignores an already retired round and an incomplete round', () => {
    const retired = round('r1', '1', ['Ship it?'], true);
    const incomplete = { ...round('r2', '2', ['Ship it?']), complete: false };
    expect(answeredRoundIds([retired, incomplete], [reply(10, '### 1. Ship it?\n\nAnswer: yes')])).toEqual([]);
  });
});
