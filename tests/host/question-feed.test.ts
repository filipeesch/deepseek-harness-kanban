import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';
import { KanbanController } from '../../src/host/controller.js';
import type { KanbanApp } from '../../src/host/app.js';
import { QuestionIndex } from '../../src/questions/indexer.js';
import { call, end, result } from '../questions/fixtures.js';

function harness() {
  const questions = new QuestionIndex();
  const app = {
    questions,
    rounds: async (sessionId: string) => [...questions.getRounds(sessionId)],
  } as unknown as KanbanApp;
  return { questions, controller: new KanbanController(new Context(), app) };
}

async function next<T>(iterator: AsyncGenerator<T>): Promise<T> {
  const value = await iterator.next();
  if (value.done) throw new Error('question feed ended');
  return value.value;
}

describe('conversation-scoped question feed', () => {
  it('opens with a baseline and emits only the changed conversation without board projection', async () => {
    const { questions, controller } = harness();
    const abort = new AbortController();
    const frames = controller.questionsFollow({ sessionId: 'a' }, abort.signal);
    try {
      await expect(next(frames)).resolves.toEqual({ kind: 'baseline', rounds: [] });
      questions.apply('b', result(1, 0, 'other'));
      let settled = false;
      const pending = frames.next().then(value => { settled = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(settled, 'an unrelated session must not emit a frame').toBe(false);
      questions.apply('a', result(2, 0, 'mine'));
      const frame = await pending;
      if (frame.done) throw new Error('question feed ended');
      const update = frame.value;
      expect(update.kind).toBe('update');
      expect(update.rounds.map(round => round.sessionId)).toEqual(['a']);
      expect(update.rounds[0]!.pages[0]!.callId).toBe('mine');
    } finally {
      abort.abort();
      await frames.return(undefined);
    }
  });

  it('reports a turn ending so Submit eligibility can advance before board projection', async () => {
    const { questions, controller } = harness();
    questions.apply('a', call(1, 4, 'one'));
    questions.apply('a', result(2, 4, 'one'));
    const abort = new AbortController();
    const frames = controller.questionsFollow({ sessionId: 'a' }, abort.signal);
    try {
      const baseline = await next(frames);
      expect(baseline.kind).toBe('baseline');
      expect(baseline.rounds[0]).toMatchObject({ complete: false, answered: false });
      questions.apply('a', end(3, 4));
      const update = await next(frames);
      expect(update.kind).toBe('update');
      expect(update.rounds[0]).toMatchObject({ complete: true, answered: false });
    } finally {
      abort.abort();
      await frames.return(undefined);
    }
  });
});
