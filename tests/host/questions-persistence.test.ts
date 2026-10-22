import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { BoardStore } from '../../src/domain/store.js';
import { KanbanApp } from '../../src/host/app.js';
import { openQuestionStorage, type QuestionStore } from '../../src/host/question-storage.js';
import { QuestionIndex, type QuestionSessionRecord } from '../../src/questions/indexer.js';
import { MemoryStorage, TestGit, TestSessions } from './helpers.js';
import { call, result } from '../questions/fixtures.js';

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
  return new KanbanApp(await BoardStore.open(new MemoryStorage()), new TestSessions(), new TestGit(), {
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
    await first.close();
    const second = await openQuestionStorage(ctx);
    expect(second.storage.load('s')).toEqual(record);
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

  it('restores pages and the answered state from storage when history is empty', async () => {
    const record: QuestionSessionRecord = { version: 1, sessionId: 's', events: [
      { kind: 'call', seq: 1, turn: 1, callId: 'c', name: 'decision_request' },
      { kind: 'native-page', seq: 2, turn: 1, callId: 'c', page: { question: 'Stored question', type: 'freetext' } },
      { kind: 'end', seq: 3, turn: 1 },
      { kind: 'human', seq: 4 },
    ] };
    const store: QuestionStore = { load: id => id === 's' ? record : undefined, save: async () => {} };
    const app = await appWith(store);
    const rounds = await app.rounds('s');
    expect(rounds[0]?.pages[0]?.page.question).toBe('Stored question');
    expect(rounds[0]?.answered).toBe(true);
    await app.close();
  });

  it('debounces accepted events into one write and flushes on close', async () => {
    vi.useFakeTimers();
    const saves: string[] = [];
    const store: QuestionStore = { load: () => undefined, save: async id => { saves.push(id); } };
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
    const store: QuestionStore = { load: () => undefined, save: async () => { throw new Error('write failed'); } };
    const app = await appWith(store, { report });
    app.observe('s', call(1, 1, 'c'));
    app.observe('s', result(2, 1, 'c'));
    await vi.advanceTimersByTimeAsync(250);
    expect(report).toHaveBeenCalledTimes(1);
    const rounds = await app.rounds('s');
    expect(rounds[0]?.pages).toHaveLength(1);
    await app.close();
  });
});
