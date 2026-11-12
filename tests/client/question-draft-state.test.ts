import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionDraftState, QUESTION_DRAFT_SAVE_DELAY_MS, type QuestionDraftSaveRequest } from '../../src/client/question-draft-state.js';
import type { QuestionDraftContent, StoredQuestionDraft } from '../../src/shared/types.js';

afterEach(() => { vi.useRealTimers(); });

function content(overrides: Partial<QuestionDraftContent> = {}): QuestionDraftContent {
  return {
    answers: { c: { choices: ['Local'], text: '', other: '', notes: 'Keep it.' } },
    generalNotes: 'Stay local.',
    active: { kind: 'page', callId: 'c' },
    ...overrides,
  };
}
function stored(overrides: Partial<StoredQuestionDraft> = {}): StoredQuestionDraft {
  return { ...content(), updatedAt: '2026-11-12T10:00:00.000Z', ...overrides };
}
function transport() {
  const requests: QuestionDraftSaveRequest[] = [];
  const save = vi.fn(async (request: QuestionDraftSaveRequest) => { requests.push(request); });
  return { requests, save };
}

describe('question draft state', () => {
  it('hydrates a conversation baseline and returns a copy of the restored draft', () => {
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.hydrate('s', { r1: stored(), r2: stored({ generalNotes: 'Second.' }) });
    expect(state.read('r1')).toEqual(stored());
    const read = state.read('r1')!;
    read.answers.c!.choices.push('Remote');
    expect(state.read('r1')!.answers.c!.choices).toEqual(['Local']);
    expect(state.read('missing')).toBeUndefined();
  });

  it('never overwrites a round edited locally with a later baseline', () => {
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.hydrate('s', { r1: stored() });
    state.update('s', 'r1', content({ generalNotes: 'Edited here.' }));
    state.hydrate('s', { r1: stored({ generalNotes: 'Stale baseline.' }) });
    expect(state.read('r1')!.generalNotes).toBe('Edited here.');
  });

  it('coalesces one round writes and sends the latest after the delay', async () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.update('s', 'r1', content({ generalNotes: 'First.' }));
    state.update('s', 'r1', content({ generalNotes: 'Second.' }));
    await vi.advanceTimersByTimeAsync(QUESTION_DRAFT_SAVE_DELAY_MS - 1);
    expect(port.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]).toMatchObject({ sessionId: 's', roundId: 'r1', draft: { generalNotes: 'Second.' } });
    state.dispose();
  });

  it('flushes queued writes immediately', () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.update('s', 'r1', content());
    state.update('s', 'r2', content());
    state.flush();
    expect(port.requests.map(request => request.roundId).sort()).toEqual(['r1', 'r2']);
    state.dispose();
  });

  it('clears one round immediately and drops its queued write', () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.update('s', 'r1', content());
    state.clear('s', 'r1');
    expect(state.read('r1')).toBeUndefined();
    expect(port.requests).toEqual([{ sessionId: 's', roundId: 'r1', draft: null }]);
    vi.advanceTimersByTime(QUESTION_DRAFT_SAVE_DELAY_MS * 2);
    expect(port.requests).toHaveLength(1);
    state.dispose();
  });

  it('retainSession drops only the rounds the conversation no longer presents', () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.hydrate('a', { ra: stored(), ra2: stored() });
    state.hydrate('b', { rb: stored() });
    state.update('a', 'ra', content());
    state.update('a', 'ra2', content());
    state.update('b', 'rb', content());
    state.retainSession('a', ['ra']);
    expect(state.read('ra')).toBeDefined();
    expect(state.read('ra2')).toBeUndefined();
    expect(state.read('rb')).toBeDefined();
    state.flush();
    expect(port.requests.map(request => request.roundId).sort()).toEqual(['ra', 'rb']);
    state.dispose();
  });

  it('retires answered rounds and their queued writes', () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.update('s', 'r1', content());
    state.retire(['r1']);
    expect(state.read('r1')).toBeUndefined();
    state.flush();
    expect(port.requests).toEqual([]);
    state.dispose();
  });

  it('reports a failed save without throwing', async () => {
    const report = vi.fn();
    const state = new QuestionDraftState({ transport: { save: async () => { throw new Error('offline'); } }, report, delayMs: 0 });
    state.update('s', 'r1', content());
    state.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    state.dispose();
  });

  it('dispose cancels queued writes', () => {
    vi.useFakeTimers();
    const port = transport();
    const state = new QuestionDraftState({ transport: port });
    state.update('s', 'r1', content());
    state.dispose();
    vi.advanceTimersByTime(QUESTION_DRAFT_SAVE_DELAY_MS * 2);
    expect(port.requests).toEqual([]);
  });
});
