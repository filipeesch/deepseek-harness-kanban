// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApprovalQueue } from '../../src/client/deterministic-approval-queue.js';
import { ScriptReviewProvider } from '../../src/client/script-review-provider.js';
import { task, fixture } from './helpers.js';
import type { ClientApi } from '../../src/shared/types.js';
import type { DeterministicStageReview, DeterministicSummary } from '../../src/shared/deterministic.js';
afterEach(cleanup);
const review: DeterministicStageReview = {
  stage: { boardId: 'board', stageId: 'wait', stageIdentity: 'wait-key', name: 'Wait' },
  version: { fingerprint: 'version-1', stageGeneration: 'generation-1', captured: true, directoryDependent: false },
  code: 'echo captured', language: 'bash', directory: 'task', source: { kind: 'inline' },
  exits: { ok: 'done' }, env: [], params: [], approval: 'required',
  captured: { taskId: 't1', entryId: 'e1', executionDirectory: '/project' },
};
const workflow = { name: 'Flow', initialColumnId: 'wait', groups: [], columns: [{ id: 'wait', name: 'Wait' }, { id: 'done', name: 'Done' }] };
const summary = (entryId: string): DeterministicSummary => ({ entryId, executionId: 'run-' + entryId, phase: 'awaiting-trust', startedAt: 'now', attempt: 0, restartCount: 0, fingerprint: 'version-1' });
const waiting = (id: string) => ({ ...task('t' + id, 'Card ' + id, 'p', 'wait'), stageEntry: { id: 'e' + id, columnId: 'wait', stageIdentity: 'wait-key', enteredAt: 'now' } });
describe('board approval queue', () => {
  it('lists one item per waiting stage version with its card count', async () => {
    const client = { deterministicReview: vi.fn(async () => review) } as unknown as ClientApi;
    render(<ScriptReviewProvider api={client} run={async () => fixture()}><ApprovalQueue boardId="board" tasks={[waiting('1'), waiting('2')]} scripts={{ t1: summary('e1'), t2: summary('e2') }} workflow={workflow} /></ScriptReviewProvider>);
    expect(screen.getByText('Wait: 2 cards waiting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() => expect(client.deterministicReview).toHaveBeenCalledWith({ boardId: 'board', stageId: 'wait', taskId: 't1' }));
    await screen.findByText('version-1');
  });
  it('lists two executable versions of one stage separately', () => {
    const client = { deterministicReview: vi.fn(async () => review) } as unknown as ClientApi;
    render(<ScriptReviewProvider api={client} run={async () => fixture()}><ApprovalQueue boardId="board" tasks={[waiting('1')]} scripts={{ t1: { ...summary('e1'), fingerprint: 'version-1' } }} workflow={workflow} /></ScriptReviewProvider>);
    cleanup();
    render(<ScriptReviewProvider api={client} run={async () => fixture()}><ApprovalQueue boardId="board" tasks={[waiting('1'), waiting('2')]} scripts={{ t1: { ...summary('e1'), fingerprint: 'version-1' }, t2: { ...summary('e2'), fingerprint: 'version-2' } }} workflow={workflow} /></ScriptReviewProvider>);
    expect(screen.getByText(/Wait · vversion-1: 1 card waiting/)).toBeTruthy();
    expect(screen.getByText(/Wait · vversion-2: 1 card waiting/)).toBeTruthy();
  });
  it('does not present a version that is not waiting', () => {
    const client = { deterministicReview: vi.fn(async () => review) } as unknown as ClientApi;
    render(<ScriptReviewProvider api={client} run={async () => fixture()}><ApprovalQueue boardId="board" tasks={[waiting('1')]} scripts={{ t1: { ...summary('e1'), phase: 'active' } }} workflow={workflow} /></ScriptReviewProvider>);
    expect(screen.queryByText(/cards waiting/)).toBeNull();
  });
});
