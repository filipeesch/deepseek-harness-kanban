// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { parse } from 'yaml';
import type { Board, ClientApi, HubState, KanbanSnapshot, ModelCatalog, ModelSelection, WorkflowAgent } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeBoardModelField } from '../../src/domain/board-model-field.js';
import { writeBoardAgentPresetField } from '../../src/domain/board-agent-preset-field.js';
import { writeBoardAgentsField, writeStageAgentField } from '../../src/domain/board-agents-field.js';
import { BoardAgentsPanel } from '../../src/client/settings/board/board-agents-panel.js';
import { MODEL_SELECTION_SLOT, type NativeSeat } from '../../src/client/native-slot-host.js';
import { PresetProvider, presetPort } from './agent-preset-fixture.js';

afterEach(cleanup);

const AUTHORED = '# The team flow\nname: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog # keep me\n  - id: done\n    label: Done\n';
const catalog: ModelCatalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } }] }], failures: [] };

function modelSeat(): NativeSeat {
  const Stub = (props: Record<string, unknown>) => {
    const directory = props.directory as { getSnapshot(): { current: ModelSelection | null } };
    const current = directory.getSnapshot().current;
    const select = props.select as (value: unknown) => Promise<unknown>;
    return <div>
      <span data-testid="native-current">{current === null ? 'none' : current.provider + ' · ' + current.model}</span>
      <button type="button" onClick={() => void select({ provider: 'deepseek', model: 'chat' })}>Choose Chat</button>
      <button type="button" onClick={() => void select({ provider: 'deepseek', model: 'reason', reasoningEffort: 'low' })}>Choose Reason low</button>
    </div>;
  };
  const entry = { component: Stub, options: { id: 'model' }, locale: 'model', inject: () => ({}) } as unknown as StoredEntry;
  return {
    slots: { entriesOfSlot: key => key === MODEL_SELECTION_SLOT ? [entry] : [], subscribe: () => () => {} },
    locale: { bind: () => key => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} },
  };
}

