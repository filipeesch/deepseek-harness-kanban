import type { Board, BoardSettings, BoardState, Command, HubState, KanbanSnapshot, Task, Workflow } from '../shared/types.js';

export const ACTIVE_HUB_KEY = 'dsh.kanban.activeHub';
export const ACTIVE_BOARDS_KEY = 'dsh.kanban.activeBoards';
export function readStorage(key: string): string | null { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
export function writeStorage(key: string, value: string | null): void { try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); } catch { /* preferences are best effort */ } }
export function readBoardPreferences(): Record<string, string> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ACTIVE_BOARDS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {};
  } catch { return {}; }
}
export function writeBoardPreference(hubId: string, boardId: string, previous: Record<string, string>): Record<string, string> {
  const next = { ...previous, [hubId]: boardId };
  writeStorage(ACTIVE_BOARDS_KEY, JSON.stringify(next));
  return next;
}
export function allTasks(snapshot: KanbanSnapshot): Task[] { return snapshot.state.hubs.flatMap(hub => hub.tasks); }
export function boardView(hub: HubState, board: Board, settings: KanbanSnapshot['state']['settings']): BoardState {
  const tasks = hub.tasks.filter(task => task.boardId === board.id);
  const taskIds = new Set(tasks.map(task => task.id));
  const viewSettings: BoardSettings = settings.worktreeBasePath ? { worktreeBasePath: settings.worktreeBasePath } : {};
  return { schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks, notes: hub.notes.filter(note => taskIds.has(note.taskId)), settings: viewSettings };
}
export function hubProjectView(hub: HubState): BoardState {
  return { schemaVersion: 2, revision: hub.revision, workflowYaml: '', workflow: { name: 'Workflow', initialColumnId: '', columns: [], groups: [] }, projects: hub.projects, tasks: hub.tasks, notes: hub.notes, settings: {} };
}
export function normalizeSnapshot(snapshot: KanbanSnapshot): KanbanSnapshot {
  const legacy = snapshot.state as unknown as Record<string, unknown>;
  const hasLegacy = ['tasks', 'projects', 'notes', 'workflow', 'workflowYaml', 'revision'].some(key => Object.prototype.hasOwnProperty.call(legacy, key));
  if (!hasLegacy) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      settings: snapshot.state.settings ?? { revision: 0 },
      hubs: snapshot.state.hubs.map((hub, index) => index !== 0 ? hub : {
        ...hub,
        ...(Array.isArray(legacy.tasks) ? { tasks: legacy.tasks as HubState['tasks'] } : {}),
        ...(Array.isArray(legacy.projects) ? { projects: legacy.projects as HubState['projects'] } : {}),
        ...(Array.isArray(legacy.notes) ? { notes: legacy.notes as HubState['notes'] } : {}),
        ...(typeof legacy.revision === 'number' ? { revision: legacy.revision } : {}),
        boards: hub.boards.map((board, boardIndex) => boardIndex !== 0 ? board : {
          ...board,
          ...(typeof legacy.workflowYaml === 'string' ? { workflowYaml: legacy.workflowYaml } : {}),
          ...(legacy.workflow && typeof legacy.workflow === 'object' ? { workflow: legacy.workflow as Workflow } : {}),
        }),
      }),
    },
  };
}
export function scopedCommand(command: Command, hubId: string | undefined, boardId: string | undefined, multiHub: boolean, multiBoard: boolean): Command {
  // The timed/manual instruction is task-scoped; the host resolves its Hub by task id.
  if (command.type === 'task.runInstruction') return command;
  if (command.type === 'workflow.save') return (multiHub || multiBoard) && boardId && hubId ? { type: 'board.workflow.save', hubId, boardId, yaml: command.yaml, ...(command.expectedRevision !== undefined ? { expectedRevision: command.expectedRevision } : {}) } : command;
  if (command.type === 'settings.save' || command.type === 'hub.create' || command.type === 'hub.rename' || command.type === 'hub.delete' || command.type.startsWith('board.')) return command;
  if (command.type === 'task.create') return { ...command, ...(multiHub && hubId ? { hubId } : {}), ...(multiBoard && boardId ? { boardId } : {}) };
  return multiHub && hubId ? { ...command, hubId } : command;
}
