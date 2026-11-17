// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExecutionPreparationDialog } from '../../src/client/execution-preparation/dialog.js';
import type { ExecutionPreparationController, PreparationState } from '../../src/client/execution-preparation/controller.js';

afterEach(cleanup);

function state(overrides: Partial<PreparationState> = {}): PreparationState {
  return { phase: 'worktree', kind: 'move', taskId: 't1', taskTitle: 'Alpha task', stageName: 'Review', ...overrides };
}

function stubController() {
  return { cancel: vi.fn(), answerWorktree: vi.fn() };
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
  it('asks the worktree question and answers it', () => {
    const stub = stubController();
    render(<ExecutionPreparationDialog state={state()} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByRole('dialog', { name: 'Create a worktree?' })).toBeTruthy();
    expect(screen.getByText(/Moving this card to Review starts the task's first execution/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    screen.getByRole('button', { name: 'Continue in base project' }).click();
    expect(stub.answerWorktree).toHaveBeenCalledWith(false);
    screen.getByRole('button', { name: 'Create worktree' }).click();
    expect(stub.answerWorktree).toHaveBeenCalledWith(true);
  });

  it('uses run wording for a play-triggered preparation', () => {
    const stub = stubController();
    render(<ExecutionPreparationDialog state={state({ kind: 'run' })} controller={controllerOf(stub)} />);
    expect(screen.getByText(/Running the stage instruction starts the task's first execution/)).toBeTruthy();
    expect(screen.queryByText(/Moving this card/)).toBeNull();
  });

  it('explains a blocked binding without offering the worktree answers', () => {
    const stub = stubController();
    render(<ExecutionPreparationDialog state={state({ phase: 'blocked' })} controller={controllerOf(stub)} />);
    describedByExists();
    expect(screen.getByRole('dialog', { name: 'Resolve the worktree binding first' })).toBeTruthy();
    expect(screen.getByText(/Resolve it in the Git section/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create worktree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue in base project' })).toBeNull();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(stub.cancel).toHaveBeenCalledTimes(1);
    expect(stub.answerWorktree).not.toHaveBeenCalled();
  });

  it('cancels from the question without answering', () => {
    const stub = stubController();
    render(<ExecutionPreparationDialog state={state()} controller={controllerOf(stub)} />);
    screen.getByRole('button', { name: 'Cancel' }).click();
    expect(stub.cancel).toHaveBeenCalledTimes(1);
    expect(stub.answerWorktree).not.toHaveBeenCalled();
  });
});
