import type { Board, BoardRelation, BoardSettings, BoardState, HubRelation, HubState, HubTask, KanbanSnapshot } from '../shared/types.js';

/** One endpoint as the drawer reads it: the title, the stage name, and the board it lives on. */
interface RelationEndpoint {
  title?: string; stageName?: string; boardId?: string; boardName?: string;
}

function endpointView(hub: HubState, taskId: string): RelationEndpoint {
  const task: HubTask | undefined = hub.tasks.find(value => value.id === taskId);
  if (task === undefined) return {};
  const board: Board | undefined = hub.boards.find(value => value.id === task.boardId);
  const column = board?.workflow.columns.find(value => value.id === task.columnId);
  return {
    title: task.title,
    // The stage of another board must read with that board's own column name; a raw
    // identifier here would leak the repository into the interface.
    stageName: column?.name ?? task.columnId,
    boardId: task.boardId,
    ...(board === undefined ? {} : { boardName: board.name }),
  };
}

/** One relation with both endpoints resolved from the Hub, so the drawer never needs another board. */
function relationView(hub: HubState, relation: HubRelation): BoardRelation {
  const from = endpointView(hub, relation.from);
  const to = endpointView(hub, relation.to);
  return {
    id: relation.id, type: relation.type, from: relation.from, to: relation.to,
    ...(from.title === undefined ? {} : { fromTitle: from.title }),
    ...(from.stageName === undefined ? {} : { fromStageName: from.stageName }),
    ...(from.boardId === undefined ? {} : { fromBoardId: from.boardId }),
    ...(from.boardName === undefined ? {} : { fromBoardName: from.boardName }),
    ...(to.title === undefined ? {} : { toTitle: to.title }),
    ...(to.stageName === undefined ? {} : { toStageName: to.stageName }),
    ...(to.boardId === undefined ? {} : { toBoardId: to.boardId }),
    ...(to.boardName === undefined ? {} : { toBoardName: to.boardName }),
  };
}

export function boardView(hub: HubState, board: Board, settings: KanbanSnapshot['state']['settings']): BoardState {
  const tasks = hub.tasks.filter(task => task.boardId === board.id);
  const taskIds = new Set(tasks.map(task => task.id));
  const viewSettings: BoardSettings = settings.worktreeBasePath ? { worktreeBasePath: settings.worktreeBasePath } : {};
  const relations = (hub.relations ?? []).filter(relation => taskIds.has(relation.from) || taskIds.has(relation.to)).map(relation => relationView(hub, relation));
  return { boardId: board.id, schemaVersion: 2, revision: hub.revision, workflowYaml: board.workflowYaml, workflow: board.workflow, projects: hub.projects, tasks, notes: hub.notes.filter(note => taskIds.has(note.taskId)), relations, settings: viewSettings };
}
export function hubProjectView(hub: HubState): BoardState {
  const relations = (hub.relations ?? []).map(relation => relationView(hub, relation));
  return { schemaVersion: 2, revision: hub.revision, workflowYaml: '', workflow: { name: 'Workflow', initialColumnId: '', columns: [], groups: [] }, projects: hub.projects, tasks: hub.tasks, notes: hub.notes, relations, settings: {} };
}
