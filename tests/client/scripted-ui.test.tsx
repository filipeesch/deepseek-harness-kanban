// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardScriptParameters, ScriptActions } from '../../src/client/scripted-actions.js';
import { ScriptReviewDialog, type ScriptReviewRequest } from '../../src/client/scripted-review.js';
import { ScriptPanel } from '../../src/client/scripted-panel.js';
import { LocalVariablesDialog } from '../../src/client/scripted-variables.js';
import { StageEditorDialog } from '../../src/client/stage/stage-editor-dialog.js';
import { ScriptedProvider } from '../../src/client/scripted-context.js';
import { ScriptReviewProvider } from '../../src/client/script-review-provider.js';
import { ScriptedHandoffNodeView, scriptedHandoffDefinition } from '../../src/client/scripted-handoff-node.js';
import { task, fixture } from './helpers.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientApi, Column } from '../../src/shared/types.js';
import type { ScriptedStageReview, ScriptedSummary } from '../../src/shared/scripted.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/code-editor.js')>('../../src/client/code-editor.js');
  const React = await import('react');
  const CodeEditor = ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
    React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) });
  return { ...actual, CodeEditor };
});

afterEach(cleanup);
const card = { ...task('t','CI','p','wait'), sessionIds: [], stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'stable', enteredAt: 'now' } };
const summary: ScriptedSummary = { entryId: 'entry', executionId: 'run', phase: 'awaiting-trust', startedAt: 'now', attempt: 0, restartCount: 0 };
const column: Column = { id: 'wait', name: 'Wait', scripted: { language: 'bash', code: 'echo captured', directory: 'task', env: ['TOKEN'], exits: { ok: 'done' } } };
const request: ScriptReviewRequest = { boardId: 'board', stageId: 'wait', taskId: 't' };
const review: ScriptedStageReview = {
  stage: { boardId: 'board', stageId: 'wait', stageIdentity: 'stable', name: 'Wait' },
  version: { fingerprint: 'exact-version', stageGeneration: 'generation-1', captured: true, directoryDependent: false },
  code: 'echo captured', language: 'bash', directory: 'task', source: { kind: 'file', reference: 'wait.sh' },
  exits: { ok: 'done' }, env: ['TOKEN'], params: [], approval: 'required',
  captured: { taskId: 't', entryId: 'entry', executionDirectory: '/isolated/project' },
};
const noop = () => {};
const api = (value: ScriptedStageReview = review, variables = { env: ['TOKEN'], variables: [{ name: 'TOKEN', configured: true }] }): ClientApi => ({
  scriptedReview: vi.fn(async () => value),
  scriptedVariables: vi.fn(async () => variables),
} as unknown as ClientApi);
function provider(node: React.ReactNode, run: ReturnType<typeof vi.fn>, client: ClientApi = api()) {
  return <ScriptedProvider api={client} run={run as never} summaries={{ t: summary }} boardId="board"><ScriptReviewProvider api={client} run={run as never}>{node}</ScriptReviewProvider></ScriptedProvider>;
}
describe('scripted controls and local review', () => {
  it('keeps Stop after saved mode changes and addresses the owned execution', async () => {
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={{ id: 'wait', name: 'Now agent', onEnterPrompt: 'new prompt' }} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Stop script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedStop', taskId: 't', executionId: 'run' }));
  });
  it('keeps action-local progress and reports a bounded failure without hiding ownership', async () => {
    let reject!: (failure: unknown) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>((_, failure) => { reject = failure; }));
    render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Stop script' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop script' }).getAttribute('aria-busy')).toBe('true'));
    reject({ code: 'STALE_EXECUTION', message: 'Execution changed. Review the current task.' });
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Stop script' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('offers Play only for saved scripted configuration and never moves stage', async () => {
    const run = vi.fn(async () => fixture());
    const view = render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'stopped' }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Play script' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedPlay', taskId: 't' }));
    view.rerender(provider(<ScriptActions task={card} column={{ id: 'wait', name: 'Manual' }} summary={{ ...summary, phase: 'stopped' }} run={run} />, run));
    expect((screen.getByRole('button', { name: 'Play script' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('replaces Stop and Play with the approval action while the entry waits', () => {
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'awaiting-trust' }} run={run} />, run));
    expect(screen.getByRole('button', { name: 'Approve and run script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop script' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play script' })).toBeNull();
  });
it('delivers a saved result from the primary action and keeps Run again explicit', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} />);
    const deliver = screen.getByRole('button', { name: 'Deliver saved result — script' });
    expect(deliver.textContent).toBe('Deliver');
    fireEvent.click(deliver);
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedPlay', taskId: 't' }));
    const again = screen.getByRole('button', { name: 'Run again — script' });
    expect(again.textContent).toBe('Run again');
    fireEvent.click(again);
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedRunAgain', taskId: 't', entryId: 'entry' }));
  });

