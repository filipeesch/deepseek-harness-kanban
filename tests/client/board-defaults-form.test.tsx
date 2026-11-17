// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { parse } from 'yaml';
import type { Board, ClientApi, HubState, KanbanSnapshot, ModelCatalog, ModelSelection } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeBoardDefaultsField } from '../../src/domain/board-defaults-field.js';
import { BoardDefaultsPanel } from '../../src/client/settings/board/board-defaults-panel.js';
import { MODEL_SELECTION_SLOT, type NativeSeat } from '../../src/client/native-slot-host.js';
import { PresetProvider, PRESET_OPTIONS, presetPort } from './agent-preset-fixture.js';

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

function boardOf(stored: { model?: ModelSelection; preset?: string; mcp?: string[]; mode?: 'operator' | 'host' } = {}): Board {
  const workflowYaml = writeBoardDefaultsField(AUTHORED, { model: stored.model, preset: stored.preset, ...(stored.mcp === undefined ? {} : { mcp: { mode: 'selected', entries: stored.mcp } }) });
  const workflow = parseWorkflow(workflowYaml);
  return { id: 'b1', name: 'Flow', workflowYaml, workflow, ...(stored.mode === undefined ? {} : { defaultPresetMode: stored.mode }), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function hubOf(board: Board): HubState {
  return { id: 'h1', name: 'My Hub', revision: 7, projects: [], boards: [board], tasks: [], notes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function harness(options: { stored?: { model?: ModelSelection; preset?: string; mcp?: string[]; mode?: 'operator' | 'host' }; catalog?: ModelCatalog | null; yaml?: string; workflowEditing?: boolean; seat?: NativeSeat | null; preset?: ReturnType<typeof presetPort>; mcpServers?: string[] | null } = {}) {
  const board = boardOf(options.stored);
  const hub = hubOf(board);
  const run = vi.fn(async (_command: unknown) => ({}) as KanbanSnapshot);
  const api = {
    modelCatalog: options.catalog === null ? vi.fn(async () => { throw new Error('catalog offline'); }) : vi.fn(async () => options.catalog ?? catalog),
    mcpServers: options.mcpServers === null ? vi.fn(async () => { throw new Error('servers offline'); }) : vi.fn(async () => options.mcpServers ?? ['atlassian', 'trino']),
  } as unknown as ClientApi;
  const onOpenWorkflow = vi.fn();
  const onDirtyChange = vi.fn();
  const port = options.preset ?? presetPort();
  const user = userEvent.setup();
  const seat = options.seat === null ? undefined : options.seat ?? modelSeat();
  const view = render(<PresetProvider port={port}>
    <BoardDefaultsPanel
      hub={hub} board={board} run={run} api={api}
      yaml={options.yaml ?? board.workflowYaml} baseRevision={7}
      workflowEditing={options.workflowEditing === true}
      onOpenWorkflow={onOpenWorkflow} onDirtyChange={onDirtyChange}
      {...(seat === undefined ? {} : { seat })}
    />
  </PresetProvider>);
  return { ...view, board, hub, run, api, port, onOpenWorkflow, onDirtyChange, user };
}

function saved(command: unknown): { model?: ModelSelection; agent_preset?: string; mcp?: string[] } {
  return (parse((command as { yaml: string }).yaml) as { model?: ModelSelection; agent_preset?: string; mcp?: string[] });
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save defaults' }) as HTMLButtonElement;
}

describe('the board defaults panel', () => {
  it('can explicitly select the current implicit operator', async () => {
    const operator = { id: 'kanban-workflow-operator', name: 'Workflow Operator' };
    const port = presetPort({ list: async () => [...PRESET_OPTIONS, operator] });
    const { user, run } = harness({ stored: { mode: 'operator' }, preset: port });
    expect(screen.getByText(/Current origin: new-board operator default/)).toBeTruthy();
    const radio = await screen.findByRole('radio', { name: /Workflow Operator/ });
    expect((radio as HTMLInputElement).checked).toBe(true);
    await user.click(radio);
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({ presetChoice: 'named' });
    expect(saved(run.mock.calls[0]![0]).agent_preset).toBe(operator.id);
    expect((run.mock.calls[0]![0] as { yaml: string }).yaml).toContain('label: Backlog # keep me');
  });

  it('can explicitly select the legacy host default', async () => {
    const { user, run } = harness();
    expect(screen.getByText(/Current origin: legacy host default/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Host default preset/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({ presetChoice: 'host', yaml: AUTHORED });
  });

  it('reverting an implicit operator draft keeps the original provenance on another edit', async () => {
    const operator = { id: 'kanban-workflow-operator', name: 'Workflow Operator' };
    const { user, run } = harness({ stored: { mode: 'operator' }, preset: presetPort({ list: async () => [...PRESET_OPTIONS, operator] }) });
    await user.click(await screen.findByRole('radio', { name: /PTC/ }));
    await user.click(screen.getByRole('radio', { name: /Workflow Operator/ }));
    expect(saveButton().disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    await user.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).not.toHaveProperty('presetChoice');
    expect(saved(run.mock.calls[0]![0]).agent_preset).toBeUndefined();
  });

  it('reverting a legacy host draft keeps the legacy provenance on another edit', async () => {
    const { user, run } = harness();
    await user.click(await screen.findByRole('radio', { name: /PTC/ }));
    await user.click(screen.getByRole('radio', { name: /Host default preset/ }));
    expect(saveButton().disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    await user.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).not.toHaveProperty('presetChoice');
    expect(saved(run.mock.calls[0]![0]).agent_preset).toBeUndefined();
  });

  it('preserves an unavailable authored preset byte-for-byte on model-only edits', async () => {
    const text = "agent_preset: 'retired' # preserve preset\n" + AUTHORED;
    const { user, run } = harness({ stored: { preset: 'retired' }, yaml: text });
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    await user.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0]![0] as { yaml: string }).yaml).toContain("agent_preset: 'retired' # preserve preset");
    expect(run.mock.calls[0]![0]).not.toHaveProperty('presetChoice');
  });
  it('saves the model and the preset in one guarded workflow write', async () => {
    const { user, run } = harness();
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    await user.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await user.click(await screen.findByRole('radio', { name: /PTC/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const command = run.mock.calls[0]![0];
    expect(command).toMatchObject({ type: 'board.workflow.save', hubId: 'h1', boardId: 'b1', expectedRevision: 7 });
    expect(saved(command)).toMatchObject({ model: { provider: 'deepseek', model: 'chat' }, agent_preset: 'ptc' });
    expect((command as { yaml: string }).yaml).toContain('# The team flow');
    expect((command as { yaml: string }).yaml).toContain('label: Backlog # keep me');
    expect(await screen.findByText('Defaults saved.')).toBeTruthy();
  });

  it('keeps the native selector in place while the mode changes', async () => {
    const { user } = harness();
    // Always create renders the selector; the stored default is the host mode here.
    expect(screen.getByRole('radio', { name: 'Host default' }).getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByTestId('native-current')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    expect(screen.getByTestId('native-current')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Choose Chat' }));
    expect(screen.getByTestId('native-current').textContent).toBe('deepseek · chat');
    await user.click(screen.getByRole('radio', { name: 'Host default' }));
    expect(screen.getByTestId('native-current').textContent).toBe('deepseek · chat');
  });

  it('keeps the host defaults by removing both root fields', async () => {
    const { user, run } = harness({ stored: { model: { provider: 'deepseek', model: 'reason' }, preset: 'standard' } });
    await user.click(screen.getByRole('radio', { name: 'Host default' }));
    await user.click(screen.getByRole('radio', { name: /Host default preset/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).model).toBeUndefined();
    expect(saved(run.mock.calls[0]![0]).agent_preset).toBeUndefined();
    expect((run.mock.calls[0]![0] as { yaml: string }).yaml).not.toContain('model:');
    expect((run.mock.calls[0]![0] as { yaml: string }).yaml).not.toContain('agent_preset');
  });

  it('keeps the other field when only one is edited', async () => {
    const { user, run } = harness({ stored: { model: { provider: 'deepseek', model: 'chat' }, preset: 'standard' } });
    await user.click(await screen.findByRole('radio', { name: /PTC/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0])).toMatchObject({ model: { provider: 'deepseek', model: 'chat' }, agent_preset: 'ptc' });
  });

  it('offers nothing to save while the choices match the stored defaults', async () => {
    harness({ stored: { model: { provider: 'deepseek', model: 'chat' }, preset: 'standard' } });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('No changes to save.')).toBeTruthy();
  });

  it('requires a route for a specific model choice', async () => {
    const { user, run } = harness();
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    expect(screen.getByText(/Choose a model or switch to the host default/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses to write a document the parser rejects and keeps the choice on screen', async () => {
    const { user, run } = harness({ yaml: 'name: Broken\n' });
    await user.click(screen.getByRole('radio', { name: 'Specific model' }));
    await user.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the controls available while the workflow is dirty and blocks only the save', async () => {
    const { user, run, onOpenWorkflow } = harness({ stored: { model: { provider: 'deepseek', model: 'chat' } }, workflowEditing: true });
    const preset = await screen.findByRole('radio', { name: /PTC/ }) as HTMLInputElement;
    expect(preset.disabled).toBe(false);
    await user.click(preset);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Save is unavailable while the Workflow sub-section holds unsaved edits/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open Workflow' }));
    expect(onOpenWorkflow).toHaveBeenCalledOnce();
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
  });

  it('presents a stored model the host no longer offers without removing it', async () => {
    harness({ stored: { model: { provider: 'anthropic', model: 'claude' } } });
    expect(await screen.findByText(/is not offered by this host/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('presents a stored preset the roster no longer offers and keeps it', async () => {
    const { run } = harness({ stored: { preset: 'retired' } });
    const row = await screen.findByRole('radio', { name: /retired \(not available on this host\)/ });
    expect((row as HTMLInputElement).checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a roster failure with retry and keeps the stored preset', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('roster offline')).mockResolvedValueOnce(PRESET_OPTIONS);
    const { user } = harness({ stored: { preset: 'standard' }, preset: presetPort({ list }) });
    expect(await screen.findByText(/The agent-preset roster is unavailable: roster offline/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry presets' }));
    expect(await screen.findByRole('radio', { name: /PTC/ })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Host default preset/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('presents the stored route read-only when the selector is unavailable', async () => {
    const { user, run } = harness({ stored: { model: { provider: 'deepseek', model: 'reason' }, preset: 'standard' }, seat: null });
    expect(await screen.findByText(/The native model selector is unavailable/)).toBeTruthy();
    expect(screen.getByText(/deepseek · reason/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /PTC/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0])).toMatchObject({ model: { provider: 'deepseek', model: 'reason' }, agent_preset: 'ptc' });
  });

  it('reports an unreadable catalog with a retry action', async () => {
    const { api } = harness({ stored: { model: { provider: 'deepseek', model: 'chat' } }, catalog: null });
    expect(await screen.findByText(/The model catalog is unavailable: catalog offline/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry models' })).toBeTruthy();
    expect(api.modelCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('the board MCP allowlist control', () => {
  it('keeps every server by removing the field', async () => {
    const { user, run } = harness({ stored: { mcp: ['atlassian'] } });
    await user.click(screen.getByRole('radio', { name: 'Every server' }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toBeUndefined();
    expect((run.mock.calls[0]![0] as { yaml: string }).yaml).not.toContain('mcp');
  });

  it('saves a selected server as its own entry', async () => {
    const { user, run } = harness();
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.click(await screen.findByRole('checkbox', { name: /atlassian/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual(['atlassian']);
  });

  it('saves an explicit selection with nothing selected as an empty list', async () => {
    const { user, run } = harness();
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    expect(await screen.findByText(/No server is allowed/)).toBeTruthy();
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual([]);
  });

  it('accepts a server/tool entry typed by the person', async () => {
    const { user, run } = harness();
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.type(screen.getByLabelText('Add MCP server or tool'), 'atlassian/search{Enter}');
    expect(await screen.findByText('atlassian/search')).toBeTruthy();
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual(['atlassian/search']);
  });

  it('refuses a typed entry the parser would reject', async () => {
    const { user } = harness();
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.type(screen.getByLabelText('Add MCP server or tool'), 'a/b/c');
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(await screen.findByText(/Enter a server name/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove a/b/c' })).toBeNull();
  });

  it('keeps a server with only some tools allowed unchecked and names the tools', async () => {
    const { user } = harness({ stored: { mcp: ['trino/query'] } });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    const row = await screen.findByRole('checkbox', { name: /trino/ });
    expect((row as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('1 tool selected')).toBeTruthy();
  });

  it('replaces single-tool entries with the whole server when the server is checked', async () => {
    const { user, run } = harness({ stored: { mcp: ['trino/query'] } });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.click(await screen.findByRole('checkbox', { name: /trino/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual(['trino']);
  });

  it('presents a stored entry the host does not report and keeps it', async () => {
    const { user, run } = harness({ stored: { mcp: ['retired-server'] }, mcpServers: ['atlassian'] });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    const row = await screen.findByRole('checkbox', { name: /retired-server/ });
    expect((row as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Not reported by this host/)).toBeTruthy();
    await user.click(await screen.findByRole('checkbox', { name: /atlassian/ }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual(['retired-server', 'atlassian']);
  });

  it('reports an unreadable server list with a retry and keeps the stored entries', async () => {
    const { user, run } = harness({ stored: { mcp: ['atlassian'] }, mcpServers: null });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    expect(await screen.findByText(/The MCP server list is unavailable: servers offline/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry servers' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /atlassian/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(saveButton());
    expect(run).not.toHaveBeenCalled();
  });

  it('removes one entry without disturbing the others', async () => {
    const { user, run } = harness({ stored: { mcp: ['atlassian', 'trino/query'] } });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.click(await screen.findByRole('button', { name: 'Remove trino/query' }));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(saved(run.mock.calls[0]![0]).mcp).toEqual(['atlassian']);
  });
});
