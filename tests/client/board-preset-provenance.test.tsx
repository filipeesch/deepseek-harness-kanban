// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createBoard, initialHubState } from '../../src/domain/hub-schema.js';
import { BoardDefaultsPanel } from '../../src/client/settings/board/board-defaults-panel.js';
import { PresetProvider } from './agent-preset-fixture.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';

afterEach(cleanup);
function setup(mode: 'operator' | 'legacy' = 'operator') {
  const board = createBoard('board', 'Board', '2026-01-01T00:00:00.000Z');
  if (mode === 'legacy') delete board.defaultPresetMode;
  const hub = initialHubState('hub', 'Hub', board.createdAt);
  hub.boards.push(board);
  const run = vi.fn(async (_command: unknown) => ({} as KanbanSnapshot));
  render(<PresetProvider><BoardDefaultsPanel hub={hub} board={board} run={run} yaml={board.workflowYaml} baseRevision={0} workflowEditing={false} onOpenWorkflow={() => {}} /></PresetProvider>);
  return { board, run, user: userEvent.setup() };
}

describe('default preset provenance in settings', () => {
  it('shows the implicit operator even when unavailable, and persists an explicit host choice', async () => {
    const { board, run, user } = setup();
    expect(screen.getByText(/Current origin: new-board operator default/)).toBeTruthy();
    expect((await screen.findByRole('radio', { name: /kanban-workflow-operator \(not available/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: /Host default preset/ }));
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]![0]).toMatchObject({ yaml: board.workflowYaml, presetChoice: 'host', expectedRevision: 0 });
  });
  it('writes an explicit named choice without altering unrelated text', async () => {
    const { board, run, user } = setup();
    await user.click(await screen.findByRole('radio', { name: /PTC/ }));
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    const command = run.mock.calls[0]![0] as { yaml: string; presetChoice: string };
    expect(command.presetChoice).toBe('named');
    expect(command.yaml).toContain('agent_preset: ptc');
    expect(command.yaml).toContain(board.workflowYaml.trim());
  });
  it('keeps an implicit choice outside YAML when saving another setting', async () => {
    const { run, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Selected servers' }));
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    const command = run.mock.calls[0]![0] as { yaml: string; presetChoice?: string };
    expect(command.presetChoice).toBeUndefined();
    expect(command.yaml).not.toContain('agent_preset');
  });
  it('can explicitly confirm host on a legacy board', async () => {
    const { run, user } = setup('legacy');
    expect(screen.getByText(/Current origin: legacy host default/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Host default preset/ }));
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]![0]).toMatchObject({ presetChoice: 'host' });
  });
});
