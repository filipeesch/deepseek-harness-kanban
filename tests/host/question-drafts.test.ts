import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanApp, QUESTION_DRAFT_RETENTION } from '../../src/host/app.js';
import type { QuestionDraftSessionRecord, QuestionDraftStore, QuestionStore } from '../../src/host/question-storage.js';
import type { QuestionSessionRecord } from '../../src/questions/indexer.js';
import type { QuestionDraftContent, StoredQuestionDraft } from '../../src/shared/types.js';
import { MemoryHubStorage, TestGit, TestSessions, fixture, taskWithConversation } from './helpers.js';
import { call, end, human, result } from '../questions/fixtures.js';

afterEach(() => { vi.useRealTimers(); });

const roundId = (sessionId: string, turn: number) => 'question-round:' + sessionId + ':' + turn;

function content(overrides: Partial<QuestionDraftContent> = {}): QuestionDraftContent {
  return {
    answers: { c: { choices: ['Local'], text: '', other: '', notes: 'Keep it.' } },
    generalNotes: 'Stay local.',
    active: { kind: 'page', callId: 'c' },
    ...overrides,
  };
}

function draftRecord(sessionId: string, updatedAt = '2026-11-12T10:00:00.000Z', drafts: Record<string, StoredQuestionDraft> = { [roundId(sessionId, 1)]: { ...content(), updatedAt } }): QuestionDraftSessionRecord {
  return { version: 1, sessionId, drafts, updatedAt };
}

function memoryDraftStore(initial: readonly QuestionDraftSessionRecord[] = [], overrides: Partial<QuestionDraftStore> = {}) {
  const records = new Map(initial.map(record => [record.sessionId, structuredClone(record)]));
  const saves: string[] = [];
  const removals: string[] = [];
  const store: QuestionDraftStore = {
    load: sessionId => records.has(sessionId) ? structuredClone(records.get(sessionId)!) : undefined,
    save: async (sessionId, record) => { records.set(sessionId, structuredClone(record)); saves.push(sessionId); },
    remove: async sessionId => { removals.push(sessionId); return records.delete(sessionId); },
    records: () => [...records.values()].map(record => ({ sessionId: record.sessionId, updatedAt: record.updatedAt })),
    ...overrides,
  };
  return { records, saves, removals, store };
}

function memoryProjectionStore(initial: readonly string[] = [], overrides: Partial<QuestionStore> = {}) {
  const records = new Map<string, QuestionSessionRecord>(initial.map(sessionId => [sessionId, { version: 1, sessionId, events: [] }]));
  const removals: string[] = [];
  const store: QuestionStore = {
    load: sessionId => records.has(sessionId) ? structuredClone(records.get(sessionId)!) : undefined,
    save: async (sessionId, record) => { records.set(sessionId, structuredClone(record)); },
    remove: async sessionId => { removals.push(sessionId); return records.delete(sessionId); },
    ...overrides,
  };
  return { records, removals, store };
}

async function appWith(store: QuestionDraftStore | undefined, options: { report?: (error: unknown) => void; projection?: QuestionStore } = {}) {
  return new KanbanApp(await HubRepository.open(new MemoryHubStorage()), new TestSessions(), new TestGit(), {
    history: async () => [],
    ...(store === undefined ? {} : { questionDraftStore: store }),
    ...(options.projection === undefined ? {} : { questionStore: options.projection }),
    ...(options.report === undefined ? {} : { report: options.report }),
  });
}

function unresolvedRound(app: KanbanApp, sessionId: string, turn: number): string {
  app.observe(sessionId, call(1 + turn * 10, turn, 'c' + turn));
  app.observe(sessionId, result(2 + turn * 10, turn, 'c' + turn));
  app.observe(sessionId, end(3 + turn * 10, turn));
  return roundId(sessionId, turn);
}

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setupFixture(options: Parameters<typeof fixture>[0] = {}) { const value = await fixture(options); active.push(value); return value; }

