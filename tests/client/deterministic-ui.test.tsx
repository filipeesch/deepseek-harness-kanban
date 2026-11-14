// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardScriptParameters, ScriptActions } from '../../src/client/deterministic-actions.js';
import { ScriptReviewDialog, type ScriptReviewRequest } from '../../src/client/deterministic-review.js';
import { LocalVariablesDialog } from '../../src/client/deterministic-variables.js';
import { StageEditorDialog } from '../../src/client/stage/stage-editor-dialog.js';
import { DeterministicProvider } from '../../src/client/deterministic-context.js';
import { ScriptReviewProvider } from '../../src/client/script-review-provider.js';
import { DeterministicHandoffNodeView, deterministicHandoffDefinition } from '../../src/client/deterministic-handoff-node.js';
import { task, fixture } from './helpers.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientApi, Column } from '../../src/shared/types.js';
import type { DeterministicStageReview, DeterministicSummary } from '../../src/shared/deterministic.js';
afterEach(cleanup);
const card = { ...task('t','CI','p','wait'), sessionIds: [], stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'stable', enteredAt: 'now' } };
const summary: DeterministicSummary = { entryId: 'entry', executionId: 'run', phase: 'awaiting-trust', startedAt: 'now', attempt: 0, restartCount: 0 };
const column: Column = { id: 'wait', name: 'Wait', deterministic: { language: 'bash', code: 'echo captured', directory: 'task', env: ['TOKEN'], exits: { ok: 'done' } } };
const request: ScriptReviewRequest = { boardId: 'board', stageId: 'wait', taskId: 't' };
const review: DeterministicStageReview = {
  stage: { boardId: 'board', stageId: 'wait', stageIdentity: 'stable', name: 'Wait' },
  version: { fingerprint: 'exact-version', stageGeneration: 'generation-1', captured: true, directoryDependent: false },
  code: 'echo captured', language: 'bash', directory: 'task', source: { kind: 'file', reference: 'wait.sh' },
  exits: { ok: 'done' }, env: ['TOKEN'], params: [], approval: 'required',
  captured: { taskId: 't', entryId: 'entry', executionDirectory: '/isolated/project' },
};
const noop = () => {};
const api = (value: DeterministicStageReview = review, variables = { env: ['TOKEN'], variables: [{ name: 'TOKEN', configured: true }] }): ClientApi => ({
  deterministicReview: vi.fn(async () => value),
  deterministicVariables: vi.fn(async () => variables),
} as unknown as ClientApi);
function provider(node: React.ReactNode, run: ReturnType<typeof vi.fn>, client: ClientApi = api()) {
  return <DeterministicProvider api={client} run={run as never} summaries={{ t: summary }} boardId="board"><ScriptReviewProvider api={client} run={run as never}>{node}</ScriptReviewProvider></DeterministicProvider>;
}
describe('deterministic controls and local review', () => {
  it('keeps Stop after saved mode changes and addresses the owned execution', async () => {
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={{ id: 'wait', name: 'Now agent', onEnterPrompt: 'new prompt' }} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Stop deterministic script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicStop', taskId: 't', executionId: 'run' }));
  });
  it('keeps action-local progress and reports a bounded failure without hiding ownership', async () => {
    let reject!: (failure: unknown) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>((_, failure) => { reject = failure; }));
    render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Stop deterministic script' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop deterministic script' }).getAttribute('aria-busy')).toBe('true'));
    reject({ code: 'STALE_EXECUTION', message: 'Execution changed. Review the current task.' });
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Stop deterministic script' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('offers Play only for saved deterministic configuration and never moves stage', async () => {
    const run = vi.fn(async () => fixture());
    const view = render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'stopped' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Play deterministic script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicPlay', taskId: 't' }));
    view.rerender(provider(<ScriptActions task={card} column={{ id: 'wait', name: 'Manual' }} summary={{ ...summary, phase: 'stopped' }} run={run} />, run));
    expect((screen.getByRole('button', { name: 'Play deterministic script' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('replaces Stop and Play with the approval action while the entry waits', () => {
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'awaiting-trust' }} run={run} />, run));
    expect(screen.getByRole('button', { name: 'Approve and run deterministic script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop deterministic script' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play deterministic script' })).toBeNull();
  });
it('delivers a saved result from the primary action and keeps Run again explicit', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} />);
    const deliver = screen.getByRole('button', { name: 'Deliver saved result — deterministic script' });
    expect(deliver.textContent).toBe('Deliver');
    fireEvent.click(deliver);
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicPlay', taskId: 't' }));
    const again = screen.getByRole('button', { name: 'Run again — deterministic script' });
    expect(again.textContent).toBe('Run again');
    fireEvent.click(again);
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicRunAgain', taskId: 't', entryId: 'entry' }));
  });