function boardOf(options: { agents?: WorkflowAgent[]; legacyModel?: ModelSelection; legacyPreset?: string; stageAgent?: { stageId: string; agent: string } } = {}): Board {
  let text = AUTHORED;
  if (options.legacyModel !== undefined) text = writeBoardModelField(text, options.legacyModel);
  if (options.legacyPreset !== undefined) text = writeBoardAgentPresetField(text, options.legacyPreset);
  if (options.agents !== undefined) text = writeBoardAgentsField(text, options.agents);
  if (options.stageAgent !== undefined) text = writeStageAgentField(text, options.stageAgent.stageId, options.stageAgent.agent);
  return { id: 'b1', name: 'Flow', workflowYaml: text, workflow: parseWorkflow(text), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function hubOf(board: Board): HubState {
  return { id: 'h1', name: 'My Hub', revision: 7, projects: [], boards: [board], tasks: [], notes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function harness(options: Parameters<typeof boardOf>[0] & { workflowEditing?: boolean } = {}) {
  const board = boardOf(options);
  const hub = hubOf(board);
  const run = vi.fn(async (_command: unknown) => ({}) as KanbanSnapshot);
  const api = { modelCatalog: vi.fn(async () => catalog) } as unknown as ClientApi;
  const onDirtyChange = vi.fn();
  const user = userEvent.setup();
  render(<PresetProvider port={presetPort()}>
    <BoardAgentsPanel hub={hub} board={board} run={run} api={api}
      yaml={board.workflowYaml} baseRevision={7}
      workflowEditing={options.workflowEditing === true}
      onDirtyChange={onDirtyChange} seat={modelSeat()} />
  </PresetProvider>);
  return { board, hub, run, api, onDirtyChange, user };
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save agents' }) as HTMLButtonElement;
}
function list(): HTMLElement {
  return screen.getByRole('group', { name: 'Board agents' });
}
function valueOf(element: HTMLElement): string {
  return (element as HTMLInputElement | HTMLSelectElement).value;
}
function saved(command: unknown): { model?: unknown; agent_preset?: unknown; agents?: WorkflowAgent[] } {
  return parse((command as { yaml: string }).yaml) as { model?: unknown; agent_preset?: unknown; agents?: WorkflowAgent[] };
}

describe('the board agents tab', () => {
  it('starts with every row closed and names the model and the preset', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design', preset: 'standard' }] });
    const agents = list();
    expect(within(agents).queryByLabelText('Main agent name')).toBeNull();
    expect(within(agents).getByRole('button', { name: /^Main / }).textContent).toContain('Host default model');
    const designer = within(agents).getByRole('button', { name: /^UX Design / });
    expect(designer.textContent).toContain('Main agent’s model');
    expect(designer.textContent?.toLowerCase()).toContain('standard');
    expect(designer.getAttribute('aria-expanded')).toBe('false');
    await user.click(designer);
    expect(designer.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a row in the order name, identifier, model, preset and locks a stored identifier', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design', preset: 'standard' }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^UX Design / }));
    const name = within(agents).getByLabelText('Agent 1 name');
    const id = within(agents).getByLabelText('Agent 1 id');
    const model = within(agents).getByRole('radiogroup', { name: 'Agent 1 model mode' });
    const preset = within(agents).getByLabelText('Agent 1 preset');
    expect(name.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(id.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(model.compareDocumentPosition(preset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(valueOf(id)).toBe('designer');
    expect(id.getAttribute('readonly')).toBe('');
  });

  it('derives the identifier from the name for a new agent', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: 'Add agent' }));
    await user.type(within(agents).getByLabelText('Agent 1 name'), 'Data Analyst');
    expect(valueOf(within(agents).getByLabelText('Agent 1 id'))).toBe('data-analyst');
  });

  it('refuses to remove an agent a stage names and says which stage', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design' }], stageAgent: { stageId: 'backlog', agent: 'designer' } });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^UX Design / }));
    expect((within(agents).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(agents).getByText(/Used by Backlog/).textContent).toContain('Clear the stage');
  });

  it('saves the authored agents section with the main materialized and the root fields retired', async () => {
    const { user, run } = harness({
      legacyModel: { provider: 'deepseek', model: 'chat' },
      legacyPreset: 'ptc',
      agents: [{ id: 'designer', name: 'UX Design', preset: 'standard' }],
    });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^UX Design / }));
    await user.type(within(agents).getByLabelText('Agent 1 name'), ' 2');
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const command = run.mock.calls[0]![0] as { type: string; yaml: string; presetChoice?: unknown };
    expect(command.type).toBe('board.workflow.save');
    expect('presetChoice' in command).toBe(false);
    const doc = saved(command);
    expect(doc.agents).toEqual([
      { id: 'main', name: 'Main', preset: 'ptc', model: { provider: 'deepseek', model: 'chat' } },
      { id: 'designer', name: 'UX Design 2', preset: 'standard' },
    ]);
    expect(doc.model).toBeUndefined();
    expect(doc.agent_preset).toBeUndefined();
    expect(command.yaml).toContain('# keep me');
  });

  it('requires a route for a specific main model', async () => {
    const { user, run } = harness({ agents: [{ id: 'main', name: 'Main' }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^Main / }));
    await user.click(within(agents).getByRole('radio', { name: 'Specific model' }));
    expect(saveButton().disabled).toBe(true);
    await user.click(within(agents).getByRole('button', { name: 'Choose Chat' }));
    await user.type(within(agents).getByLabelText('Main agent name'), '!');
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).agents?.[0]).toMatchObject({ id: 'main', model: { provider: 'deepseek', model: 'chat' } });
  });

  it('presents a stored preset the roster no longer offers', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main', preset: 'retired-preset' }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^Main / }));
    const preset = within(agents).getByLabelText('Main agent preset') as HTMLSelectElement;
    expect(preset.value).toBe('retired-preset');
    expect(within(preset).getByRole('option', { name: /retired-preset/ })).toBeTruthy();
    expect(within(agents).getByText(/not in the host roster/)).toBeTruthy();
  });

  it('presents a stored specialist route in the native selector', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design', model: { provider: 'other', model: 'legacy' } }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^UX Design / }));
    expect(within(agents).getByTestId('native-current').textContent).toBe('other · legacy');
  });

  it('uses the native selector for a specialist route', async () => {
    const { user, run } = harness({ agents: [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design' }] });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: /^UX Design / }));
    // A specialist with no route inherits the main agent's model and shows no picker.
    expect(within(agents).queryByRole('button', { name: 'Choose Chat' })).toBeNull();
    expect(within(agents).getByRole('button', { name: /^UX Design / }).textContent).toContain('Main agent’s model');
    await user.click(within(agents).getByRole('radio', { name: 'Specific model' }));
    await user.click(within(agents).getByRole('button', { name: 'Choose Chat' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).agents?.[1]).toMatchObject({ id: 'designer', model: { provider: 'deepseek', model: 'chat' } });
  });

  it('keeps the controls available while the workflow is dirty and blocks only the save', async () => {
    const { user } = harness({ agents: [{ id: 'main', name: 'Main' }], workflowEditing: true });
    const agents = list();
    await user.click(within(agents).getByRole('button', { name: 'Add agent' }));
    await user.type(within(agents).getByLabelText('Agent 1 name'), 'Data');
    expect((within(agents).getByLabelText('Agent 1 name') as HTMLInputElement).disabled).toBe(false);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Save or discard the Workflow changes before saving the agents/)).toBeTruthy();
  });
});