describe('conversation question drafts', () => {
  it('merges one round at a time and restores the conversation unresolved drafts', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const first = unresolvedRound(app, 's', 1);
    const second = unresolvedRound(app, 's', 2);
    await app.saveQuestionDraft('s', first, content());
    await app.saveQuestionDraft('s', second, content({ generalNotes: 'Second round.' }));
    expect(Object.keys(drafts.store.load('s')!.drafts).sort()).toEqual([first, second].sort());
    expect(await app.questionDrafts('s')).toEqual(drafts.store.load('s')!.drafts);
    expect(app.questions.getRounds('s')).toHaveLength(2);
    await app.close();
  });

  it('clears one round without disturbing another', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const first = unresolvedRound(app, 's', 1);
    const second = unresolvedRound(app, 's', 2);
    await app.saveQuestionDraft('s', first, content());
    await app.saveQuestionDraft('s', second, content());
    await expect(app.saveQuestionDraft('s', first, null)).resolves.toBeNull();
    expect(Object.keys(drafts.store.load('s')!.drafts)).toEqual([second]);
    await app.saveQuestionDraft('s', second, null);
    expect(drafts.store.load('s')).toBeUndefined();
    expect(drafts.removals).toContain('s');
    await app.close();
  });

  it('ignores a write for a round that was already answered', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const routed = unresolvedRound(app, 's', 1);
    app.observe('s', human(20));
    expect(app.questions.getRounds('s').every(round => round.answered)).toBe(true);
    await expect(app.saveQuestionDraft('s', routed, content())).resolves.toBeNull();
    expect(drafts.saves).toEqual([]);
    expect(drafts.store.load('s')).toBeUndefined();
    await app.close();
  });

  it('rejects a malformed or oversized draft without writing it', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const routed = unresolvedRound(app, 's', 1);
    await expect(app.saveQuestionDraft('s', routed, content({ generalNotes: 'x'.repeat(65537) }))).rejects.toMatchObject({ code: 'INVALID_QUESTION_DRAFT' });
    await expect(app.saveQuestionDraft('s', routed, { answers: {}, generalNotes: '', active: { kind: 'page', callId: '' } })).rejects.toMatchObject({ code: 'INVALID_QUESTION_DRAFT' });
    expect(drafts.saves).toEqual([]);
    await app.close();
  });

  it('reports a write failure without throwing or losing the in-memory round', async () => {
    const report = vi.fn();
    const drafts = memoryDraftStore([], { save: async () => { throw new Error('disk full'); } });
    const app = await appWith(drafts.store, { report });
    const routed = unresolvedRound(app, 's', 1);
    await expect(app.saveQuestionDraft('s', routed, content())).resolves.toBeNull();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    expect(app.questions.getRounds('s')).toHaveLength(1);
    await app.close();
  });

  it('prunes a draft once the round is answered by an ordinary reply', async () => {
    vi.useFakeTimers();
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const routed = unresolvedRound(app, 's', 1);
    await app.saveQuestionDraft('s', routed, content());
    expect(drafts.store.load('s')).toBeDefined();
    app.observe('s', human(20));
    await vi.advanceTimersByTimeAsync(500);
    expect(drafts.store.load('s')).toBeUndefined();
    expect(await app.questionDrafts('s')).toEqual({});
    await app.close();
  });

  it('prunes drafts after a dismissal is persisted and ignores a later save', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const first = unresolvedRound(app, 's', 1);
    const second = unresolvedRound(app, 's', 2);
    await app.saveQuestionDraft('s', first, content());
    await app.saveQuestionDraft('s', second, content());
    const [round] = await app.rounds('s');
    await app.dismissQuestions('s', round!.id);
    expect(drafts.store.load('s')).toBeUndefined();
    expect(await app.questions.pending('s')).toBe(false);
    // A debounced write that lands after the dismissal must not recreate the draft.
    await expect(app.saveQuestionDraft('s', second, content())).resolves.toBeNull();
    expect(drafts.store.load('s')).toBeUndefined();
    expect(drafts.saves).toHaveLength(2);
    await app.close();
  });

  it('keeps a still-answerable draft when a dismissal rolls back', async () => {
    const drafts = memoryDraftStore();
    let rejectSave!: (error: Error) => void;
    let startedSave!: () => void;
    let firstSave = true;
    const saveStarted = new Promise<void>(resolve => { startedSave = resolve; });
    const projection = memoryProjectionStore([], {
      save: async () => {
        if (!firstSave) return;
        firstSave = false;
        startedSave();
        await new Promise<void>((_, reject) => { rejectSave = reject; });
      },
    });
    const app = await appWith(drafts.store, { projection: projection.store, report: () => {} });
    const routed = unresolvedRound(app, 's', 1);
    await app.saveQuestionDraft('s', routed, content());
    // Start the dismissal first: it holds the session lane while its projection write is
    // pending, which is exactly the provisional state a concurrent save used to prune.
    const dismissing = app.dismissQuestions('s', routed);
    await saveStarted;
    const saving = app.saveQuestionDraft('s', routed, content({ generalNotes: 'Edited meanwhile.' }));
    rejectSave(new Error('disk full'));
    await expect(dismissing).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    await saving;
    expect((await app.rounds('s')).map(round => round.id)).toEqual([routed]);
    expect(drafts.store.load('s')!.drafts[routed]!.generalNotes).toBe('Edited meanwhile.');
    await app.close();
  });

  it('picks replacement candidates when a record is refreshed during retention', async () => {
    const oldest = '2026-01-01T00:00:00.000Z';
    const records = Array.from({ length: QUESTION_DRAFT_RETENTION + 2 }, (_, index) => draftRecord(
      's-' + String(index).padStart(3, '0'),
      new Date(Date.parse(oldest) + index * 1000).toISOString(),
    ));
    const drafts = memoryDraftStore(records);
    let releaseRemoval!: () => void;
    let startedRemoval!: () => void;
    let refreshWritten!: () => void;
    const removalGate = new Promise<void>(resolve => { releaseRemoval = resolve; });
    const removalStarted = new Promise<void>(resolve => { startedRemoval = resolve; });
    const refreshedWrite = new Promise<void>(resolve => { refreshWritten = resolve; });
    const remove = drafts.store.remove;
    drafts.store.remove = async sessionId => {
      if (sessionId === 's-000') { startedRemoval(); await removalGate; }
      return remove(sessionId);
    };
    const save = drafts.store.save;
    drafts.store.save = async (sessionId, record) => {
      await save(sessionId, record);
      if (sessionId === 's-001') refreshWritten();
    };
    const app = await appWith(drafts.store);
    const added = unresolvedRound(app, 's-new', 1);
    const adding = app.saveQuestionDraft('s-new', added, content());
    await removalStarted;
    // Refresh the next candidate while the first removal is in flight, and wait until its
    // record is written so the in-flight prune must skip it and pick a replacement.
    const refreshed = unresolvedRound(app, 's-001', 1);
    const refreshing = app.saveQuestionDraft('s-001', refreshed, content({ generalNotes: 'Refreshed during retention.' }));
    await refreshedWrite;
    releaseRemoval();
    await adding;
    await refreshing;
    expect(drafts.store.records()).toHaveLength(QUESTION_DRAFT_RETENTION);
    expect(drafts.store.load('s-000')).toBeUndefined();
    expect(drafts.store.load('s-001')).toBeDefined();
    expect(drafts.store.load('s-002')).toBeUndefined();
    // The replacement pass recomputes the ordering and drops the next-oldest record.
    expect(drafts.store.load('s-003')).toBeUndefined();
    expect(drafts.store.load('s-new')).toBeDefined();
    await app.close();
  });

  it('flushes a pending answered-draft prune on shutdown', async () => {
    const drafts = memoryDraftStore();
    const app = await appWith(drafts.store);
    const routed = unresolvedRound(app, 's', 1);
    await app.saveQuestionDraft('s', routed, content());
    app.observe('s', human(20));
    // Close before the coalescing window elapses: shutdown must run the cleanup, not cancel it.
    await app.close();
    expect(drafts.store.load('s')).toBeUndefined();
  });

  it('reports a draft-store read failure and keeps the question rounds available', async () => {
    const report = vi.fn();
    const drafts = memoryDraftStore([], { load: () => { throw new Error('quarantined'); } });
    const app = await appWith(drafts.store, { report });
    const routed = unresolvedRound(app, 's', 1);
    await expect(app.questionDrafts('s')).resolves.toEqual({});
    await expect(app.saveQuestionDraft('s', routed, content())).resolves.toBeNull();
    expect(report).toHaveBeenCalled();
    expect(await app.rounds('s')).toHaveLength(1);
    await app.close();
  });

  it('keeps the most recently updated draft records on startup retention', async () => {
    const oldest = '2026-01-01T00:00:00.000Z';
    const records = Array.from({ length: QUESTION_DRAFT_RETENTION + 1 }, (_, index) => draftRecord(
      's-' + String(index).padStart(3, '0'),
      new Date(Date.parse(oldest) + index * 1000).toISOString(),
    ));
    const drafts = memoryDraftStore(records);
    const app = await appWith(drafts.store);
    // The pruned conversation keeps its question round; retention only drops the draft record.
    unresolvedRound(app, 's-000', 1);
    await app.initialize();
    await app.whenSettled();
    expect(drafts.store.records()).toHaveLength(QUESTION_DRAFT_RETENTION);
    expect(drafts.store.load('s-000')).toBeUndefined();
    expect(drafts.store.load('s-001')).toBeDefined();
    expect(drafts.store.load('s-' + String(QUESTION_DRAFT_RETENTION).padStart(3, '0'))).toBeDefined();
    expect(await app.rounds('s-000')).toHaveLength(1);
    await app.close();
  });

  it('enforces the retention bound while running and keeps a refreshed record', async () => {
    const oldest = '2026-01-01T00:00:00.000Z';
    const records = Array.from({ length: QUESTION_DRAFT_RETENTION }, (_, index) => draftRecord(
      's-' + String(index).padStart(3, '0'),
      new Date(Date.parse(oldest) + index * 1000).toISOString(),
    ));
    const drafts = memoryDraftStore(records);
    const app = await appWith(drafts.store);
    // Refresh the oldest conversation at capacity: recency must protect it.
    const refreshed = unresolvedRound(app, 's-000', 1);
    await app.saveQuestionDraft('s-000', refreshed, content({ generalNotes: 'Refreshed.' }));
    expect(drafts.store.records()).toHaveLength(QUESTION_DRAFT_RETENTION);
    // Creating the next conversation drops the now-oldest record, never the refreshed one.
    const added = unresolvedRound(app, 's-new', 1);
    await app.saveQuestionDraft('s-new', added, content());
    expect(drafts.store.records()).toHaveLength(QUESTION_DRAFT_RETENTION);
    expect(drafts.store.load('s-000')!.drafts[refreshed]!.generalNotes).toBe('Refreshed.');
    expect(drafts.store.load('s-001')).toBeUndefined();
    expect(drafts.store.load('s-new')).toBeDefined();
    await app.close();
  });

  it('rechecks retention after a queued refresh recreates an evicted record', async () => {
    const oldest = '2026-01-01T00:00:00.000Z';
    const records = Array.from({ length: QUESTION_DRAFT_RETENTION + 1 }, (_, index) => draftRecord(
      's-' + String(index).padStart(3, '0'),
      new Date(Date.parse(oldest) + index * 1000).toISOString(),
    ));
    const drafts = memoryDraftStore(records);
    let releaseSave!: () => void;
    let startedSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveStarted = new Promise<void>(resolve => { startedSave = resolve; });
    const save = drafts.store.save;
    drafts.store.save = async (sessionId, record) => {
      if (sessionId === 's-001') { startedSave(); await saveGate; }
      return save(sessionId, record);
    };
    const app = await appWith(drafts.store);
    const refreshRound = unresolvedRound(app, 's-001', 1);
    // The refresh loads its record now but its write is held until retention has evicted it.
    const refreshing = app.saveQuestionDraft('s-001', refreshRound, content({ generalNotes: 'Recreated.' }));
    await saveStarted;
    const added = unresolvedRound(app, 's-new', 1);
    await app.saveQuestionDraft('s-new', added, content());
    expect(drafts.store.load('s-000')).toBeUndefined();
    expect(drafts.store.load('s-001')).toBeUndefined();
    releaseSave();
    await refreshing;
    // The queued write recreated s-001; the save's own retention check restores the bound.
    expect(drafts.store.load('s-001')!.drafts[refreshRound]!.generalNotes).toBe('Recreated.');
    expect(drafts.store.records()).toHaveLength(QUESTION_DRAFT_RETENTION);
    expect(drafts.store.load('s-002')).toBeUndefined();
    await app.close();
  });

  it('deletes a task conversation question state while keeping other conversations', async () => {
    const drafts = memoryDraftStore([draftRecord('ordinary')]);
    const projection = memoryProjectionStore();
    const f = await setupFixture({ questionDraftStore: drafts.store, questionStore: projection.store });
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Draft task', description: '' });
    const sessionId = task.sessionIds[0]!;
    const routed = unresolvedRound(f.app, sessionId, 1);
    await f.app.saveQuestionDraft(sessionId, routed, content());
    await projection.store.save(sessionId, { version: 1, sessionId, events: [] });
    expect(drafts.store.load(sessionId)).toBeDefined();

    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();

    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(drafts.store.load(sessionId)).toBeUndefined();
    expect(projection.store.load(sessionId)).toBeUndefined();
    expect(projection.removals).toContain(sessionId);
    expect(drafts.store.load('ordinary')).toBeDefined();
    expect(f.app.questions.getRounds(sessionId)).toEqual([]);
    expect(f.app.questions.revisionOf(sessionId)).toBe(0);
  });

  it('keeps another task question state and the transcript when a task is deleted', async () => {
    const drafts = memoryDraftStore();
    const projection = memoryProjectionStore();
    const f = await setupFixture({ questionDraftStore: drafts.store, questionStore: projection.store });
    const first = await taskWithConversation(f.app, { projectId: f.project.id, title: 'First task', description: '' });
    const second = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Second task', description: '' });
    const firstSession = first.sessionIds[0]!;
    const secondSession = second.sessionIds[0]!;
    const firstRound = unresolvedRound(f.app, firstSession, 1);
    const secondRound = unresolvedRound(f.app, secondSession, 1);
    await f.app.saveQuestionDraft(firstSession, firstRound, content());
    await f.app.saveQuestionDraft(secondSession, secondRound, content({ generalNotes: 'Second task.' }));
    await projection.store.save(firstSession, { version: 1, sessionId: firstSession, events: [] });
    await projection.store.save(secondSession, { version: 1, sessionId: secondSession, events: [] });
    const sessions = f.sessions as unknown as { sent: unknown[] };
    const sentBefore = sessions.sent.length;

    await f.app.command({ type: 'task.delete', taskId: first.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();

    expect(drafts.store.load(firstSession)).toBeUndefined();
    expect(projection.store.load(firstSession)).toBeUndefined();
    expect(drafts.store.load(secondSession)).toBeDefined();
    expect(projection.store.load(secondSession)).toBeDefined();
    expect(f.app.questions.getRounds(secondSession)).toHaveLength(1);
    // A late event from the deleted conversation must not repopulate its projection.
    f.app.observe(firstSession, call(90, 90, 'late'));
    expect(f.app.questions.getRounds(firstSession)).toEqual([]);
    // Deleting a task archives conversations; it must not write into the transcript.
    expect(sessions.sent.length).toBe(sentBefore);
  });

  it('does not resurrect a deleted conversation while its history is replayed', async () => {
    const drafts = memoryDraftStore();
    const projection = memoryProjectionStore();
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const history = async () => { started = true; await gate; return [call(1, 1, 'c'), result(2, 1, 'c'), end(3, 1)]; };
    const f = await setupFixture({ questionDraftStore: drafts.store, questionStore: projection.store, history });
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Racing history', description: '' });
    const sessionId = task.sessionIds[0]!;
    // A history replay that started before the deletion must not re-apply its events.
    const preparing = f.app.rounds(sessionId);
    expect(started).toBe(true);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();
    release();
    await expect(preparing).resolves.toEqual([]);
    expect(f.app.questions.getRounds(sessionId)).toEqual([]);
    expect(projection.store.load(sessionId)).toBeUndefined();
    await f.app.close();
    expect(projection.store.load(sessionId)).toBeUndefined();
    expect(drafts.store.load(sessionId)).toBeUndefined();
  });

  it('reports a deletion cleanup failure without failing the deletion', async () => {
    const report = vi.fn();
    const drafts = memoryDraftStore([], { remove: async () => { throw new Error('draft cleanup failed'); } });
    const projection = memoryProjectionStore(['preset']);
    const f = await setupFixture({ questionDraftStore: drafts.store, questionStore: projection.store, report });
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Cleanup failure', description: '' });
    const sessionId = task.sessionIds[0]!;
    await projection.store.save(sessionId, { version: 1, sessionId, events: [] });

    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();

    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'draft cleanup failed' }));
    expect(projection.store.load(sessionId)).toBeUndefined();
  });
});
