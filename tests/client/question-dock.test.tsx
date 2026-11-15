// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import { QuestionDock, createQuestionDockServices, type QuestionDockProps, type QuestionDockServices } from '../../src/client/question-dock.js';
import type { QuestionRoundView } from '../../src/client/question-round-cache.js';
import type { QuestionRound } from '../../src/shared/types.js';

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
});