it('offers the delivery action for a failed saved result and hides rerun while the entry is owned', async () => {
    const run = vi.fn(async () => fixture());
    const view = render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'failed', exit: 'passed', deliveryStatus: 'failed' }} run={run} />);
    expect(screen.getByRole('button', { name: 'Deliver saved result — deterministic script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry delivery — deterministic result' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run again — deterministic script' })).toBeTruthy();
    view.rerender(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'active' }} run={run} />);
    expect(screen.queryByRole('button', { name: 'Run again — deterministic script' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop deterministic script' })).toBeTruthy();
  });

it('keeps the compact card row to the primary action', () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} compact />);
    expect(screen.getByRole('button', { name: 'Deliver saved result — deterministic script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run again — deterministic script' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop deterministic script' })).toBeNull();
  });

it('delivers a saved result even after the saved stage is no longer deterministic', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={{ id: 'wait', name: 'Manual' }} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} />);
    const deliver = screen.getByRole('button', { name: 'Deliver saved result — deterministic script' }) as HTMLButtonElement;
    expect(deliver.disabled).toBe(false);
  });

  it('offers parameter editing only for an owned non-active entry whose stage declares parameters', () => {
    const parameterColumn: Column = { ...column, deterministic: { ...column.deterministic!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const run = vi.fn(async () => fixture());
    const view = render(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    expect(screen.queryByRole('button', { name: 'Edit deterministic script parameters' })).toBeNull();
    view.rerender(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed' }} run={run} />, run));
    expect(screen.getByRole('button', { name: 'Edit deterministic script parameters' })).toBeTruthy();
    view.rerender(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'failed' }} run={run} />, run));
    expect(screen.queryByRole('button', { name: 'Edit deterministic script parameters' })).toBeNull();
  });
  it('edits and saves the current entry values through the parameter overlay', async () => {
    const parameterColumn: Column = { ...column, deterministic: { ...column.deterministic!, params: [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }] } };
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed', parameters: { pipeline: 'ci-main' } }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Edit deterministic script parameters' }));
    const pipeline = await screen.findByLabelText('Parameter pipeline') as HTMLInputElement;
    expect(pipeline.value).toBe('ci-main');
    expect((screen.getByLabelText('Parameter app') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Save values' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Parameter app'), { target: { value: 'checkout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save values' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicParameters', taskId: 't', entryId: 'entry', values: { pipeline: 'ci-main', app: 'checkout' } }));
  });
  it('shows parameter values read-only in selection mode without hiding them', () => {
    const run = vi.fn(async () => fixture());
    const parameterColumn: Column = { ...column, deterministic: { ...column.deterministic!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const view = render(provider(<CardScriptParameters task={card} column={parameterColumn} selectionMode />, run));
    expect(screen.getByText('pipeline=—')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit deterministic script parameters' })).toBeNull();
    view.rerender(provider(<CardScriptParameters task={card} column={parameterColumn} />, run));
    expect(screen.getByRole('button', { name: 'Edit deterministic script parameters' })).toBeTruthy();
  });
  it('reviews the exact stage version and approves that fingerprint', async () => {
    const run = vi.fn(async () => fixture()); const client = api();
    render(<ScriptReviewDialog request={request} api={client} run={run} onClose={noop} />);
    await screen.findByText('exact-version');
    const code = screen.getByLabelText('Exact captured code');
    expect(code.textContent).toContain('echo captured');
    expect(code.getAttribute('tabindex')).toBe('0');
    expect(code.getAttribute('aria-readonly')).toBe('true');
    expect(screen.getByText('/isolated/project')).toBeTruthy();
    expect(screen.getByText(/Imported modules and called executables are not frozen/)).toBeTruthy();
    expect(screen.queryByLabelText('Replacement value for TOKEN')).toBeNull();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and run' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.deterministicApprove', boardId: 'board', stageId: 'wait', fingerprint: 'exact-version', stageGeneration: 'generation-1', taskId: 't' }));
  });
  it('approves an authored stage version before any card enters', async () => {
    const authored: DeterministicStageReview = { ...review, version: { fingerprint: 'saved-version', stageGeneration: 'generation-1', captured: false, directoryDependent: false } };
    const run = vi.fn(async () => fixture());
    render(<ScriptReviewDialog request={{ boardId: 'board', stageId: 'wait' }} api={api(authored)} run={run} onClose={noop} />);
    await screen.findByText('saved-version');
    expect(screen.getByText(/has not captured an execution yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve this version' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.deterministicApprove', boardId: 'board', stageId: 'wait', fingerprint: 'saved-version', stageGeneration: 'generation-1' }));
  });
  it('does not offer approval for an already approved version', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptReviewDialog request={request} api={api({ ...review, approval: 'approved' })} run={run} onClose={noop} />);
    await screen.findByText('exact-version');
    expect(screen.queryByRole('button', { name: 'Approve and run' })).toBeNull();
  });
  it('shows configured local variable status without secret readback', async () => {
    const run = vi.fn(async () => fixture());
    render(<LocalVariablesDialog task={card} projectName="A" api={api()} run={run} onClose={noop} />);
    const input = await screen.findByLabelText('Replacement value for TOKEN') as HTMLInputElement;
    expect(input.type).toBe('password'); expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'synthetic-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicVariable', taskId: 't', projectId: 'p', stageIdentity: 'stable', name: 'TOKEN', value: 'synthetic-value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicVariable', taskId: 't', projectId: 'p', stageIdentity: 'stable', name: 'TOKEN' }));
  });
  it('isolates in-flight review results across request changes', async () => {
    let first!: (review: DeterministicStageReview) => void;
    const client = { deterministicReview: vi.fn().mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue({ ...review, version: { ...review.version, fingerprint: 'stage-B' } }), deterministicVariables: vi.fn() } as unknown as ClientApi;
    const view = render(<ScriptReviewDialog request={request} api={client} run={async () => fixture()} onClose={noop} />);
    view.rerender(<ScriptReviewDialog request={{ ...request, stageId: 'other' }} api={client} run={async () => fixture()} onClose={noop} />);
    await screen.findByText('stage-B');
    first({ ...review, version: { ...review.version, fingerprint: 'stage-A' } });
    await waitFor(() => expect(screen.queryByText('stage-A')).toBeNull());
  });
  it('composes deterministic fields and saves no prompt or allowed-transitions coexistence', async () => {
    const run = vi.fn(async () => fixture());
    const client = api({ ...review, approval: 'approved' });
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ id: 'wait', name: 'Wait', onEnterPrompt: 'old' }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'deterministic' } });
    expect(screen.queryByText('Allowed destinations')).toBeNull();
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add exit' }));
    fireEvent.change(screen.getByLabelText('Exit name 1'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Exit destination 1'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ patch: { onEnterPrompt: null, deterministic: { language: 'bash', code: 'echo ok', directory: 'task', exits: { ok: 'done' } } } })));
  });
  it('keeps the editor open after saving an unapproved deterministic version', async () => {
    const run = vi.fn(async () => fixture());
    const client = { deterministicReview: vi.fn().mockResolvedValueOnce({ ...review, approval: 'approved' }).mockResolvedValue({ ...review, approval: 'required' }), deterministicVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, deterministic: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await screen.findByText(/This executable version is not approved yet/);
    expect(screen.getByRole('button', { name: 'Review and approve script' })).toBeTruthy();
  });
  it('ignores an older in-flight review after the saved stage version changes', async () => {
    const run = vi.fn(async () => fixture());
    let oldResolve!: (value: DeterministicStageReview) => void;
    let savedResolve!: (value: DeterministicStageReview) => void;
    const oldReview = new Promise<DeterministicStageReview>(resolve => { oldResolve = resolve; });
    const savedReview = new Promise<DeterministicStageReview>(resolve => { savedResolve = resolve; });
    const client = { deterministicReview: vi.fn().mockReturnValueOnce(oldReview).mockReturnValueOnce(savedReview), deterministicVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, deterministic: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    await waitFor(() => expect(client.deterministicReview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(client.deterministicReview).toHaveBeenCalledTimes(2));
    savedResolve({ ...review, approval: 'required' });
    await screen.findByText(/This executable version is not approved yet/);
    oldResolve({ ...review, approval: 'approved' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review and approve script' })).toBeTruthy());
    expect(screen.queryByText(/was saved/)).toBeTruthy();
  });
  it('keeps the editor open and names the host error when the saved version cannot be read', async () => {
    const run = vi.fn(async () => fixture());
    const client = { deterministicReview: vi.fn().mockRejectedValue(new Error('The saved version is unreadable.')), deterministicVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, deterministic: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await screen.findByText(/The stored version could not be read here/);
    expect(screen.getByText(/The saved version is unreadable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
  it('delegates standalone handoff context to the same native row in drawer and ordinary chat', () => {
    const text = 'Exit passed · Execution run · Delivery handoff';
    const node = { data: { content: [{ type: 'text', text }], source: { kind: 'deterministic-handoff' }, form: 'notice', producer: { role: 'inject', label: 'deterministic-handoff' } } } as never;
    const native = { component: (props: { node: { data: { content: Array<{ text: string }> } } }) => <details data-testid="native-handoff"><summary>Native context notice</summary>{props.node.data.content[0]!.text}</details>, options: { key: 'context' } } as unknown as StoredEntry;
    const slots = { entriesOfSlot: () => [native], subscribe: () => noop };
    render(<DeterministicHandoffNodeView node={node} slots={slots} t={((key: string) => key) as never} />);
    expect(screen.getByTestId('native-handoff').textContent).toContain(text);
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
