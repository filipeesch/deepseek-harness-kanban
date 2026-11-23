import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { openRoundNotice, registerQuestionNotice } from '../../src/host/question-notice.js';
import { QuestionIndex } from '../../src/questions/index.js';
import type { QuestionRound } from '../../src/shared/types.js';
import { call, end, result } from '../questions/fixtures.js';

function round(id: string, questions: readonly string[], overrides: Partial<QuestionRound> = {}): QuestionRound {
  const turnId = id.replace(/\D/g, '') === '' ? '1' : id.replace(/\D/g, '');
  return {
    id, sessionId: 'session-1', turnId,
    pages: questions.map((question, index) => ({ callId: id + '-' + index, sequence: index, page: { question, type: 'freetext' } })),
    complete: true, answered: false, ...overrides,
  };
}

const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
const textOf = (message: { content: ReadonlyArray<unknown> }) => (message.content[0] as { text: string }).text;

function setup(roundsBySession: Record<string, readonly QuestionRound[]>) {
  const ctx = new Context();
  const dispose = registerQuestionNotice(ctx, { rounds: id => roundsBySession[id] ?? [] });
  const agents = new Map<string, Agent>();
  const agent = (id = 'session-1'): Agent => {
    let value = agents.get(id);
    if (value === undefined) { value = { id: SessionId(id) } as Agent; agents.set(id, value); }
    return value;
  };
  const step = async (messages: UserMessage[], id = 'session-1') => {
    const entered = await ctx.waterfall('agent/pre-step', {
      agent: agent(id), turn: 1, step: 1,
      modelSelection: { provider: 'fixture', model: 'fixture' },
      signal: new AbortController().signal,
      messages,
    }, async () => ({ kind: 'enter' as const, messages }));
    if (entered.kind !== 'enter') throw new Error('expected enter');
    return entered.messages;
  };
  return { ctx, dispose, step };
}

describe('open round notice', () => {
  it('names every open round with its progress and questions', async () => {
    const f = setup({ 'session-1': [round('q1', ['Which storage?', 'Which region?']), round('q2', ['Ship or wait?'])] });
    const messages = await f.step([user('Continue.')]);
    expect(messages).toHaveLength(2);
    const text = textOf(messages[0]!);
    expect(text).toContain('Open question rounds in this conversation');
    expect(text).toContain('Round 1 (2 pages): Which storage? | Which region?');
    expect(text).toContain('Round 2 (1 page): Ship or wait?');
    expect(text).toContain('Do not ask these questions again');
    expect(messages[0]!.source).toMatchObject({ kind: 'question-notice', form: 'notice', summary: 'Open questions', roundIds: ['q1', 'q2'] });
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'Continue.' }]);
    expect(messages[1]!.source).toEqual({ kind: 'user' });
    f.dispose();
  });

  it('adds nothing when the conversation has no open round', async () => {
    const f = setup({
      'session-1': [round('done', ['Answered?'], { answered: true }), round('empty', [])],
      'session-2': [round('other', ['Elsewhere?'])],
    });
    const messages = await f.step([user('Continue.')]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.source).toEqual({ kind: 'user' });
    f.dispose();
  });

  it('bounds a long stack instead of naming every round', async () => {
    const rounds = Array.from({ length: 7 }, (_value, index) => round('q' + (index + 1), ['Question ' + (index + 1)]));
    const f = setup({ 'session-1': rounds });
    const text = textOf((await f.step([user('Continue.')]))[0]!);
    expect(text).toContain('Round 5 (1 page): Question 5');
    expect(text).not.toContain('Question 6');
    expect(text).toContain('2 more unanswered rounds are open.');
    f.dispose();
  });

  it('clips a long question and refuses an empty stack', () => {
    const long = openRoundNotice([round('q', ['x'.repeat(400)])]);
    expect(long).toBeDefined();
    expect(long!.length).toBeLessThan(600);
    expect(long).toContain('...');
    expect(openRoundNotice([])).toBeUndefined();
    expect(openRoundNotice([round('q', [], { pages: [] })])).toBeUndefined();
  });

  it('is never counted as the person\'s reply by the question projection', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 1, 'root'), result(2, 1, 'root'), end(3, 1)]) index.apply('session-1', event);
    index.apply('session-1', { type: 'user/message', seq: 4, data: { role: 'user', content: [{ type: 'text', text: 'Open question rounds in this conversation' }], source: { kind: 'question-notice' } } });
    // The notice never retires the round; only a recorded answer or dismissal does.
    expect(index.getRounds('session-1')[0]!.answered).toBe(false);
    expect(index.pending('session-1')).toBe(true);
  });
});
