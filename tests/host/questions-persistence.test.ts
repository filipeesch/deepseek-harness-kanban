import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanApp } from '../../src/host/app.js';
import { openQuestionStorage, type QuestionStore } from '../../src/host/question-storage.js';
import { QuestionIndex, type QuestionSessionRecord } from '../../src/questions/indexer.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';
import { call, end, human, result } from '../questions/fixtures.js';

afterEach(() => { vi.useRealTimers(); });

function fakeFacility() {
  const specs: Array<{ name: string; version: number; layout?: string; tables: Record<string, unknown> }> = [];
  const state = new Map<string, Map<string, Map<string, unknown>>>();
  return {
    specs,
    async open(spec: { name: string; version: number; layout?: string; tables: Record<string, unknown> }) {
      specs.push(spec);
      let tables = state.get(spec.name);
      if (!tables) {
        tables = new Map();
        for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
        state.set(spec.name, tables);
      }
      return {
        name: spec.name,
        global: undefined,
        table(name: string) {
          const map = tables!.get(name);
          if (!map) throw new Error('Unknown table ' + name);
          return {
            get: (key: string) => map.get(key),
            entries: () => map.entries(),
            keys: () => map.keys(),
            get size() { return map.size; },
            put: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); },
            delete: async (key: string) => map.delete(key),
            update: async () => { throw new Error('unused'); },
          };
        },
        async close() {},
      };
    },
  };
}
async function appWith(store: QuestionStore | undefined, options: { report?: (error: unknown) => void; history?: () => Promise<readonly unknown[]> } = {}) {
  return new KanbanApp(await HubRepository.open(new MemoryHubStorage()), new TestSessions(), new TestGit(), {
    history: options.history ?? (async () => []),
    questionStore: store,
    ...(options.report ? { report: options.report } : {}),
  });
}

