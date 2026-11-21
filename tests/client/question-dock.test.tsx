// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import { QuestionDock, createQuestionDockServices, type QuestionDockProps, type QuestionDockServices } from '../../src/client/question-dock.js';
import type { QuestionRoundView } from '../../src/client/question-round-cache.js';
import type { QuestionDraftContent, QuestionRound } from '../../src/shared/types.js';
import { QuestionDraftState } from '../../src/client/question-draft-state.js';
import { createAnswerFileDelivery } from '../../src/client/answer-files.js';

/** The question-only bridge the composition root supplies, with no board state. */
function bridge(): Parameters<typeof createQuestionDockServices>[0]['bridge'] {
  return {
    questionsView: observable<QuestionRoundView>({ rounds: [], errors: new Map() }),
    questionDrafts: { read: () => undefined, update: () => {}, clear: () => {}, flush: () => {} },
    questions: { isSubmitted: () => false, focusedRoundId: undefined, submit: () => {}, settle: () => {}, rollback: () => {} },
    retry: () => {},
    trackQuestions: () => () => {},
    retryQuestions: () => {},
    assertSubmissionAllowed: () => {},
    dismissQuestions: async () => [],
  };
}

/** The dock's contracts must never carry a board-update status again. */
type DockContractStatus =
  | Extract<keyof QuestionDockServices, 'status'>
  | Extract<keyof QuestionDockProps, 'status'>
  | Extract<keyof Parameters<typeof createQuestionDockServices>[0], 'status'>;
// Compile-time guard: reintroducing `status` on any of those contracts makes this fail.
const dockCarriesNoStatus: DockContractStatus extends never ? true : false = true;

function observable<T>(value: T): HostObservable<T> {
  return { getSnapshot: () => value, subscribe: () => () => {} };
}

const round: QuestionRound = {
  id: 'round-1', sessionId: 'session-1', turnId: '1', complete: true, answered: false,
  pages: [{ callId: 'call-1', sequence: 0, page: { question: 'Which storage should we use?', type: 'exclusive' } }],
};

function services(view: QuestionRoundView, retry = vi.fn()): QuestionDockServices {
  return {
    view: observable(view),
    track: () => () => {},
    retry,
    isSubmitted: () => false,
    focusedRoundId: () => undefined,
    submit: () => {},
    settle: () => {},
    rollback: () => {},
    assertSubmissionAllowed: () => {},
    dismiss: async () => [],
    drafts: { read: () => undefined, update: () => {}, clear: () => {}, flush: () => {} },
    send: async () => {},
    files: () => undefined,
    submitWithFiles: async (_sessionId, text) => { void text; },
    discardFile: async () => {},
    focusComposer: () => {},
  };
}

/** The dock subtree carries only question state, in every state it can present. */
function expectNoBoardStatus(container: HTMLElement): void {
  expect(dockCarriesNoStatus).toBe(true);
  expect(container.querySelector('.kanban-feed-error')).toBeNull();
  expect(container.textContent).not.toMatch(/Kanban updates|Retry updates/);
  expect(screen.queryByRole('button', { name: 'Retry updates' })).toBeNull();
}

afterEach(cleanup);

describe('question dock surfaces', () => {
  it('reports its own question feed failure and retries only that feed', async () => {
    const retry = vi.fn();
    const { container } = render(<QuestionDock sessionId="session-1" services={services({ rounds: [], errors: new Map([['session-1', { code: 'STREAM_FAILED', message: 'Question rounds stream ended; reconnecting.' }]]) }, retry)} />);
    expect(screen.getByRole('alert').textContent).toContain('Question rounds are unavailable: Question rounds stream ended; reconnecting.');
    expectNoBoardStatus(container);
    screen.getByRole('button', { name: 'Retry questions' }).click();
    await waitFor(() => expect(retry).toHaveBeenCalledWith('session-1'));
  });

  it('still presents an unresolved round without any board status', () => {
    const { container } = render(<QuestionDock sessionId="session-1" services={services({ rounds: [round], errors: new Map() })} />);
    expect(screen.getByRole('heading', { name: /Which storage should we use/ })).toBeTruthy();
    expectNoBoardStatus(container);
  });

  it('presents nothing else while its conversation has no question state', () => {
    const { container } = render(<QuestionDock sessionId="session-1" services={services({ rounds: [], errors: new Map() })} />);
    expectNoBoardStatus(container);
    expect(container.textContent).toBe('');
  });

  it('builds an answered round as one prompt carrying one receipt per file', async () => {
    // The real delivery factory, a recording upload port, and a recording conversation:
    // a regression in the composition fails here, not only in a surface test.
    const uploads = { upload: vi.fn(async (_sessionId: never, _data: Blob, name?: string) => ({ ok: true, value: { receiptId: 'receipt-' + name } })) };
    const prompts: Array<{ content: unknown[]; mode: string }> = [];
    const built = createQuestionDockServices({
      bridge: bridge(),
      sessions: { scope: () => ({ get: () => ({ send: async () => {}, input: { for: () => ({ focus: () => {} }) } }) }) },
      fileDelivery: createAnswerFileDelivery({
        uploads: () => uploads,
        conversation: () => ({ prompt: async (content, mode) => { prompts.push({ content, mode }); return { ok: true }; } }),
      }),
    });
    await built.submitWithFiles('session-1', 'Answered', [{ name: 'a.txt', data: 'YWJj' }, { name: 'b.txt', data: 'YWJj' }]);
    expect(uploads.upload).toHaveBeenCalledTimes(2);
    expect(uploads.upload.mock.calls[0]![1]).toBeInstanceOf(File);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toEqual({
      content: [
        { type: 'file', receiptId: 'receipt-a.txt' },
        { type: 'file', receiptId: 'receipt-b.txt' },
        { type: 'text', text: 'Answered' },
      ],
      mode: 'queue',
    });
  });

  it('keeps attachments and their order through update, read, and hydrate', async () => {
    const requests: Array<{ draft: QuestionDraftContent }> = [];
    const state = new QuestionDraftState({
      // No coalescing, so the write is issued synchronously with the update.
      delayMs: 0,
      transport: { save: async request => { requests.push({ draft: request.draft as QuestionDraftContent }); } },
      report: () => undefined,
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const content: QuestionDraftContent = {
      answers: {},
      generalNotes: '',
      pageAttachments: { 'call-1': [{ id: 'a', name: 'a.txt', bytes: 1 }] },
      roundAttachments: [{ id: 'b', name: 'b.txt', bytes: 2 }],
      attachmentOrder: ['a', 'b'],
      active: null,
    };
    state.update('session-1', 'round-1', content);
    // The write the host receives must name the files, or their bytes can never be found.
    await state.flush();
    expect(requests[0]!.draft.pageAttachments).toEqual({ 'call-1': [{ id: 'a', name: 'a.txt', bytes: 1 }] });
    expect(requests[0]!.draft.attachmentOrder).toEqual(['a', 'b']);
    const restored = state.read('round-1')!;
    expect(restored.roundAttachments).toEqual([{ id: 'b', name: 'b.txt', bytes: 2 }]);
    // Hydration of a stored draft keeps the attachments a reload must restore.
    const other = new QuestionDraftState({ delayMs: 0, transport: { save: async () => undefined }, report: () => undefined });
    other.hydrate('session-1', { 'round-1': { ...content, updatedAt: '2026-01-01T00:00:00.000Z' } });
    expect(other.read('round-1')!.pageAttachments).toEqual({ 'call-1': [{ id: 'a', name: 'a.txt', bytes: 1 }] });
  });
});
