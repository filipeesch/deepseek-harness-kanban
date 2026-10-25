import { KanbanError, invariant } from '../shared/errors.js';
import type { Board, BoardSettings, HubState, HubTask, Note, Project, ProjectInput, Workflow } from '../shared/types.js';
import { assertId, isAbsolutePath } from './validation.js';
import { createBoard } from './hub-schema.js';
import { parseWorkflow } from './workflow.js';

export interface NoteInput { id?: string; content: string; tags?: string[] }
export interface TaskTextPatch { title?: string; description?: string }
export interface OperationDeps { id: () => string; now: () => string }

function clone<T>(value: T): T {
  try { return structuredClone(value); }
  catch { throw new KanbanError('INVALID_INPUT', 'Domain values must be structured-cloneable.'); }
}

function requiredText(value: unknown, label: string): string {
  invariant(typeof value === 'string' && value.trim().length > 0, 'INVALID_INPUT', label + ' must be nonempty text.');
  return value;
}

function nextId(values: { id: string }[], id: () => string): string {
  const existing = new Set(values.map(value => value.id));
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = id();
    if (!existing.has(candidate)) return candidate;
  }
  throw new KanbanError('ID_COLLISION', 'Could not allocate a unique identifier.');
}

function timestamp(deps: OperationDeps): string { return deps.now(); }

function normalizedName(value: unknown, label: string): string {
  return requiredText(value, label).trim();
}

function nameKey(value: string): string { return value.trim().toLocaleLowerCase(); }

export function requireBoard(hub: HubState, boardId: string): Board {
  assertId(boardId, 'Board ID');
  const board = hub.boards.find(value => value.id === boardId);
  invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist in this Hub.');
  return board;
}

export function requireTask(hub: HubState, taskId: string): HubTask {
  assertId(taskId, 'Task ID');
  const task = hub.tasks.find(value => value.id === taskId);
  invariant(task, 'TASK_NOT_FOUND', 'Task does not exist.');
  return task;
}

export function requireProject(hub: HubState, projectId: string): Project {
  assertId(projectId, 'Project ID');
  const project = hub.projects.find(value => value.id === projectId);
  invariant(project, 'PROJECT_NOT_FOUND', 'Project does not exist.');
  return project;
}

export function boardForTask(hub: HubState, task: HubTask): Board { return requireBoard(hub, task.boardId); }

export function renameHub(hub: HubState, name: string, deps: OperationDeps): string {
  hub.name = normalizedName(name, 'Hub name');
  hub.updatedAt = timestamp(deps);
  return hub.name;
}

export function addBoard(hub: HubState, name: string, deps: OperationDeps): Board {
  const value = normalizedName(name, 'Board name');
  const key = nameKey(value);
  invariant(!hub.boards.some(board => nameKey(board.name) === key), 'BOARD_NAME_CONFLICT', 'A board with this name already exists in the Hub.');
  const board = createBoard(nextId(hub.boards, deps.id), value, timestamp(deps));
  hub.boards.push(board);
  hub.updatedAt = timestamp(deps);
  return board;
}

export function renameBoard(hub: HubState, boardId: string, name: string, deps: OperationDeps): Board {
  const board = requireBoard(hub, boardId);
  const value = normalizedName(name, 'Board name');
  const key = nameKey(value);
  invariant(!hub.boards.some(candidate => candidate.id !== board.id && nameKey(candidate.name) === key), 'BOARD_NAME_CONFLICT', 'A board with this name already exists in the Hub.');
  board.name = value;
  board.updatedAt = timestamp(deps);
  hub.updatedAt = timestamp(deps);
  return board;
}

export function deleteBoard(hub: HubState, boardId: string, deps: OperationDeps): Board {
  const board = requireBoard(hub, boardId);
  const tasks = hub.tasks.filter(task => task.boardId === board.id);
  invariant(tasks.length === 0, 'BOARD_IN_USE', 'Delete or move the tasks in this board before deleting it.');
  hub.boards.splice(hub.boards.indexOf(board), 1);
  hub.updatedAt = timestamp(deps);
  return board;
}

export function saveBoardWorkflow(hub: HubState, boardId: string, yaml: string, deps: OperationDeps): Workflow {
  const board = requireBoard(hub, boardId);
  const workflow = parseWorkflow(yaml);
  const ids = new Set(workflow.columns.map(column => column.id));
  const referenced = hub.tasks.filter(task => task.boardId === board.id).flatMap(task =>
    task.pendingTransition ? [task.columnId, task.pendingTransition.fromColumnId, task.pendingTransition.columnId] : [task.columnId]);
  const orphaned = [...new Set(referenced.filter(columnId => !ids.has(columnId)))];
  invariant(orphaned.length === 0, 'WORKFLOW_ORPHAN_COLUMNS', 'Workflow update would orphan existing task columns: ' + orphaned.join(', ') + '.');
  board.workflowYaml = yaml;
  board.workflow = workflow;
  board.updatedAt = timestamp(deps);
  hub.updatedAt = timestamp(deps);
  return workflow;
}

