// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Configuration } from '../../src/client/settings/configuration.js';
import { boardView } from '../../src/client/hub-view.js';
import type { HubState, KanbanSettings } from '../../src/shared/types.js';
import { fixture, task } from './helpers.js';

afterEach(cleanup);

describe('Hub configuration', () => {
  it('uses Hub-level tasks to disable project deletion from another board', () => {
    const base = fixture().state.hubs[0]!;
    const boardA = { ...base.boards[0]!, id: 'board-a', name: 'Board A' };
    const boardB = { ...base.boards[0]!, id: 'board-b', name: 'Board B' };
    const project = { id: 'shared-project', name: 'Shared project', projectPath: '/repo/shared', gitRootPath: '/repo' };
    const otherTask = { ...task('other-task', 'Other board task', project.id, 'intake'), boardId: boardB.id };
    const hub: HubState = { ...base, boards: [boardA, boardB], tasks: [otherTask], projects: [project] };
    const settings: KanbanSettings = { revision: 0 };
    render(<Configuration state={boardView(hub, boardA, settings)} hub={hub} board={boardA} hubCount={1} settings={settings} settingsRevision={0} run={vi.fn()} initial="Projects" onClose={() => {}} />);
    const remove = screen.getByRole('button', { name: 'Delete project Shared project' });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(remove.getAttribute('title')).toMatch(/tasks in this project/);
  });
});
