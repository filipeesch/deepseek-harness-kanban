import type { Board, BoardSettings, BoardState, HubState, KanbanSnapshot } from '../shared/types.js';

export function boardView(hub: HubState, board: Board, settings: KanbanSnapshot['state']['settings']): BoardState {
  const tasks = hub.tasks.filter(task => task.boardId === board.id);
  const taskIds = new Set(tasks.map(task => task.id));
  const viewSettings: BoardSettings = settings.worktreeBasePath ? { worktreeBasePath: settings.worktreeBasePath } : {};
  return { schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks, notes: hub.notes.filter(note => taskIds.has(note.taskId)), settings: viewSettings };
}
export function hubProjectView(hub: HubState): BoardState {
  return { schemaVersion: 2, revision: hub.revision, workflowYaml: '', workflow: { name: 'Workflow', initialColumnId: '', columns: [], groups: [] }, projects: hub.projects, tasks: hub.tasks, notes: hub.notes, settings: {} };
}
