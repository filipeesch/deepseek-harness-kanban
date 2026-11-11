// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { parse } from 'yaml';
import type { Board, BoardState, Command, HubState, KanbanSnapshot, ModelCatalog, ModelSelection, Workflow } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeBoardModelField } from '../../src/domain/board-model-field.js';
import { BoardModelForm } from '../../src/client/settings/board/board-model-form.js';
import { BoardSettings } from '../../src/client/settings/board-settings.js';

afterEach(cleanup);

const now = '2026-01-01T00:00:00.000Z';
const AUTHORED = '# The team flow\nname: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog # keep me\n  - id: done\n    label: Done\n';
/** The same board with an unsaved prompt edit, so a draft is distinguishable from the saved document. */
const DRAFTED = AUTHORED.replace('label: Backlog # keep me', 'label: Backlog # keep me\n    prompt: Review the whole board');
const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] }],
  failures: [],
};
const route: ModelSelection = { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' };

function board(stored?: ModelSelection): Board {
  const workflow: Workflow = parseWorkflow(AUTHORED);
  return {
    id: 'b1', name: 'Flow', workflowYaml: AUTHORED,
    workflow: stored === undefined ? workflow : { ...workflow, model: stored },
    createdAt: now, updatedAt: now,
  };
}
function hub(value: Board): HubState {
  return { id: 'h1', name: 'My Hub', revision: 7, projects: [], boards: [value], tasks: [], notes: [], createdAt: now, updatedAt: now };
}
function boardState(value: Board): BoardState {
  return { schemaVersion: 2, revision: 7, workflowYaml: value.workflowYaml, workflow: value.workflow, projects: [], tasks: [], notes: [] };
}
function harness(options: { stored?: ModelSelection; yaml?: string; catalog?: ModelCatalog | null } = {}) {
  const value = board(options.stored);
  const run = vi.fn(async (_command: Command) => ({}) as KanbanSnapshot);
  const modelCatalog = vi.fn(async () => {
    if (options.catalog === null) throw new Error('The host is unreachable.');
    return options.catalog ?? catalog;
  });
  const api = { modelCatalog } as never;
  return { value, hub: hub(value), state: boardState(value), run, api, modelCatalog };
}
function mount(options: Parameters<typeof harness>[0] & { workflowEditing?: boolean } = {}) {
  const h = harness(options);
  const user = userEvent.setup();
  const rendered = render(<BoardModelForm hub={h.hub} board={h.value} run={h.run} api={h.api} yaml={options.yaml ?? AUTHORED} baseRevision={7} {...(options.workflowEditing === undefined ? {} : { workflowEditing: options.workflowEditing })} />);
  return { ...h, user, rerender: rendered.rerender };
}
/** The closed control that names the route the form currently holds. */
function modelTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Model:/ });
}
/** Open the searchable picker and choose one row; the wait covers the catalog read. */
async function chooseRoute(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(modelTrigger());
  const dialog = screen.getByRole('dialog', { name: 'Choose the model' });
  await user.click(await within(dialog).findByRole('option', { name }));
}
/** Reloading lives inside the picker, beside the routes it refreshes. */
async function reloadModels(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(modelTrigger());
  const dialog = screen.getByRole('dialog', { name: 'Choose the model' });
  await user.click(within(dialog).getByRole('button', { name: 'Reload models' }));
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save model' }) as HTMLButtonElement;
}
/** The effort select only offers what the catalog says about the chosen model. */
async function chooseEffort(user: ReturnType<typeof userEvent.setup>, value: string): Promise<void> {
  const select = screen.getByLabelText('Reasoning effort') as HTMLSelectElement;
  await waitFor(() => expect(select.querySelector(`option[value="${value}"]`) !== null).toBe(true));
  await user.selectOptions(select, value);
}
function savedModel(command: Command): unknown {
  return parse((command as Extract<Command, { type: 'board.workflow.save' }>).yaml).model;
}

