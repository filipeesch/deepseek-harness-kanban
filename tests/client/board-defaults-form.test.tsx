// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { parse } from 'yaml';
import type { Board, ClientApi, HubState, KanbanSnapshot } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { writeBoardDefaultsField } from '../../src/domain/board-defaults-field.js';
import { BoardDefaultsPanel } from '../../src/client/settings/board/board-defaults-panel.js';

afterEach(cleanup);

const AUTHORED = '# The team flow\nname: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog # keep me\n  - id: done\n    label: Done\n';

function boardOf(stored: { mcp?: string[] } = {}): Board {
  const workflowYaml = writeBoardDefaultsField(AUTHORED, { model: undefined, preset: undefined, ...(stored.mcp === undefined ? {} : { mcp: { mode: 'selected', entries: stored.mcp } }) });
  return { id: 'b1', name: 'Flow', workflowYaml, workflow: parseWorkflow(workflowYaml), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function hubOf(board: Board): HubState {
  return { id: 'h1', name: 'My Hub', revision: 7, projects: [], boards: [board], tasks: [], notes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function harness(options: { stored?: { mcp?: string[] }; mcpServers?: string[] | null; workflowEditing?: boolean } = {}) {
  const board = boardOf(options.stored);
  const hub = hubOf(board);
  const run = vi.fn(async (_command: unknown) => ({}) as KanbanSnapshot);
  const api = {
    mcpServers: options.mcpServers === null ? vi.fn(async () => { throw new Error('servers offline'); }) : vi.fn(async () => options.mcpServers ?? ['atlassian', 'trino']),
  } as unknown as ClientApi;
  const onOpenWorkflow = vi.fn();
  const onDirtyChange = vi.fn();
  const user = userEvent.setup();
  render(<BoardDefaultsPanel
    hub={hub} board={board} run={run} api={api}
    yaml={board.workflowYaml} baseRevision={7}
    workflowEditing={options.workflowEditing === true}
    onOpenWorkflow={onOpenWorkflow} onDirtyChange={onDirtyChange}
  />);
  return { board, hub, run, api, onOpenWorkflow, onDirtyChange, user };
}
function saved(command: unknown): { model?: unknown; agent_preset?: unknown; mcp?: string[]; agents?: unknown } {
  return (parse((command as { yaml: string }).yaml) as { model?: unknown; agent_preset?: unknown; mcp?: string[]; agents?: unknown });
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save defaults' }) as HTMLButtonElement;
}

describe('the board defaults panel', () => {
  it('keeps the agents out of this surface', () => {
    harness();
    expect(screen.queryByRole('group', { name: 'Board agents' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Board MCP tool allowlist' })).toBeTruthy();
    expect(screen.getByText(/edited in the Agents tab/)).toBeTruthy();
  });

  it('blocks only the save while the workflow holds unsaved edits', async () => {
    const { user } = harness({ workflowEditing: true });
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.click(await screen.findByRole('checkbox', { name: /atlassian/ }));
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Save is unavailable while the Workflow sub-section holds unsaved edits/)).toBeTruthy();
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
    // The MCP field is the only thing this save writes: no agents migration.
    expect(saved(run.mock.calls[0]![0]).agents).toBeUndefined();
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
