import { createBoard, initialHubState } from '../../src/domain/hub-schema.js';
import type { HubState } from '../../src/shared/types.js';

const NOW = '2026-01-01T00:00:00.000Z';
export function flow(columns: string[] = ['backlog', 'plan', 'done']): string {
  return ['name: Flow', 'initial_column: ' + columns[0], 'columns:', ...columns.flatMap(column => ['  - id: ' + column, '    label: ' + column]), ''].join('\n');
}
/** One published board as a storage enumeration sees it. */
export interface PublishedBoardFixture { key: string; name: string; projectKeys?: string[] | null; rank?: string; workflow?: string }
export function hubWith(boards: Array<{ id: string; name: string; workflow?: string; tasks?: Array<{ columnId: string }> }>): HubState {
  const hub = initialHubState('hub', 'My Hub', NOW);
  hub.boards = boards.map(board => createBoard(board.id, board.name, NOW, board.workflow ?? flow()));
  let index = 0;
  hub.tasks = boards.flatMap(board => (board.tasks ?? []).map(task => ({
    id: 'task-' + (++index), boardId: board.id, projectId: 'project', title: 'Task ' + index, description: '', columnId: task.columnId, position: index,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW,
  })));
  hub.projects = [{ id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' }];
  return hub;
}

export function content(name: string, workflow: string): { name: string; workflow: string } { return { name, workflow }; }
