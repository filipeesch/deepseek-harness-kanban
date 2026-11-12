import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { openQuestionStorage, QuestionDraftSessionRecordSchema, type QuestionDraftSessionRecord } from '../../src/host/question-storage.js';

interface FakeSpec { name: string; version: number; layout?: string; tables: Record<string, unknown> }

function fakeFacility(options: { failOn?: string } = {}) {
  const specs: FakeSpec[] = [];
  const closed: string[] = [];
  const state = new Map<string, Map<string, Map<string, unknown>>>();
  return {
    specs,
    closed,
    async open(spec: FakeSpec) {
      if (spec.name === options.failOn) throw new Error('backend down for ' + spec.name);
      specs.push(spec);
      let tables = state.get(spec.name);
      if (!tables) {
        tables = new Map();
        for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
        state.set(spec.name, tables);
      }
      const domain = spec.name;
      return {
        name: spec.name,
        global: undefined,
        table(name: string) {
          const map = tables.get(name);
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
        async close() { closed.push(domain); },
      };
    },
  };
}

function record(overrides: Partial<QuestionDraftSessionRecord> = {}): QuestionDraftSessionRecord {
  return {
    version: 1,
    sessionId: 's',
    drafts: {
      'question-round:s:1': {
        answers: { page: { choices: ['Local'], text: '', other: '', notes: 'Keep it.' } },
        generalNotes: 'Stay local.',
        active: { kind: 'page', callId: 'page' },
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    },
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('conversation question draft storage', () => {
  it('declares a separate per-record draft domain next to the projection domain', async () => {
    const facility = fakeFacility();
    const opened = await openQuestionStorage({ storageDomain: facility } as unknown as Context);
    expect(facility.specs.map(spec => ({ name: spec.name, version: spec.version, layout: spec.layout }))).toEqual([
      { name: 'kanban_questions', version: 1, layout: 'per-record' },
      { name: 'kanban_question_drafts', version: 1, layout: 'per-record' },
    ]);
    await opened.close();
    expect(facility.closed).toEqual(['kanban_questions', 'kanban_question_drafts']);
  });

  it('round-trips, lists, and removes one conversation draft record', async () => {
    const facility = fakeFacility();
    const first = await openQuestionStorage({ storageDomain: facility } as unknown as Context);
    expect(first.drafts.load('s')).toBeUndefined();
    await first.drafts.save('s', record());
    expect(first.drafts.load('s')).toEqual(record());
    await first.drafts.save('t', record({ sessionId: 't', updatedAt: '2026-11-11T10:00:00.000Z' }));
    expect(first.drafts.records()).toEqual([
      { sessionId: 's', updatedAt: '2026-11-12T10:00:00.000Z' },
      { sessionId: 't', updatedAt: '2026-11-11T10:00:00.000Z' },
    ]);
    expect(await first.drafts.remove('s')).toBe(true);
    expect(await first.drafts.remove('s')).toBe(false);
    expect(first.drafts.load('s')).toBeUndefined();
    await first.close();

    const second = await openQuestionStorage({ storageDomain: facility } as unknown as Context);
    expect(second.drafts.load('t')?.sessionId).toBe('t');
    await second.close();
  });

  it('removes a conversation projection record without touching its drafts', async () => {
    const facility = fakeFacility();
    const opened = await openQuestionStorage({ storageDomain: facility } as unknown as Context);
    await opened.storage.save('s', { version: 1, sessionId: 's', events: [{ kind: 'human', seq: 1 }] });
    await opened.drafts.save('s', record());
    expect(await opened.storage.remove('s')).toBe(true);
    expect(opened.storage.load('s')).toBeUndefined();
    expect(opened.drafts.load('s')).toEqual(record());
    await opened.close();
  });

  it('closes the projection domain when the draft domain cannot open', async () => {
    const facility = fakeFacility({ failOn: 'kanban_question_drafts' });
    await expect(openQuestionStorage({ storageDomain: facility } as unknown as Context)).rejects.toThrow('backend down for kanban_question_drafts');
    expect(facility.closed).toEqual(['kanban_questions']);
  });

  it('rejects a stored draft record missing its session ordering stamp', () => {
    const value = record() as unknown as Record<string, unknown>;
    delete value.updatedAt;
    expect(() => QuestionDraftSessionRecordSchema.parse(value)).toThrow();
    expect(() => QuestionDraftSessionRecordSchema.parse({ ...record(), extra: true })).toThrow();
    expect(() => QuestionDraftSessionRecordSchema.parse({ ...record(), drafts: { r: { answers: {}, generalNotes: '', active: null } } })).toThrow();
    expect(QuestionDraftSessionRecordSchema.parse(record())).toEqual(record());
  });
});
