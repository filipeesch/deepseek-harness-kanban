// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { parse } from 'yaml';
import type { Board, ClientApi, HubState, KanbanSnapshot, ModelCatalog, ModelSelection } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
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

function boardOf(stored: { model?: ModelSelection; preset?: string } = {}): Board {
  const workflow = { ...parseWorkflow(AUTHORED), ...(stored.model === undefined ? {} : { model: stored.model }), ...(stored.preset === undefined ? {} : { agentPreset: stored.preset }) };
  return { id: 'b1', name: 'Flow', workflowYaml: AUTHORED, workflow, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function hubOf(board: Board): HubState {
  return { id: 'h1', name: 'My Hub', revision: 7, projects: [], boards: [board], tasks: [], notes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function harness(options: { stored?: { model?: ModelSelection; preset?: string }; catalog?: ModelCatalog | null; yaml?: string; workflowEditing?: boolean; seat?: NativeSeat | null; preset?: ReturnType<typeof presetPort> } = {}) {
  const board = boardOf(options.stored);
  const hub = hubOf(board);
  const run = vi.fn(async (_command: unknown) => ({}) as KanbanSnapshot);
  const api = {
    modelCatalog: options.catalog === null ? vi.fn(async () => { throw new Error('catalog offline'); }) : vi.fn(async () => options.catalog ?? catalog),
  } as unknown as ClientApi;
  const onOpenWorkflow = vi.fn();
  const onDirtyChange = vi.fn();
  const port = options.preset ?? presetPort();
  const user = userEvent.setup();
  const seat = options.seat === null ? undefined : options.seat ?? modelSeat();
  const view = render(<PresetProvider port={port}>
    <BoardDefaultsPanel
      hub={hub} board={board} run={run} api={api}
      yaml={options.yaml ?? AUTHORED} baseRevision={7}
      workflowEditing={options.workflowEditing === true}
      onOpenWorkflow={onOpenWorkflow} onDirtyChange={onDirtyChange}
      {...(seat === undefined ? {} : { seat })}
    />
  </PresetProvider>);
  return { ...view, board, hub, run, api, port, onOpenWorkflow, onDirtyChange, user };
}

function saved(command: unknown): { model?: ModelSelection; agent_preset?: string } {
  return (parse((command as { yaml: string }).yaml) as { model?: ModelSelection; agent_preset?: string });
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save defaults' }) as HTMLButtonElement;
}

describe('the board defaults panel', () => {
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

  it('keeps the host defaults by removing both root fields', async () => {
    const { user, run } = harness({ stored: { model: { provider: 'deepseek', model: 'reason' }, preset: 'standard' } });
    await user.click(screen.getByRole('radio', { name: 'Host default model' }));
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
