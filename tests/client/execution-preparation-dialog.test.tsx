// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { ExecutionPreparationDialog } from '../../src/client/execution-preparation/dialog.js';
import type { ExecutionPreparationController, PreparationState } from '../../src/client/execution-preparation/controller.js';
import { MODEL_SELECTION_SLOT, type PreparationSeat } from '../../src/client/execution-preparation/model-seat.js';

afterEach(cleanup);

function state(overrides: Partial<PreparationState> = {}): PreparationState {
  return {
    phase: 'worktree', kind: 'move', taskId: 't1', taskTitle: 'Alpha task', stageName: 'Review',
    worktree: 'ask', model: false, boardModel: null,
    draft: { mode: 'new', branchName: 'alpha-task', path: '/trees/alpha-task', sourceBranch: 'main' },
    destinationMissing: false, sessionId: null, pending: false, error: null, failedStep: null,
    ...overrides,
  };
}

function stubController() {
  return { cancel: vi.fn(), answerWorktree: vi.fn(), retry: vi.fn(), confirmModel: vi.fn() };
}

function controllerOf(stub: ReturnType<typeof stubController>): ExecutionPreparationController {
  return stub as unknown as ExecutionPreparationController;
}

function describedByExists(): void {
  const dialog = screen.getByRole('dialog');
  const id = dialog.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)).not.toBeNull();
}

describe('ExecutionPreparationDialog', () => {
  it('describes every phase and answers the worktree question', () => {
    const stub = stubController();
    const { rerender } = render(<ExecutionPreparationDialog state={state()} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByText(/Moving this card to Review starts the task's first execution/)).toBeTruthy();
    const create = screen.getByRole('button', { name: 'Create worktree' }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    screen.getByRole('button', { name: 'Continue in base project' }).click();
    expect(stub.answerWorktree).toHaveBeenCalledWith(false);
    screen.getByRole('button', { name: 'Create worktree' }).click();
    expect(stub.answerWorktree).toHaveBeenCalledWith(true);

    rerender(<ExecutionPreparationDialog state={state({ destinationMissing: true, draft: null })} controller={controllerOf(stub)} />);
    expect((screen.getByRole('button', { name: 'Create worktree' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No worktree destination can be derived/)).toBeTruthy();

    rerender(<ExecutionPreparationDialog state={state({ phase: 'provisioning', pending: true })} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByRole('status').textContent).toContain('Preparing the task');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    rerender(<ExecutionPreparationDialog state={state({ phase: 'error', error: { code: 'WORKTREE_TARGET_EXISTS', message: 'The destination already exists.' }, failedStep: 'worktree' })} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByText('The destination already exists.')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(stub.retry).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Close' }).click();
    expect(stub.cancel).toHaveBeenCalledTimes(1);
  });

  it('explains a blocked binding without offering the worktree answers', () => {
    const stub = stubController();
    render(<ExecutionPreparationDialog state={state({ phase: 'blocked', worktree: 'blocked', model: false })} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByText(/Resolve it in the Git section/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create worktree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue in base project' })).toBeNull();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(stub.cancel).toHaveBeenCalledTimes(1);
    expect(stub.answerWorktree).not.toHaveBeenCalled();
  });

  it('uses run wording for a play-triggered preparation and move wording for a drop', () => {
    const stub = stubController();
    const { rerender } = render(<ExecutionPreparationDialog state={state({ kind: 'run' })} controller={controllerOf(stub)} />);
    expect(screen.getByText(/Running the stage instruction starts the task's first execution/)).toBeTruthy();
    expect(screen.queryByText(/Moving this card/)).toBeNull();
    rerender(<ExecutionPreparationDialog state={state({ kind: 'run', phase: 'provisioning', pending: true })} controller={controllerOf(stub)} />);
    expect(screen.getByText(/The instruction is sent once the task is ready/)).toBeTruthy();
  });

  it('presents the native seat for the created conversation and confirms the model stage', () => {
    const stub = stubController();
    const select = vi.fn(async () => ({ ok: true }));
    const StubSeat = (props: Record<string, unknown>) => <button type="button" onClick={() => void (props.select as (value: unknown) => Promise<unknown>)({ provider: 'p', model: 'm' })}>Native model trigger</button>;
    const entry = {
      component: StubSeat,
      options: { id: 'model-seat' },
      inject: () => ({ available: true, directory: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load: async () => undefined, select }),
    } as unknown as StoredEntry;
    const seat: PreparationSeat = {
      slots: { entriesOfSlot: key => key === MODEL_SELECTION_SLOT ? [entry] : [], subscribe: () => () => {} },
      locale: { bind: () => key => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} },
    };
    const { rerender } = render(<ExecutionPreparationDialog state={state({ phase: 'model', model: true, sessionId: 'session-1' })} controller={controllerOf(stub)} seat={seat} />);
    describedByExists();
    // Without a board model, Start execution keeps DSH's own choice, and the dialog says so.
    expect(screen.getByRole('note').textContent).toContain('keeps the model DSH chose for this conversation');
    const trigger = screen.getByRole('button', { name: 'Native model trigger' });
    expect(select).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Start execution' }).click();
    expect(stub.confirmModel).toHaveBeenCalledTimes(1);
    trigger.click();
    expect(select).toHaveBeenCalledTimes(1);

    // The step is only reopened when the board named a route this host cannot offer,
    // so the person is told which model the board wanted and what pressing Start does.
    rerender(<ExecutionPreparationDialog
      state={state({ phase: 'model', model: true, sessionId: 'session-1', boardModel: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' } })}
      controller={controllerOf(stub)}
      seat={seat}
    />);
    const note = screen.getByRole('note').textContent ?? '';
    expect(note).toContain('The board names deepseek · reason for new conversations');
    expect(note).toContain('this host did not confirm that model here');
    expect(note).toContain('begins the conversation on the model DSH chose');
    // The step also opens when the catalog could not be read, so it must not claim a refusal.
    expect(note).not.toContain('does not offer');
    expect(screen.queryByText('Pressing Start execution keeps the model DSH chose for this conversation.')).toBeNull();
  });
});