it('offers the delivery action for a failed saved result and hides rerun while the entry is owned', async () => {
    const run = vi.fn(async () => fixture());
    const view = render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'failed', exit: 'passed', deliveryStatus: 'failed' }} run={run} />);
    expect(screen.getByRole('button', { name: 'Deliver saved result — script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry delivery — scripted result' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run again — script' })).toBeTruthy();
    view.rerender(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'active' }} run={run} />);
    expect(screen.queryByRole('button', { name: 'Run again — script' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop script' })).toBeTruthy();
  });

it('keeps the compact card row to the primary action', () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} compact />);
    expect(screen.getByRole('button', { name: 'Deliver saved result — script' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run again — script' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop script' })).toBeNull();
  });

it('delivers a saved result even after the saved stage is no longer scripted', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptActions task={card} column={{ id: 'wait', name: 'Manual' }} summary={{ ...summary, phase: 'result-ready', exit: 'passed', deliveryStatus: 'pending' }} run={run} />);
    const deliver = screen.getByRole('button', { name: 'Deliver saved result — script' }) as HTMLButtonElement;
    expect(deliver.disabled).toBe(false);
  });

  it('offers parameter editing only for an owned non-active entry whose stage declares parameters', () => {
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const run = vi.fn(async () => fixture());
    const view = render(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'active' }} run={run} />, run));
    expect(screen.queryByRole('button', { name: 'Edit script parameters' })).toBeNull();
    view.rerender(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed' }} run={run} />, run));
    expect(screen.getByRole('button', { name: 'Edit script parameters' })).toBeTruthy();
    view.rerender(provider(<ScriptActions task={card} column={column} summary={{ ...summary, phase: 'failed' }} run={run} />, run));
    expect(screen.queryByRole('button', { name: 'Edit script parameters' })).toBeNull();
  });
  it('edits and saves the current entry values through the parameter overlay', async () => {
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }] } };
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed', parameters: { pipeline: 'ci-main' } }} run={run} />, run));
    fireEvent.click(screen.getByRole('button', { name: 'Edit script parameters' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit script parameters' });
    expect(dialog.classList.contains('kb-dialog-parameters')).toBe(true);
    expect(dialog.closest('.kb-card')).toBeNull();
    expect(dialog.closest('.dsh-kanban')?.parentElement).toBe(document.body);
    const pipeline = await screen.findByLabelText('Parameter pipeline') as HTMLInputElement;
    expect(pipeline.tagName).toBe('TEXTAREA');
    expect(pipeline.value).toBe('ci-main');
    expect((screen.getByLabelText('Parameter app') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Save values' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Parameter app'), { target: { value: 'checkout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save values' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedParameters', taskId: 't', entryId: 'entry', values: { pipeline: 'ci-main', app: 'checkout' } }));
  });
  it('returns focus to the opener when the parameter editor is dismissed without saving', async () => {
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const run = vi.fn(async () => fixture());
    render(provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed', parameters: { pipeline: 'ci-main' } }} run={run} />, run));
    const opener = screen.getByRole('button', { name: 'Edit script parameters' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Edit script parameters' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit script parameters' })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('portals the parameter editor outside the card and offers every declared value', async () => {
    const parameters = Array.from({ length: 6 }, (_, index) => ({ name: 'p' + index, description: 'Description ' + index }));
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: parameters } };
    const run = vi.fn(async () => fixture());
    const root = document.createElement('div'); root.className = 'dsh-kanban'; document.body.append(root);
    const view = render(<div className="dsh-kanban"><div data-testid="workflow-stage"><div data-testid="card">{provider(<ScriptActions task={card} column={parameterColumn} summary={{ ...summary, phase: 'failed', parameters: { p0: 'v0' } }} run={run} />, run)}</div></div></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit script parameters' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit script parameters' });
    expect(screen.getByTestId('card').contains(dialog)).toBe(false);
    expect(screen.getByTestId('workflow-stage').contains(dialog)).toBe(false);
    expect(dialog.querySelector('.kb-script-parameter-list')).toBeTruthy();
    for (let index = 0; index < 6; index += 1) expect(screen.getByLabelText('Parameter p' + index)).toBeTruthy();
    expect((screen.getByLabelText('Parameter p0') as HTMLTextAreaElement).value).toBe('v0');
    view.unmount(); root.remove();
  });

  it('keeps the drawer parameter display without a received-from provenance line', () => {
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const run = vi.fn(async () => fixture());
    const summaryWithParameters: ScriptedSummary = { ...summary, phase: 'failed', parameters: { pipeline: 'ci-main' } };
    render(<ScriptedProvider api={api()} run={run as never} summaries={{ t: summaryWithParameters }} boardId="board"><ScriptReviewProvider api={api()} run={run as never}><ScriptPanel task={card} column={parameterColumn} projectName="A" api={api()} run={run} /></ScriptReviewProvider></ScriptedProvider>);
    expect(screen.getByText('Parameters: pipeline=ci-main')).toBeTruthy();
    expect(screen.queryByText(/received from/i)).toBeNull();
  });

  it('shows parameter values read-only in selection mode without hiding them', () => {
    const run = vi.fn(async () => fixture());
    const parameterColumn: Column = { ...column, scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }] } };
    const view = render(provider(<CardScriptParameters task={card} column={parameterColumn} selectionMode />, run));
    expect(screen.getByText('pipeline=—')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit script parameters' })).toBeNull();
    view.rerender(provider(<CardScriptParameters task={card} column={parameterColumn} />, run));
    expect(screen.getByRole('button', { name: 'Edit script parameters' })).toBeTruthy();
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
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.scriptedApprove', boardId: 'board', stageId: 'wait', fingerprint: 'exact-version', stageGeneration: 'generation-1', taskId: 't' }));
  });
  it('approves an authored stage version before any card enters', async () => {
    const authored: ScriptedStageReview = { ...review, version: { fingerprint: 'saved-version', stageGeneration: 'generation-1', captured: false, directoryDependent: false } };
    const run = vi.fn(async () => fixture());
    render(<ScriptReviewDialog request={{ boardId: 'board', stageId: 'wait' }} api={api(authored)} run={run} onClose={noop} />);
    await screen.findByText('saved-version');
    expect(screen.getByText(/has not captured an execution yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve this version' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.scriptedApprove', boardId: 'board', stageId: 'wait', fingerprint: 'saved-version', stageGeneration: 'generation-1' }));
  });
  it('does not offer approval for an already approved version', async () => {
    const run = vi.fn(async () => fixture());
    render(<ScriptReviewDialog request={request} api={api({ ...review, approval: 'approved' })} run={run} onClose={noop} />);
    await screen.findByText('exact-version');
    expect(screen.queryByRole('button', { name: 'Approve and run' })).toBeNull();
  });
  it('names where an approval came from', async () => {
    const run = vi.fn(async () => fixture());
    const { unmount } = render(<ScriptReviewDialog request={request} api={api({ ...review, approval: 'approved', approvalOrigin: 'author-save' })} run={run} onClose={noop} />);
    await screen.findByText(/approved by the author’s own save in the stage editor/);
    unmount();
    render(<ScriptReviewDialog request={request} api={api({ ...review, approval: 'approved', approvalOrigin: 'review' })} run={run} onClose={noop} />);
    await screen.findByText(/approved after an explicit review/);
  });
  it('presents the approval origin in the stage editor Approval tab', async () => {
    const run = vi.fn(async () => fixture());
    const client = api({ ...review, approval: 'approved', approvalOrigin: 'author-save' });
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, scripted: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.click(screen.getByRole('tab', { name: /^Approval/ }));
    // The state is emphasised with its own element, so the paragraph's text is matched as a whole.
    await screen.findByText((_content, element) => element?.tagName === 'P' && /Stored script version: approved — saved in this editor by you/.test(element.textContent ?? ''));
    expect(screen.queryByRole('button', { name: 'Review and approve script' })).toBeNull();
  });
  it('shows configured local variable status without secret readback', async () => {
    const run = vi.fn(async () => fixture());
    render(<LocalVariablesDialog task={card} projectName="A" api={api()} run={run} onClose={noop} />);
    const input = await screen.findByLabelText('Replacement value for TOKEN') as HTMLInputElement;
    expect(input.type).toBe('password'); expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'synthetic-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedVariable', taskId: 't', projectId: 'p', stageIdentity: 'stable', name: 'TOKEN', value: 'synthetic-value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove value' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.scriptedVariable', taskId: 't', projectId: 'p', stageIdentity: 'stable', name: 'TOKEN' }));
  });
  it('isolates in-flight review results across request changes', async () => {
    let first!: (review: ScriptedStageReview) => void;
    const client = { scriptedReview: vi.fn().mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue({ ...review, version: { ...review.version, fingerprint: 'stage-B' } }), scriptedVariables: vi.fn() } as unknown as ClientApi;
    const view = render(<ScriptReviewDialog request={request} api={client} run={async () => fixture()} onClose={noop} />);
    view.rerender(<ScriptReviewDialog request={{ ...request, stageId: 'other' }} api={client} run={async () => fixture()} onClose={noop} />);
    await screen.findByText('stage-B');
    first({ ...review, version: { ...review.version, fingerprint: 'stage-A' } });
    await waitFor(() => expect(screen.queryByText('stage-A')).toBeNull());
  });
  it('composes scripted fields and saves no prompt or allowed-transitions coexistence', async () => {
    const run = vi.fn(async () => fixture());
    const client = api({ ...review, approval: 'approved' });
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ id: 'wait', name: 'Wait', onEnterPrompt: 'old' }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'scripted' } });
    fireEvent.click(screen.getByRole('tab', { name: /^Execution/ }));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo ok' } });
    fireEvent.click(screen.getByRole('tab', { name: /^Routing/ }));
    expect(screen.queryByText('Allowed destinations')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add exit' }));
    fireEvent.change(screen.getByLabelText('Exit name 1'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Exit destination 1'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ patch: { onEnterPrompt: null, scripted: { language: 'bash', code: 'echo ok', directory: 'task', exits: { ok: 'done' } } } })));
  });
  it('keeps the editor open after saving an unapproved scripted version', async () => {
    const run = vi.fn(async () => fixture());
    const client = { scriptedReview: vi.fn().mockResolvedValueOnce({ ...review, approval: 'approved' }).mockResolvedValue({ ...review, approval: 'required' }), scriptedVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, scripted: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.click(screen.getByRole('tab', { name: /^Execution/ }));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await screen.findByText(/This executable version still waits for review/);
    expect(screen.getByRole('button', { name: 'Review and approve script' })).toBeTruthy();
  });
  it('closes after a save that stored no program change', async () => {
    const run = vi.fn(async () => fixture());
    const onSaved = vi.fn();
    const client = api({ ...review, approval: 'required' });
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, scripted: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={onSaved} />, run, client));
    fireEvent.change(screen.getByLabelText('Stage name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Stage saved' })).toBeNull();
  });

  it('ignores an older in-flight review after the saved stage version changes', async () => {
    const run = vi.fn(async () => fixture());
    let oldResolve!: (value: ScriptedStageReview) => void;
    let savedResolve!: (value: ScriptedStageReview) => void;
    const oldReview = new Promise<ScriptedStageReview>(resolve => { oldResolve = resolve; });
    const savedReview = new Promise<ScriptedStageReview>(resolve => { savedResolve = resolve; });
    const client = { scriptedReview: vi.fn().mockReturnValueOnce(oldReview).mockReturnValueOnce(savedReview), scriptedVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, scripted: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    await waitFor(() => expect(client.scriptedReview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: /^Execution/ }));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(client.scriptedReview).toHaveBeenCalledTimes(2));
    savedResolve({ ...review, approval: 'required' });
    await screen.findByText(/This executable version still waits for review/);
    oldResolve({ ...review, approval: 'approved' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review and approve script' })).toBeTruthy());
    expect(screen.queryByText(/was saved/)).toBeTruthy();
  });
  it('keeps the editor open and names the host error when the saved version cannot be read', async () => {
    const run = vi.fn(async () => fixture());
    const client = { scriptedReview: vi.fn().mockRejectedValue(new Error('The saved version is unreadable.')), scriptedVariables: vi.fn() } as unknown as ClientApi;
    render(provider(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="wait" column={{ ...column, scripted: { language: 'bash', code: 'echo old', directory: 'task', exits: { ok: 'done' } } }} columns={[column, { id: 'done', name: 'Done' }]} tasks={[]} attention={{}} api={client} run={run} onClose={noop} onSaved={noop} />, run, client));
    fireEvent.click(screen.getByRole('tab', { name: /^Execution/ }));
    fireEvent.change(screen.getByLabelText('Inline code'), { target: { value: 'echo new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await screen.findByText(/The stored version could not be read here/);
    expect(screen.getByText(/The saved version is unreadable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
  it('delegates standalone handoff context to the same native row in drawer and ordinary chat', () => {
    const text = 'Exit passed · Execution run · Delivery handoff';
    const node = { data: { content: [{ type: 'text', text }], source: { kind: 'scripted-handoff' }, form: 'notice', producer: { role: 'inject', label: 'scripted-handoff' } } } as never;
    const native = { component: (props: { node: { data: { content: Array<{ text: string }> } } }) => <details data-testid="native-handoff"><summary>Native context notice</summary>{props.node.data.content[0]!.text}</details>, options: { key: 'context' } } as unknown as StoredEntry;
    const slots = { entriesOfSlot: () => [native], subscribe: () => noop };
    render(<ScriptedHandoffNodeView node={node} slots={slots} t={((key: string) => key) as never} />);
    expect(screen.getByTestId('native-handoff').textContent).toContain(text);
  });
  it('claims standalone handoffs exclusively and renders native inline context with fallback', () => {
    const event = { type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: { id: 'msg', source: { kind: 'scripted-handoff', form: 'notice', requestId: 'handoff', entryId: 'entry', summary: 'Result from CI' }, content: [{ type: 'text', text: 'Exit ok — [REDACTED] (execution run)' }] } } as never;
    expect(scriptedHandoffDefinition.match(event)).toEqual({ id: 'msg', role: 'start', exclusive: true });
    const data = scriptedHandoffDefinition.start({} as never, { event } as never, {} as never);
    expect(data.form).toBe('notice');
    const node = { data } as never;
    const slots = { entriesOfSlot: () => [], subscribe: () => noop };
    render(<ScriptedHandoffNodeView node={node} slots={slots} t={((key: string) => key) as never} />);
    expect(screen.getByText('Result from CI').closest('details')?.textContent).toContain('[REDACTED]');
  });
});