describe('conversation question persistence', () => {
  it('declares a per-record conversation domain and round-trips one session record', async () => {
    const facility = fakeFacility();
    const ctx = { storageDomain: facility } as unknown as Context;
    const first = await openQuestionStorage(ctx);
    expect(facility.specs[0]).toMatchObject({ name: 'kanban_questions', version: 1, layout: 'per-record' });
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [{ kind: 'human', seq: 1 }] };
    await first.storage.save('s', record);
    expect(first.storage.load('s')).toEqual(record);
    const withDismissal: QuestionSessionRecord = { ...record, dismissedTurns: [3, 7] };
    await first.storage.save('s', withDismissal);
    expect(first.storage.load('s')).toEqual(withDismissal);
    const legacy: QuestionSessionRecord = { version: 1, sessionId: 'legacy', events: [{ kind: 'human', seq: 1 }] };
    await first.storage.save('legacy', legacy);
    expect(first.storage.load('legacy')).toEqual(legacy);
    await first.close();
    const second = await openQuestionStorage(ctx);
    expect(second.storage.load('s')).toEqual(withDismissal);
    await second.close();
  });

  it('propagates a domain open failure so the plugin fails loud', async () => {
    const ctx = { storageDomain: { open: async () => { throw new Error('backend down'); } } } as unknown as Context;
    await expect(openQuestionStorage(ctx)).rejects.toThrow('backend down');
  });

  it('rejects a malformed stored event without changing the index', () => {
    const index = new QuestionIndex();
    expect(() => index.restoreSession({ version: 1, sessionId: 's', events: [{ kind: 'call' }] })).toThrow();
    expect(index.getRounds('s')).toEqual([]);
  });

  it('restores pages and the retired state from storage when history is empty', async () => {
    // The durable retirement list is what retires a stored round; a human event does not.
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Stored question', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
      { kind: 'human', seq: 4 },
    ], dismissedTurns: [1] };
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async () => {}, remove: async () => false };
    const app = await appWith(store);
    const rounds = await app.rounds('s');
    expect(rounds[0]?.pages[0]?.page.question).toBe('Stored question');
    expect(rounds[0]?.answered).toBe(true);
    expect(app.questions.pending('s')).toBe(false);
    await app.close();
  });

  it('debounces accepted events into one write and flushes on close', async () => {
    vi.useFakeTimers();
    const saves: string[] = [];
    const store: QuestionStore = { load: () => undefined, save: async id => { saves.push(id); }, remove: async () => false };
    const app = await appWith(store);
    app.observe('s', call(1, 1, 'c'));
    app.observe('s', result(2, 1, 'c'));
    await vi.advanceTimersByTimeAsync(249);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toEqual(['s']);
    app.observe('s', result(3, 1, 'c2'));
    await app.close();
    expect(saves).toEqual(['s', 's']);
  });

  it('reports a write failure and keeps the in-memory round available', async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const store: QuestionStore = { load: () => undefined, save: async () => { throw new Error('write failed'); }, remove: async () => false };
    const app = await appWith(store, { report });
    app.observe('s', call(1, 1, 'c'));
    app.observe('s', result(2, 1, 'c'));
    await vi.advanceTimersByTimeAsync(250);
    expect(report).toHaveBeenCalledTimes(1);
    const rounds = await app.rounds('s');
    expect(rounds[0]?.pages).toHaveLength(1);
    await app.close();
  });

  it('dismisses only the chosen round, persists immediately, and keeps the others', async () => {
    const saves: QuestionSessionRecord[] = [];
    const store: QuestionStore = { load: () => undefined, save: async (_id, record) => { saves.push(structuredClone(record)); }, remove: async () => false };
    const app = await appWith(store);
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    app.observe('s', call(4, 2, 'b'));
    app.observe('s', result(5, 2, 'b'));
    app.observe('s', end(6, 2));
    const rounds = await app.rounds('s');
    expect(rounds).toHaveLength(2);
    const remaining = await app.dismissQuestions('s', rounds[0]!.id);
    expect(remaining.filter(round => !round.answered).map(round => round.turnId)).toEqual(['2']);
    expect((await app.rounds('s')).filter(round => !round.answered).map(round => round.turnId)).toEqual(['2']);
    expect(app.questions.pending('s')).toBe(true);
    expect(saves.at(-1)?.dismissedTurns).toEqual([1]);
    expect(saves.at(-1)?.events.some(event => event.kind === 'native-page' && event.turn === 1)).toBe(false);
    const sessions = app.sessions as unknown as { sent: unknown[]; archived: string[] };
    expect(sessions.sent).toEqual([]);
    expect(sessions.archived).toEqual([]);
    app.observe('s', call(7, 3, 'c'));
    app.observe('s', result(8, 3, 'c'));
    expect((await app.rounds('s')).filter(round => !round.answered).map(round => round.turnId)).toEqual(['2', '3']);
    expect(app.questions.pending('s')).toBe(true);
    await app.close();
  });

  it('rejects an unknown or already retired round and never retires a round for a chat reply', async () => {
    const app = await appWith(undefined);
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    const round = (await app.rounds('s'))[0]!;
    await expect(app.dismissQuestions('s', 'question-round:s:99')).rejects.toMatchObject({ code: 'QUESTION_ROUND_NOT_FOUND' });
    // A steering message is not an answer: the round stays available.
    app.observe('s', human(4));
    expect((await app.rounds('s')).filter(value => !value.answered)).toHaveLength(1);
    await expect(app.dismissQuestions('s', round.id)).resolves.toBeDefined();
    await expect(app.dismissQuestions('s', round.id)).rejects.toMatchObject({ code: 'QUESTION_ROUND_NOT_FOUND' });
    expect((await app.rounds('s')).filter(value => !value.answered)).toHaveLength(0);
    await app.close();
  });

  it('presents a legacy round once when it carries no durable retirement marker', async () => {
    // The previous version retired a round on any later human message. That heuristic is
    // gone, so such a record has no marker and the round is presented once after upgrade.
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Legacy question', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
      { kind: 'human', seq: 4 },
    ] };
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async () => {}, remove: async () => false };
    const app = await appWith(store);
    const rounds = await app.rounds('s');
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.answered).toBe(false);
    expect(app.questions.pending('s')).toBe(true);
    await app.close();
  });

  it('never publishes a retirement the store rejected', async () => {
    const report = vi.fn();
    let release!: () => void;
    let started!: () => void;
    const saveStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store: QuestionStore = {
      load: () => undefined,
      save: async () => { started(); await gate; throw new Error('disk full'); },
      remove: async () => false,
    };
    const app = await appWith(store, { report });
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    const round = (await app.rounds('s'))[0]!;
    let notifications = 0;
    const stop = app.questions.subscribe(() => { notifications += 1; });
    const dismissal = app.dismissQuestions('s', round.id);
    await saveStarted;
    // The live projection is untouched while the durable write is still open.
    expect(notifications).toBe(0);
    expect(app.questions.pending('s')).toBe(true);
    release();
    await expect(dismissal).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(notifications).toBe(0);
    expect(app.questions.pending('s')).toBe(true);
    expect((await app.rounds('s')).filter(value => !value.answered)).toHaveLength(1);
    stop();
    await app.close();
  });

  it('a queued autosave cannot undo a successful retirement', async () => {
    const saves: QuestionSessionRecord[] = [];
    const gates: Array<() => void> = [];
    const store: QuestionStore = {
      load: () => undefined,
      save: async (_id, record) => { saves.push(record); await new Promise<void>(resolve => gates.push(resolve)); },
      remove: async () => false,
    };
    const until = async (check: () => boolean): Promise<void> => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('condition not reached');
    };
    const app = await appWith(store);
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    const round = (await app.rounds('s'))[0]!;
    const dismissal = app.dismissQuestions('s', round.id);
    await until(() => gates.length === 1);
    // A live event schedules the debounced autosave while the retirement write waits.
    app.observe('s', call(4, 1, 'b'));
    await new Promise(resolve => setTimeout(resolve, 320));
    // The retirement write finishes first; the queued autosave runs only after it applied.
    gates[0]!();
    await dismissal;
    await until(() => gates.length === 2);
    gates[1]!();
    await until(() => saves.length >= 2);
    // The last write is authoritative and carries the durable retirement.
    expect(saves.at(-1)!.dismissedTurns).toContain(1);
    const reloaded = await appWith({
      load: sessionId => sessionId === 's' ? saves.at(-1) : undefined,
      save: async () => {},
      remove: async () => false,
    });
    expect((await reloaded.rounds('s')).filter(value => !value.answered)).toHaveLength(0);
    await app.close();
    await reloaded.close();
  });

  it('retires a round answered before the durable marker existed, from its own reply', async () => {
    vi.useFakeTimers();
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Ship it?', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
      { kind: 'human', seq: 4 },
    ] };
    let saved: QuestionSessionRecord | undefined;
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async (_id, value) => { saved = structuredClone(value); }, remove: async () => false };
    const reply = { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '### 1. Ship it?\n\nAnswer: yes' }] } };
    const app = await appWith(store, { history: async () => [reply] });
    const rounds = await app.rounds('s');
    expect(rounds.filter(value => !value.answered)).toEqual([]);
    expect(app.questions.pending('s')).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(saved?.dismissedTurns).toEqual([1]);
    await app.close();
  });

  it('never retires a legacy round from an ordinary steering message', async () => {
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Ship it?', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
      { kind: 'human', seq: 4 },
    ] };
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async () => {}, remove: async () => false };
    const steering = { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue with the next step.' }] } };
    const app = await appWith(store, { history: async () => [steering] });
    expect((await app.rounds('s')).filter(value => !value.answered)).toHaveLength(1);
    await app.close();
  });

  it('does not treat a host context message as the person answering', async () => {
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Ship it?', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
    ] };
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async () => {}, remove: async () => false };
    const context = { type: 'user/message', seq: 5, data: { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '### 1. Ship it?\n\nAnswer: yes' }] } };
    const app = await appWith(store, { history: async () => [context] });
    expect((await app.rounds('s')).filter(value => !value.answered)).toHaveLength(1);
    await app.close();
  });

  it('records an admitted answer durably and never presents the round again', async () => {
    let saved: QuestionSessionRecord | undefined;
    const store: QuestionStore = { load: id => id === 's' ? saved : undefined, save: async (_id, record) => { saved = structuredClone(record); }, remove: async () => false };
    const first = await appWith(store);
    first.observe('s', call(1, 1, 'a'));
    first.observe('s', result(2, 1, 'a'));
    first.observe('s', end(3, 1));
    const round = (await first.rounds('s'))[0]!;
    await first.answerQuestionRound('s', round.id);
    expect(saved?.dismissedTurns).toEqual([1]);
    expect(saved?.events.some(event => event.kind === 'native-page')).toBe(false);
    expect(first.questions.pending('s')).toBe(false);
    await first.close();
    const replay = [call(1, 1, 'a'), result(2, 1, 'a'), end(3, 1)];
    const second = await appWith(store, { history: async () => replay });
    expect((await second.rounds('s')).filter(value => !value.answered)).toEqual([]);
    expect(second.questions.pending('s')).toBe(false);
    await second.close();
  });

  it('rolls back the recorded answer when the durable write fails', async () => {
    const report = vi.fn();
    const store: QuestionStore = { load: () => undefined, save: async () => { throw new Error('disk full'); }, remove: async () => false };
    const app = await appWith(store, { report });
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    const round = (await app.rounds('s'))[0]!;
    await expect(app.answerQuestionRound('s', round.id)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect((await app.rounds('s')).filter(value => !value.answered).map(value => value.id)).toEqual([round.id]);
    expect(app.questions.pending('s')).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    await app.close();
  });

  it('keeps the pending work of one round when the other round is answered', async () => {
    const app = await appWith(undefined);
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    app.observe('s', call(4, 2, 'b'));
    app.observe('s', result(5, 2, 'b'));
    app.observe('s', end(6, 2));
    const rounds = await app.rounds('s');
    await app.answerQuestionRound('s', rounds[0]!.id);
    expect(app.questions.pending('s')).toBe(true);
    await app.answerQuestionRound('s', rounds[1]!.id);
    expect(app.questions.pending('s')).toBe(false);
    await app.close();
  });

  it('rolls back the dismissal and rejects when the durable write fails', async () => {
    const report = vi.fn();
    const store: QuestionStore = { load: () => undefined, save: async () => { throw new Error('disk full'); }, remove: async () => false };
    const app = await appWith(store, { report });
    app.observe('s', call(1, 1, 'a'));
    app.observe('s', result(2, 1, 'a'));
    app.observe('s', end(3, 1));
    const round = (await app.rounds('s'))[0]!;
    await expect(app.dismissQuestions('s', round.id)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect((await app.rounds('s')).map(value => value.id)).toEqual([round.id]);
    expect(app.questions.pending('s')).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    await app.close();
  });

  it('keeps the round retired when the app and transcript are reconstructed', async () => {
    let saved: QuestionSessionRecord | undefined;
    const store: QuestionStore = { load: id => id === 's' ? saved : undefined, save: async (_id, record) => { saved = structuredClone(record); }, remove: async () => false };
    const first = await appWith(store);
    first.observe('s', call(1, 1, 'a'));
    first.observe('s', result(2, 1, 'a'));
    first.observe('s', end(3, 1));
    const round = (await first.rounds('s'))[0]!;
    await first.dismissQuestions('s', round.id);
    expect(saved?.dismissedTurns).toEqual([1]);
    await first.close();

    const replay = [call(1, 1, 'a'), result(2, 1, 'a'), end(3, 1)];
    const second = await appWith(store, { history: async () => replay });
    // The retired round keeps its marker but is never presented again.
    expect((await second.rounds('s')).filter(value => !value.answered)).toEqual([]);
    expect(second.questions.pending('s')).toBe(false);
    await second.close();
  });

  it('clears the awaiting-reply attention after dismissal', async () => {
    const app = await appWith(undefined);
    const project = await app.store.saveProject({ name: 'Attention project', projectPath: '/memory/repo/app', gitRootPath: '/memory/repo' });
    const created = await app.createTask({ projectId: project.id, title: 'Attention task', description: '' });
    await app.store.addSession(created.id, 'attention-session');
    const task = app.store.requireTask(created.id);
    const sessionId = task.sessionIds[0]!;
    const sessions = app.sessions as unknown as TestSessions;
    sessions.awaiting.add(sessionId);
    app.observe(sessionId, call(1, 1, 'a'));
    app.observe(sessionId, result(2, 1, 'a'));
    app.observe(sessionId, end(3, 1));
    expect((await app.snapshot({refreshSessionIds:[sessionId]})).conversations[sessionId]?.pending.kinds).toEqual(['decision-question', 'native-question']);
    sessions.awaiting.delete(sessionId);
    app.observe(sessionId, { type: 'turn/start', seq: 100, data: { turn: 2 } });
    const round = (await app.rounds(sessionId))[0]!;
    await app.dismissQuestions(sessionId, round.id);
    const attention = (await app.snapshot({refreshSessionIds:[sessionId]})).conversations[sessionId];
    expect(attention?.pending.kinds).toEqual([]);
    await app.close();
  });
});
