// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScriptActions } from '../../src/client/deterministic-actions.js';
import { ScriptReviewDialog } from '../../src/client/deterministic-review.js';
import { StageEditorDialog } from '../../src/client/stage/stage-editor-dialog.js';
import { DeterministicProvider } from '../../src/client/deterministic-context.js';
import { DeterministicHandoffNodeView, deterministicHandoffDefinition } from '../../src/client/deterministic-handoff-node.js';
import { task, fixture } from './helpers.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientApi, Column } from '../../src/shared/types.js';
import type { DeterministicSummary, DeterministicReview } from '../../src/shared/deterministic.js';
afterEach(cleanup);
const card = { ...task('t','CI','p','wait'), sessionIds: [], stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'stable', enteredAt: 'now' } };
const summary: DeterministicSummary = { entryId: 'entry', executionId: 'run', phase: 'awaiting-trust', startedAt: 'now', attempt: 0, restartCount: 0 };
const column: Column = { id: 'wait', name: 'Wait', deterministic: { language: 'bash', code: 'echo captured', directory: 'task', env: ['TOKEN'], exits: { ok: 'done' } } };
const review: DeterministicReview = { executionId: 'run', fingerprint: 'exact-version', code: 'echo captured', language: 'bash', directory: 'task', exits: { ok: 'done' }, env: ['TOKEN'], variables: [{ name: 'TOKEN', configured: true }], executionDirectory: '/isolated/project', source: { kind: 'file', path: '/isolated/project/wait.sh' } };
const noop = () => {};
describe('deterministic controls and local review', () => {
  it('keeps Stop after saved mode changes and addresses the owned execution', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={{ id: 'wait', name: 'Now agent', onEnterPrompt: 'new prompt' }} summary={{ ...summary, phase: 'active' }} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop deterministic script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicStop', taskId: 't', executionId: 'run' }));
  });
  it('keeps action-local progress and reports a bounded failure without hiding ownership', async () => {
    let reject!: (failure: unknown) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>((_, failure) => { reject = failure; }));
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'active' }} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop deterministic script' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop deterministic script' }).getAttribute('aria-busy')).toBe('true'));
    reject({ code: 'STALE_EXECUTION', message: 'Execution changed. Review the current task.' });
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Stop deterministic script' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('offers Play only for saved deterministic configuration and never moves stage', async () => {
    const run = vi.fn(async () => fixture());
    const view = render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'stopped' }} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play deterministic script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicPlay', taskId: 't' }));
    view.rerender(<ScriptActions task={card} column={{ id: 'wait', name: 'Manual' }} summary={{ ...summary, phase: 'stopped' }} run={run} />);
    expect((screen.getByRole('button', { name: 'Play deterministic script' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('offers a delivery-only retry for a failed saved result next to an explicit rerun', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'failed', deliveryStatus: 'failed' }} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery — deterministic result' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicRetryDelivery', taskId: 't', entryId: 'entry', executionId: 'run' }));
    // Rerunning stays a separate action whose accessible name matches its label.
    const again = screen.getByRole('button', { name: 'Run again — deterministic script' });
    expect(again.textContent).toBe('Run again');
  });
  it('reviews exact source and approves only the captured execution and fingerprint', async () => {
    const run = vi.fn(async () => fixture()); const api = { deterministicReview: vi.fn(async () => review) } as unknown as ClientApi;
    render(<ScriptReviewDialog task={card} projectName="Synthetic project" column={column} summary={summary} api={api} run={run} onClose={noop} />);
    await screen.findByText('exact-version');
    expect(screen.getByLabelText('Exact captured code').textContent).toBe('echo captured');
    expect(screen.getByText(/Imported modules and called executables are not frozen/)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve this captured version' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicApprove', taskId: 't', executionId: 'run', fingerprint: 'exact-version' }));
  });
  it('shows configured status without secret readback and clears masked drafts on project switch', async () => {
    const run = vi.fn(async () => fixture()); const api = { deterministicReview: vi.fn(async () => review) } as unknown as ClientApi;
    const view = render(<ScriptReviewDialog task={card} projectName="A" summary={summary} api={api} run={run} onClose={noop} />);
    const input = await screen.findByLabelText('Replacement value for TOKEN') as HTMLInputElement;
    expect(input.type).toBe('password'); expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'synthetic-not-a-secret' } });
    view.rerender(<ScriptReviewDialog task={{ ...card, projectId: 'other' }} projectName="B" summary={summary} api={api} run={run} onClose={noop} />);
    await waitFor(() => expect((screen.getByLabelText('Replacement value for TOKEN') as HTMLInputElement).value).toBe(''));
    fireEvent.change(screen.getByLabelText('Replacement value for TOKEN'), { target: { value: 'synthetic-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicVariable', taskId: 't', projectId: 'other', stageIdentity: 'stable', name: 'TOKEN', value: 'synthetic-value' }));
    // The scope travels from the reviewed dialog, not from a later lookup.
    await screen.findByLabelText('Replacement value for TOKEN');
    fireEvent.click(screen.getByRole('button', { name: 'Remove value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicVariable', taskId: 't', projectId: 'other', stageIdentity: 'stable', name: 'TOKEN' }));
  });
  it('never approves a saved-only preview or stale execution', async () => {
    const api = { deterministicReview: async () => ({ ...review, executionId: 'preview' }) } as unknown as ClientApi;
    render(<ScriptReviewDialog task={card} projectName="A" summary={summary} api={api} run={async () => fixture()} onClose={noop} />);
    await screen.findByText('exact-version');
    expect(screen.queryByRole('button', { name: 'Approve this captured version' })).toBeNull();
  });
  it('isolates in-flight review results across project and stage changes', async () => {
    let first!: (review: DeterministicReview) => void;
    const api = { deterministicReview: vi.fn().mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue({ ...review, fingerprint: 'project-B' }) } as unknown as ClientApi;
    const view = render(<ScriptReviewDialog task={card} projectName="A" summary={summary} api={api} run={async () => fixture()} onClose={noop} />);
    view.rerender(<ScriptReviewDialog task={{ ...card, projectId: 'B' }} projectName="B" summary={summary} api={api} run={async () => fixture()} onClose={noop} />);
    await screen.findByText('project-B');
    first({ ...review, fingerprint: 'project-A' });
    await waitFor(() => expect(screen.queryByText('project-A')).toBeNull());
  });
  it('composes deterministic fields and saves no prompt or allowed-transitions coexistence', async () => {
    const run = vi.fn(async () => fixture());
    render(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ id: 'wait', name: 'Wait', onEnterPrompt: 'old' }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} run={run} onClose={noop} onSaved={noop} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'deterministic' } });
    expect(screen.queryByText('Allowed destinations')).toBeNull();
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add exit' }));
    fireEvent.change(screen.getByLabelText('Exit name 1'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Exit destination 1'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ patch: { onEnterPrompt: null, deterministic: { language: 'bash', code: 'echo ok', directory: 'task', exits: { ok: 'done' } } } })));
  });
  it('delegates standalone handoff context to the same native row in drawer and ordinary chat', () => {
    const text = 'Exit passed · Execution run · Delivery handoff';
    const node = { data: { content: [{ type: 'text', text }], source: { kind: 'deterministic-handoff' }, form: 'notice', producer: { role: 'inject', label: 'deterministic-handoff' } } } as never;
    const native = { component: (props: { node: { data: { content: Array<{ text: string }> } } }) => <details data-testid="native-handoff"><summary>Native context notice</summary>{props.node.data.content[0]!.text}</details>, options: { key: 'context' } } as unknown as StoredEntry;
    const slots = { entriesOfSlot: () => [native], subscribe: () => noop };
    render(<DeterministicHandoffNodeView node={node} slots={slots} t={((key: string) => key) as never} />);
    expect(screen.getByTestId('native-handoff').textContent).toContain(text);
    expect(document.querySelector('.kb-handoff-context-fallback')).toBeNull();
  });
  it('claims standalone handoffs exclusively and renders native inline context with fallback', () => {
    const event = { type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: { id: 'msg', source: { kind: 'deterministic-handoff', form: 'notice', requestId: 'handoff', entryId: 'entry', summary: 'Result from CI' }, content: [{ type: 'text', text: 'Exit ok — [REDACTED] (execution run)' }] } } as never;
    expect(deterministicHandoffDefinition.match(event)).toEqual({ id: 'msg', role: 'start', exclusive: true });
    const data = deterministicHandoffDefinition.start({} as never, { event } as never, {} as never);
    expect(data.form).toBe('notice');
    const node = { data } as never;
    const slots = { entriesOfSlot: () => [], subscribe: () => noop };
    render(<DeterministicHandoffNodeView node={node} slots={slots} t={((key: string) => key) as never} />);
    expect(screen.getByText('Result from CI').closest('details')?.textContent).toContain('[REDACTED]');
  });
});
