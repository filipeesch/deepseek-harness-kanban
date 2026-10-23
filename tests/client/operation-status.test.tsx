// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { OperationStatus } from '../../src/client/operation-status.js';
import type { ContextOperation } from '../../src/shared/types.js';
import { task } from './helpers.js';

afterEach(cleanup);
const base = task('t1', 'Alpha task', 'p1', 'intake');

function operation(overrides: Partial<ContextOperation> = {}): ContextOperation {
  return {
    id: 'op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/trees/alpha' },
    phase: 'failed', targetPath: '/trees/alpha', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now',
    error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child', path: '/trees/alpha', failedPhase: 'preflight' } },
    ...overrides,
  };
}

function mount(op: ContextOperation) {
  const run = vi.fn(async () => ({ sequence: 1, attention: {}, state: { schemaVersion: 2 as const, revision: 1, workflowYaml: '', workflow: { name: '', initialColumnId: 'intake', columns: [], groups: [] }, projects: [], tasks: [], notes: [] } }));
  render(<OperationStatus task={{ ...base, operation: op }} run={run} />);
  return run;
}

describe('OperationStatus', () => {
  it('shows a failed deletion with facts, inline details, and recovery', async () => {
    const run = mount(operation());
    expect(screen.getAllByText('Task deletion needs attention').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Another DSH conversation is using this checkout.')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getAllByText('0/2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Not completed')).toBeTruthy();
    const dialog = screen.getByRole('status').closest('.kb-operation') as HTMLElement;
    (within(dialog).getByRole('button', { name: 'Retry deletion' }) as HTMLButtonElement).click();
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'operation.retry', taskId: 't1' }));
    (within(dialog).getByRole('button', { name: 'Return chats to project' }) as HTMLButtonElement).click();
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'operation.return', taskId: 't1' }));
  });

  it('hides Return after archiving and uses removal-specific copy', () => {
    mount(operation({ archivedSessionIds: ['s1'] }));
    const region = screen.getByRole('status').closest('.kb-operation') as HTMLElement;
    expect(within(region).queryByRole('button', { name: 'Return chats to project' })).toBeNull();
    expect(within(region).getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
  });

  it('uses the worktree-removal label for a failed removal', () => {
    mount(operation({ request: { kind: 'remove', discardChanges: false, expectedWorktreePath: '/trees/alpha' } }));
    expect(screen.getAllByText('Worktree removal needs attention').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Retry worktree removal' })).toBeTruthy();
  });

  it('shows a waiting state without presenting it as failed', () => {
    mount(operation({ phase: 'waiting', error: undefined }));
    expect(screen.getByText('Waiting for every conversation to become idle.')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
  });
});
