// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StageEditorDialog } from '../../src/client/stage/stage-editor-dialog.js';
import { ScriptedProvider } from '../../src/client/scripted-context.js';
import { ScriptReviewProvider } from '../../src/client/script-review-provider.js';
import type { ClientApi, KanbanSnapshot, WorkflowAgent } from '../../src/shared/types.js';

afterEach(cleanup);
const noop = () => {};
const api = { scriptedReview: vi.fn(async () => { throw new Error('no review'); }), scriptedVariables: vi.fn(async () => ({ env: [], variables: [] })) } as unknown as ClientApi;
const AGENTS: WorkflowAgent[] = [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design', preset: 'ux' }];
const column = { id: 'design', name: 'Design', onEnterPrompt: 'Design it.' };
const columns = [column, { id: 'done', name: 'Done' }];

function providers(node: React.ReactNode, run: ReturnType<typeof vi.fn>) {
  return <ScriptedProvider api={api} run={run as never} summaries={{}} boardId="board"><ScriptReviewProvider api={api} run={run as never}>{node}</ScriptReviewProvider></ScriptedProvider>;
}

describe('the stage agent selection', () => {
  it('binds a stage to a declared agent and stores it with the draft', async () => {
    const run = vi.fn(async () => ({}) as KanbanSnapshot);
    render(providers(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="design" column={column} columns={columns} agents={AGENTS} tasks={[]} attention={{}} api={api} run={run} onClose={noop} onSaved={noop} />, run));
    fireEvent.change(screen.getByLabelText('Stage agent'), { target: { value: 'designer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.stage.update', hubId: 'hub', boardId: 'board', stageId: 'design', patch: { agent: 'designer' }, expectedRevision: 1 }));
  });

  it('returns the stage to the main conversation', async () => {
    const run = vi.fn(async () => ({}) as KanbanSnapshot);
    render(providers(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="design" column={{ ...column, agent: 'designer' }} columns={columns} agents={AGENTS} tasks={[]} attention={{}} api={api} run={run} onClose={noop} onSaved={noop} />, run));
    const select = screen.getByLabelText('Stage agent') as HTMLSelectElement;
    expect(select.value).toBe('designer');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'board.stage.update', hubId: 'hub', boardId: 'board', stageId: 'design', patch: { agent: null }, expectedRevision: 1 }));
  });

  it('offers only the main conversation when the board declares no other agent', () => {
    const run = vi.fn(async () => ({}) as KanbanSnapshot);
    render(providers(<StageEditorDialog hubId="hub" boardId="board" revision={1} initialStageId="design" column={column} columns={columns} tasks={[]} attention={{}} api={api} run={run} onClose={noop} onSaved={noop} />, run));
    const select = screen.getByLabelText('Stage agent') as HTMLSelectElement;
    expect([...select.options].map(option => option.value)).toEqual(['']);
    expect(screen.getByText(/This board declares no other agent/)).toBeTruthy();
  });
});