describe('the board default model form', () => {
  it('writes the chosen route into the workflow document through the ordinary board save', async () => {
    const { user, run } = mount();
    await chooseRoute(user, /Reason/);
    await chooseEffort(user, 'high');
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const command = run.mock.calls[0]![0] as Extract<Command, { type: 'board.workflow.save' }>;
    expect(command).toMatchObject({ type: 'board.workflow.save', hubId: 'h1', boardId: 'b1', expectedRevision: 7 });
    expect(command.yaml).toBe(writeBoardModelField(AUTHORED, route));
    expect(command.yaml).toContain('# The team flow');
    expect(command.yaml).toContain('label: Backlog # keep me');
    expect(parse(command.yaml)).toEqual({ ...parse(AUTHORED), model: { provider: 'deepseek', model: 'reason', reasoning_effort: 'high' } });
  });

  it('removes the mapping when the host default is chosen, leaving the rest of the document alone', async () => {
    const { user, run } = mount({ stored: route });
    await chooseRoute(user, /Host default model/);
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const command = run.mock.calls[0]![0] as Extract<Command, { type: 'board.workflow.save' }>;
    expect(command.yaml).not.toContain('model:');
    expect(parseWorkflow(command.yaml).model).toBeUndefined();
    expect(command.yaml).toContain('# The team flow');
  });

  it('offers a change that only touches the reasoning effort', async () => {
    const { user, run } = mount({ stored: route });
    expect(saveButton().disabled).toBe(true);
    await chooseEffort(user, 'low');
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(savedModel(run.mock.calls[0]![0])).toEqual({ provider: 'deepseek', model: 'reason', reasoning_effort: 'low' });
  });

  it('offers a change that only removes the reasoning effort', async () => {
    const { user, run } = mount({ stored: route });
    await chooseEffort(user, '');
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(savedModel(run.mock.calls[0]![0])).toEqual({ provider: 'deepseek', model: 'reason' });
  });

  it('adopts an effort saved elsewhere instead of holding the stale choice', async () => {
    const h = harness({ stored: route });
    const user = userEvent.setup();
    const { rerender } = render(<BoardModelForm hub={h.hub} board={h.value} run={h.run} api={h.api} yaml={AUTHORED} baseRevision={7} />);
    await waitFor(() => expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('high'));
    const savedElsewhere: ModelSelection = { ...route, reasoningEffort: 'low' };
    const updated = board(savedElsewhere);
    rerender(<BoardModelForm hub={hub(updated)} board={updated} run={h.run} api={h.api} yaml={writeBoardModelField(AUTHORED, savedElsewhere)} baseRevision={8} />);
    // Route alone would say nothing changed, leaving the form holding an effort the
    // board no longer stores and offering nothing to save.
    await waitFor(() => expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('low'));
    expect(saveButton().disabled).toBe(true);
    await chooseEffort(user, 'high');
    expect(saveButton().disabled).toBe(false);
  });

  it('refuses to write a document the parser rejects and keeps the choice on screen', async () => {
    const { user, run } = mount({ yaml: 'name: Broken\n' });
    await chooseRoute(user, /Reason/);
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(run).not.toHaveBeenCalled();
    expect(modelTrigger().getAttribute('aria-label')).toBe('Model: DeepSeek · Reason');
  });

  it('says a stored model the host does not offer without removing or rewriting it', async () => {
    const stored: ModelSelection = { provider: 'anthropic', model: 'claude' };
    const { user, run } = mount({ stored });
    expect(await screen.findByText(/is not offered by this host/)).toBeTruthy();
    expect(modelTrigger().getAttribute('aria-label')).toBe('Model: anthropic · claude (not in the catalog)');
    expect(saveButton().disabled).toBe(true);
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
  });

  it('offers nothing to save while the choice matches the stored model and says so', async () => {
    const { user } = mount({ stored: route });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('No changes to save.')).toBeTruthy();
    await chooseRoute(user, /Chat/);
    expect(saveButton().disabled).toBe(false);
    expect(screen.queryByText('No changes to save.')).toBeNull();
    await chooseRoute(user, /Reason/);
    await chooseEffort(user, 'high');
    expect(saveButton().disabled).toBe(true);
  });

  it('stands down while the workflow editor holds edits, and says why', async () => {
    const { user, run } = mount({ workflowEditing: true });
    await chooseRoute(user, /Reason/);
    expect(saveButton().disabled).toBe(true);
    expect(await screen.findByText(/Save or discard the workflow edits/)).toBeTruthy();
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
  });

  it('reports an unreadable catalog and reads it again on request', async () => {
    const h = harness({ catalog: null });
    const user = userEvent.setup();
    render(<BoardModelForm hub={h.hub} board={h.value} run={h.run} api={h.api} yaml={AUTHORED} baseRevision={7} />);
    expect(await screen.findByText(/The model catalog is unavailable/)).toBeTruthy();
    h.modelCatalog.mockImplementation(async () => catalog);
    await reloadModels(user);
    await waitFor(() => expect(screen.queryByText(/The model catalog is unavailable/)).toBeNull());
    expect(h.modelCatalog).toHaveBeenCalledTimes(2);
  });

  it('keeps saying what is stored when a refresh stops answering', async () => {
    const h = harness();
    const user = userEvent.setup();
    render(<BoardModelForm hub={h.hub} board={board(route)} run={h.run} api={h.api} yaml={writeBoardModelField(AUTHORED, route)} baseRevision={7} />);
    await chooseRoute(user, /Reason/);
    h.modelCatalog.mockImplementation(async () => { throw new Error('The host is unreachable.'); });
    await reloadModels(user);
    expect(await screen.findByText(/The model catalog is unavailable/)).toBeTruthy();
    // The stored route is a fact about the board, not about this read: it stays shown,
    // under the bare ids, because the catalog that carried the display names is gone.
    expect(modelTrigger().getAttribute('aria-label')).toBe('Model: deepseek · reason');
    expect(screen.queryByText(/is not offered by this host/)).toBeNull();
  });
});

describe('the board default model form beside the other board forms', () => {
  it('writes the saved document, not the editor draft, and leaves the draft and the other forms alone', async () => {
    const h = harness();
    const user = userEvent.setup();
    const setWorkflowDraft = vi.fn();
    render(<BoardSettings
      state={h.state} hub={h.hub} board={h.value} run={h.run} api={h.api}
      workflowDraft={{ yaml: AUTHORED, revision: 7 }} setWorkflowDraft={setWorkflowDraft}
    />);
    const run = h.run;
    await user.type(screen.getByLabelText('Board name'), ' X');
    await chooseRoute(user, /Reason/);
    await chooseEffort(user, 'high');
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const command = run.mock.calls[0]![0] as Extract<Command, { type: 'board.workflow.save' }>;
    expect(command.yaml).toBe(writeBoardModelField(AUTHORED, route));
    expect(setWorkflowDraft).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Board name') as HTMLInputElement).value).toBe('Flow X');
  });

  it('refuses to save a model while the workflow editor holds a different document', async () => {
    const h = harness();
    const user = userEvent.setup();
    const setWorkflowDraft = vi.fn();
    render(<BoardSettings
      state={h.state} hub={h.hub} board={h.value} run={h.run} api={h.api}
      workflowDraft={{ yaml: DRAFTED, revision: 7 }} setWorkflowDraft={setWorkflowDraft}
    />);
    const run = h.run;
    await chooseRoute(user, /Reason/);
    expect(await screen.findByText(/Save or discard the workflow edits/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
    expect(setWorkflowDraft).not.toHaveBeenCalled();
  });
});