export function saveProject(hub: HubState, input: ProjectInput, deps: OperationDeps): Project {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Project input must be a mapping.');
  requiredText(value.name, 'Project name');
  if (value.id !== undefined) assertId(value.id, 'Project ID');
  const projectId = value.id ?? nextId(hub.projects, deps.id);
  const current = hub.projects.find(project => project.id === projectId);
  if (current && (current.projectPath !== value.projectPath || current.gitRootPath !== value.gitRootPath)) {
    invariant(!hub.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Project paths cannot change while tasks reference the project.');
  }
  const project: Project = {
    id: projectId, name: value.name.trim(), projectPath: value.projectPath, gitRootPath: value.gitRootPath,
    ...(current?.workspaceId ? { workspaceId: current.workspaceId } : {}),
    ...(current?.workspaceOwned !== undefined ? { workspaceOwned: current.workspaceOwned } : {}),
  };
  if (value.defaultBranch !== undefined) {
    invariant(typeof value.defaultBranch === 'string', 'INVALID_INPUT', 'Default branch must be text.');
    if (value.defaultBranch.trim()) project.defaultBranch = value.defaultBranch.trim();
  }
  if (current) hub.projects[hub.projects.indexOf(current)] = project;
  else hub.projects.push(project);
  hub.updatedAt = timestamp(deps);
  return project;
}

export function deleteProject(hub: HubState, projectId: string, deps: OperationDeps): Project {
  const project = requireProject(hub, projectId);
  invariant(!hub.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Delete the tasks in this project before deleting the project.');
  hub.projects.splice(hub.projects.indexOf(project), 1);
  hub.updatedAt = timestamp(deps);
  return project;
}

export function setProjectWorkspace(hub: HubState, projectId: string, workspaceId: string, owned: boolean, deps: OperationDeps): Project {
  assertId(workspaceId, 'Workspace ID');
  const project = requireProject(hub, projectId);
  project.workspaceId = workspaceId;
  project.workspaceOwned = owned;
  hub.updatedAt = timestamp(deps);
  return project;
}

export function setTaskWorktreeWorkspace(hub: HubState, taskId: string, workspaceId: string, owned: boolean, deps: OperationDeps): HubTask {
  assertId(workspaceId, 'Workspace ID');
  const task = requireTask(hub, taskId);
  task.worktreeWorkspaceId = workspaceId;
  task.worktreeWorkspaceOwned = owned;
  task.updatedAt = timestamp(deps);
  return task;
}

function assertAvailableSession(hub: HubState, sessionId: string): void {
  invariant(!hub.tasks.some(task => task.sessionIds.includes(sessionId)), 'SESSION_IN_USE', 'Native session is already associated with a task.');
}

export function createTask(hub: HubState, input: { boardId: string; projectId: string; title: string; description: string }, sessionId: string, deps: OperationDeps): HubTask {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'New task input must be a mapping.');
  assertId(sessionId, 'Session ID');
  requiredText(value.title, 'Task title');
  invariant(typeof value.description === 'string', 'INVALID_INPUT', 'Task description must be text.');
  const board = requireBoard(hub, value.boardId);
  const project = requireProject(hub, value.projectId);
  assertAvailableSession(hub, sessionId);
  const peers = hub.tasks.filter(task => task.boardId === board.id && task.columnId === board.workflow.initialColumnId);
  let position = peers.length ? peers.reduce((minimum, task) => Math.min(minimum, task.position), Infinity) - 1 : 0;
  if (!Number.isFinite(position) || peers.some(task => task.position === position)) {
    peers.sort((left, right) => left.position - right.position).forEach((task, index) => { task.position = index; });
    position = -1;
  }
  const at = timestamp(deps);
  const initialColumn = board.workflow.columns.find(column => column.id === board.workflow.initialColumnId);
  const task: HubTask = {
    id: nextId(hub.tasks, deps.id), boardId: board.id, projectId: project.id, title: value.title.trim(), description: value.description,
    columnId: board.workflow.initialColumnId, position, sessionIds: [sessionId], closedSessionIds: [], effectiveCwd: project.projectPath,
    worktree: null, operation: null,
    ...(initialColumn?.onEnterPrompt?.trim() ? { instructionPending: { columnId: initialColumn.id, enteredAt: Date.parse(at) } } : {}),
    createdAt: at, updatedAt: at,
  };
  hub.tasks.push(task);
  hub.updatedAt = at;
  return task;
}

export function editTask(hub: HubState, taskId: string, patch: TaskTextPatch, deps: OperationDeps): HubTask {
  const value = clone(patch);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Task edits must be a mapping.');
  invariant(Object.keys(value).every(key => key === 'title' || key === 'description'), 'INVALID_INPUT', 'Only task title and description can be edited here.');
  invariant(value.title !== undefined || value.description !== undefined, 'INVALID_INPUT', 'Provide a task title or description to edit.');
  if (value.title !== undefined) requiredText(value.title, 'Task title');
  if (value.description !== undefined) invariant(typeof value.description === 'string', 'INVALID_INPUT', 'Task description must be text.');
  const task = requireTask(hub, taskId);
  if (value.title !== undefined) task.title = value.title.trim();
  if (value.description !== undefined) task.description = value.description;
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

export function addSession(hub: HubState, taskId: string, sessionId: string, deps: OperationDeps): HubTask {
  assertId(sessionId, 'Session ID');
  const task = requireTask(hub, taskId);
  invariant(!task.operation, 'TASK_BUSY', 'Cannot add a conversation during a context operation.');
  assertAvailableSession(hub, sessionId);
  task.sessionIds.push(sessionId);
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

export function closeSession(hub: HubState, taskId: string, sessionId: string, deps: OperationDeps): HubTask {
  return changeSessionVisibility(hub, taskId, sessionId, true, deps);
}

export function reopenSession(hub: HubState, taskId: string, sessionId: string, deps: OperationDeps): HubTask {
  return changeSessionVisibility(hub, taskId, sessionId, false, deps);
}

function changeSessionVisibility(hub: HubState, taskId: string, sessionId: string, closed: boolean, deps: OperationDeps): HubTask {
  assertId(sessionId, 'Session ID');
  const task = requireTask(hub, taskId);
  invariant(task.sessionIds.includes(sessionId), 'SESSION_NOT_FOUND', 'Conversation does not belong to the task.');
  if (closed && !task.closedSessionIds.includes(sessionId)) task.closedSessionIds.push(sessionId);
  if (!closed) task.closedSessionIds = task.closedSessionIds.filter(id => id !== sessionId);
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

export function saveNote(hub: HubState, taskId: string, input: NoteInput, deps: OperationDeps): Note {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Note input must be a mapping.');
  requiredText(value.content, 'Note content');
  if (value.id !== undefined) assertId(value.id, 'Note ID');
  if (value.tags !== undefined) invariant(Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string' && tag.trim()), 'INVALID_INPUT', 'Note tags must be nonempty text values.');
  requireTask(hub, taskId);
  const at = timestamp(deps);
  let note: Note;
  if (value.id !== undefined) {
    const current = hub.notes.find(item => item.id === value.id && item.taskId === taskId);
    invariant(current, 'NOTE_NOT_FOUND', 'Note does not exist for the target task.');
    note = { ...current, content: value.content, updatedAt: at };
    hub.notes[hub.notes.indexOf(current)] = note;
  } else {
    note = { id: nextId(hub.notes, deps.id), taskId, content: value.content, createdAt: at, updatedAt: at };
    hub.notes.push(note);
  }
  if (value.tags !== undefined) note.tags = [...new Set(value.tags.map(tag => tag.trim()))];
  hub.updatedAt = at;
  return note;
}

export function placeTask(hub: HubState, taskId: string, columnId: string, beforeTaskId: string | null, enteredAt: number): void {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  const sourceColumnId = task.columnId;
  const destination = hub.tasks.filter(value => value.boardId === board.id && value.columnId === columnId && value.id !== taskId)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
  const requestedIndex = beforeTaskId ? destination.findIndex(value => value.id === beforeTaskId) : -1;
  const index = requestedIndex >= 0 ? requestedIndex : destination.length;
  task.columnId = columnId;
  if (sourceColumnId !== columnId) {
    const destinationColumn = board.workflow.columns.find(value => value.id === columnId);
    if (destinationColumn?.onEnterPrompt?.trim()) task.instructionPending = { columnId, enteredAt };
    else delete task.instructionPending;
  }
  destination.splice(index, 0, task);
  destination.forEach((value, position) => { value.position = position; });
  if (sourceColumnId !== columnId) {
    hub.tasks.filter(value => value.boardId === board.id && value.columnId === sourceColumnId)
      .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))
      .forEach((value, position) => { value.position = position; });
  }
}

export function deleteTask(hub: HubState, taskId: string): HubTask {
  const task = requireTask(hub, taskId);
  hub.tasks = hub.tasks.filter(value => value.id !== taskId);
  hub.notes = hub.notes.filter(note => note.taskId !== taskId);
  return task;
}

export function normalizeSettings(input: BoardSettings): BoardSettings {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Settings input must be a mapping.');
  invariant(Object.keys(value).every(key => key === 'worktreeBasePath'), 'INVALID_INPUT', 'Unsupported board setting.');
  const raw = value.worktreeBasePath;
  invariant(raw === undefined || typeof raw === 'string', 'INVALID_INPUT', 'Worktree base path must be text.');
  const base = raw?.trim();
  invariant(!base || isAbsolutePath(base), 'INVALID_INPUT', 'Worktree base path must be an absolute path.');
  return base ? { worktreeBasePath: base } : {};
}
