import { KanbanError, invariant } from '../shared/errors.js';
import type { AutoModePause, AutoModeState, Board, BoardSettings, HubSchedule, HubState, HubTask, Note, Project, ProjectInput, ModelSelection, StagePatch, Workflow } from '../shared/types.js';
import { assertId, isAbsolutePath } from './validation.js';
import { assertSchedulable } from './cron.js';
import { isPublishedProject, requireProjectPath } from '../shared/project.js';
import { createBoard } from './hub-schema.js';
import { parseWorkflow } from './workflow.js';
import { applyWorkflowEdits, type WorkflowTextEdit } from './workflow-edit.js';
import { entryInstruction, nextEnteredAt } from './stage-entry.js';
import { applyHold, clearAutoModeState, normalizePauseReason } from './auto-mode-hold.js';
import { renameTaskStage, updateStage } from './stage-update.js';
import { describeStageActivity, hasInFlightWork, persistedStageActivity } from '../shared/stage-activity.js';
import { transitionTargets } from './transitions.js';
import { assertProjectSave, buildProject } from './project-registration.js';
import { assertKnownProjectKeys, assertProjectCreatable, boardsAllowingKey, normalizeProjectKeys } from './board-project-scope.js';
import { requireProjectKey } from './project-key.js';
import { applyNoteTags, validateNoteWrite, type NoteInput } from './note.js';
import type { Placement } from './placement.js';
import { compareTaskOrder } from './task-order.js';
import { recordAutoModeChange, recordCreation, recordIntent, type AutoModeChange } from './task-history/record.js';
import { placeTaskIn } from './task-placement.js';

export type { NoteInput } from './note.js';
export interface TaskTextPatch { title?: string; description?: string }
export interface OperationDeps { id: () => string; now: () => string }
/** Defensive limits that keep one Hub's schedule collection bounded. */
export const MAX_SCHEDULES_PER_HUB = 50;
export const MAX_SCHEDULE_TITLE = 120;
export const MAX_SCHEDULE_PROMPT = 20_000;
/** The editable schedule fields; enabled state has its own operation. */
export interface ScheduleInput {
  id?: string;
  title: string;
  prompt: string;
  cron: string;
  timeZone: string;
  projectId: string;
  model?: ModelSelection;
  newConversation: boolean;
  archiveWhenIdle: boolean;
}

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

export function requireSchedule(hub: HubState, scheduleId: string): HubSchedule {
  assertId(scheduleId, 'Schedule ID');
  const schedule = (hub.schedules ?? []).find(value => value.id === scheduleId);
  invariant(schedule, 'SCHEDULE_NOT_FOUND', 'Schedule does not exist in this Hub.');
  return schedule;
}

function normalizeScheduleModel(value: ModelSelection | undefined): ModelSelection | undefined {
  if (value === undefined) return undefined;
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Schedule model must be a mapping.');
  const provider = requiredText(value.provider, 'Model provider').trim();
  const model = requiredText(value.model, 'Model id').trim();
  const reasoningEffort = value.reasoningEffort === undefined ? undefined : requiredText(value.reasoningEffort, 'Reasoning effort').trim();
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

/** Create or replace one schedule. The enabled state survives an edit. */
export function saveSchedule(hub: HubState, input: ScheduleInput, deps: OperationDeps): HubSchedule {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Schedule input must be a mapping.');
  const title = requiredText(value.title, 'Schedule title').trim();
  invariant(title.length <= MAX_SCHEDULE_TITLE, 'INVALID_SCHEDULE_TITLE', 'A schedule title must be at most ' + MAX_SCHEDULE_TITLE + ' characters.');
  const prompt = requiredText(value.prompt, 'Schedule prompt').trim();
  invariant(prompt.length <= MAX_SCHEDULE_PROMPT, 'INVALID_SCHEDULE_PROMPT', 'A schedule prompt must be at most ' + MAX_SCHEDULE_PROMPT + ' characters.');
  invariant(typeof value.newConversation === 'boolean', 'INVALID_INPUT', 'The new-conversation option must be a boolean.');
  invariant(typeof value.archiveWhenIdle === 'boolean', 'INVALID_INPUT', 'The archive option must be a boolean.');
  const project = requireProject(hub, value.projectId);
  // A published placeholder has no directory; it must be adopted before it can run work.
  requireProjectPath(project);
  const cron = assertSchedulable(value.cron, value.timeZone, new Date(deps.now()));
  const existing = value.id === undefined ? undefined : requireSchedule(hub, value.id);
  if (existing === undefined) {
    invariant((hub.schedules?.length ?? 0) < MAX_SCHEDULES_PER_HUB, 'SCHEDULE_LIMIT', 'A Hub can hold at most ' + MAX_SCHEDULES_PER_HUB + ' schedules.');
  }
  const at = timestamp(deps);
  const model = normalizeScheduleModel(value.model);
  const schedule: HubSchedule = {
    id: existing?.id ?? nextId(hub.schedules ?? [], deps.id),
    title, prompt, cron, timeZone: value.timeZone.trim(), projectId: project.id,
    ...(model === undefined ? {} : { model }),
    newConversation: value.newConversation,
    // A continuous conversation exists to be resumed, so it is never archived.
    archiveWhenIdle: value.newConversation ? value.archiveWhenIdle : false,
    enabled: existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  if (existing) hub.schedules![hub.schedules!.indexOf(existing)] = schedule;
  else (hub.schedules ??= []).push(schedule);
  hub.updatedAt = at;
  return schedule;
}

export function setScheduleEnabled(hub: HubState, scheduleId: string, enabled: boolean, deps: OperationDeps): HubSchedule {
  invariant(typeof enabled === 'boolean', 'INVALID_INPUT', 'The enabled option must be a boolean.');
  const schedule = requireSchedule(hub, scheduleId);
  if (schedule.enabled === enabled) return schedule;
  schedule.enabled = enabled;
  schedule.updatedAt = timestamp(deps);
  hub.updatedAt = schedule.updatedAt;
  return schedule;
}

export function deleteSchedule(hub: HubState, scheduleId: string, deps: OperationDeps): HubSchedule {
  const schedule = requireSchedule(hub, scheduleId);
  hub.schedules = (hub.schedules ?? []).filter(value => value.id !== schedule.id);
  // Removing the last schedule removes the optional collection, so a downgrade
  // to a strict older schema can still parse the Hub.
  if (hub.schedules.length === 0) delete hub.schedules;
  hub.updatedAt = timestamp(deps);
  return schedule;
}

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

/** One stage edit, applied through the authored workflow text. */
export interface UpdateStageInput { stageId: string; patch: StagePatch }

/**
 * Edit one stage of a board's workflow. The authored document is rewritten by
 * text range, a renamed identifier is carried into every task of the board, and
 * the result is stored through the one workflow save path so the orphan rule and
 * the parsed workflow stay the authority. A rename is refused inside the
 * transaction when a task still carries persisted in-flight work, so a task
 * cannot gain work between the caller's check and this write.
 */
export function updateBoardStage(hub: HubState, boardId: string, input: UpdateStageInput, deps: OperationDeps): Workflow {
  const board = requireBoard(hub, boardId);
  const result = updateStage({ text: board.workflowYaml, stageId: input.stageId, patch: input.patch });
  if (result.renamedFrom !== undefined && result.renamedTo !== undefined) {
    const reasons = new Set<string>();
    for (const task of hub.tasks) {
      if (task.boardId !== board.id) continue;
      for (const reason of persistedStageActivity(task)) reasons.add(reason);
    }
    invariant(!hasInFlightWork([...reasons]), 'STAGE_RENAME_IN_FLIGHT', 'The board has work in flight (' + describeStageActivity([...reasons]) + '). Finish it before renaming a stage.');
    for (const task of hub.tasks) {
      if (task.boardId !== board.id) continue;
      renameTaskStage(task, result.renamedFrom, result.renamedTo);
    }
  }
  return saveBoardWorkflow(hub, boardId, result.text, deps);
}

/** Apply literal text edits to the authored YAML, then validate the result through the one save path. */
export function editBoardWorkflow(hub: HubState, boardId: string, edits: readonly WorkflowTextEdit[], deps: OperationDeps): Workflow {
  const board = requireBoard(hub, boardId);
  return saveBoardWorkflow(hub, boardId, applyWorkflowEdits(board.workflowYaml, edits), deps);
}

export function saveProject(hub: HubState, input: ProjectInput, deps: OperationDeps): Project {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Project input must be a mapping.');
  requiredText(value.name, 'Project name');
  if (value.id !== undefined) assertId(value.id, 'Project ID');
  const projectId = value.id ?? nextId(hub.projects, deps.id);
  const current = hub.projects.find(project => project.id === projectId);
  assertProjectSave(hub, projectId, value);
  const takenKeys = hub.projects.filter(project => project.id !== projectId).map(project => project.projectKey);
  const project = buildProject(projectId, value, current, takenKeys);
  // A key edit is a local reference migration: every board scope of the Hub follows it
  // in the same write, so no board is left naming a key that no project owns.
  if (current !== undefined && current.projectKey !== project.projectKey) {
    for (const board of boardsAllowingKey(hub.boards, current.projectKey)) {
      board.allowedProjectKeys = normalizeProjectKeys((board.allowedProjectKeys ?? []).map(key => key === current.projectKey ? project.projectKey : key));
      board.updatedAt = timestamp(deps);
    }
  }
  if (current) hub.projects[hub.projects.indexOf(current)] = project;
  else hub.projects.push(project);
  hub.updatedAt = timestamp(deps);
  return project;
}

export function deleteProject(hub: HubState, projectId: string, deps: OperationDeps): Project {
  const project = requireProject(hub, projectId);
  invariant(!project.operation, 'PROJECT_BUSY', 'Resolve the project relocation before deleting the project.');
  invariant(!hub.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Delete the tasks in this project before deleting the project.');
  invariant(!(hub.schedules ?? []).some(schedule => schedule.projectId === projectId), 'PROJECT_IN_USE', 'Delete or repoint the schedules in this project before deleting the project.');
  // A deleted project cannot stay in a board's scope: the key leaves every board that
  // names it, which may leave a restricted board with fewer keys or with none at all.
  for (const board of boardsAllowingKey(hub.boards, project.projectKey)) {
    board.allowedProjectKeys = normalizeProjectKeys((board.allowedProjectKeys ?? []).filter(key => key !== project.projectKey));
    board.updatedAt = timestamp(deps);
  }
  hub.projects.splice(hub.projects.indexOf(project), 1);
  hub.updatedAt = timestamp(deps);
  return project;
}

/** Set or clear one board's project scope; an absent list allows every project of the Hub. */
export function setBoardProjectScope(hub: HubState, boardId: string, projectKeys: readonly string[] | undefined, deps: OperationDeps): Board {
  const board = requireBoard(hub, boardId);
  if (projectKeys === undefined) {
    delete board.allowedProjectKeys;
  } else {
    const keys = normalizeProjectKeys(projectKeys.map(requireProjectKey));
    assertKnownProjectKeys(keys, hub.projects);
    board.allowedProjectKeys = keys;
  }
  board.updatedAt = timestamp(deps);
  hub.updatedAt = timestamp(deps);
  return board;
}

export function setProjectWorkspace(hub: HubState, projectId: string, workspaceId: string, owned: boolean, deps: OperationDeps): Project {
  assertId(workspaceId, 'Workspace ID');
  const project = requireProject(hub, projectId);
  invariant(!isPublishedProject(project), 'PROJECT_NOT_ADOPTED', 'Adopt the published project before binding a native workspace to it.');
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

export function createTask(hub: HubState, input: { boardId: string; projectId: string; title: string; description: string; autoMode?: boolean }, deps: OperationDeps): HubTask {
  const value = clone(input);
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'New task input must be a mapping.');
  requiredText(value.title, 'Task title');
  invariant(typeof value.description === 'string', 'INVALID_INPUT', 'Task description must be text.');
  invariant(value.autoMode === undefined || typeof value.autoMode === 'boolean', 'INVALID_INPUT', 'Task auto mode must be a boolean.');
  const board = requireBoard(hub, value.boardId);
  const project = requireProject(hub, value.projectId);
  assertProjectCreatable(board, project);
  const peers = hub.tasks.filter(task => task.boardId === board.id && task.columnId === board.workflow.initialColumnId);
  let position = peers.length ? peers.reduce((minimum, task) => Math.min(minimum, task.position), Infinity) - 1 : 0;
  if (!Number.isFinite(position) || peers.some(task => task.position === position)) {
    peers.sort(compareTaskOrder).forEach((task, index) => { task.position = index; });
    position = -1;
  }
  const at = timestamp(deps);
  const initialColumn = board.workflow.columns.find(column => column.id === board.workflow.initialColumnId);
  const task: HubTask = {
    id: nextId(hub.tasks, deps.id), boardId: board.id, projectId: project.id, title: value.title.trim(), description: value.description,
    columnId: board.workflow.initialColumnId, position, sessionIds: [], closedSessionIds: [], effectiveCwd: requireProjectPath(project),
    worktree: null, operation: null,
    ...(value.autoMode === true ? { autoMode: { enabled: true as const } } : {}),
    ...(entryInstruction(initialColumn) !== undefined ? { instructionPending: { columnId: initialColumn!.id, enteredAt: nextEnteredAt(Date.parse(at)) } } : {}),
    createdAt: at, updatedAt: at,
  };
  recordCreation(task, board.workflow.initialColumnId, at);
  hub.tasks.push(task);
  hub.updatedAt = at;
  return task;
}

export function dismissWorktree(hub: HubState, taskId: string, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  if (task.worktreeDismissed === true) return task;
  task.worktreeDismissed = true;
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

/**
 * Apply one auto mode change and record it. The operations below describe which
 * change happened; the setting and its record are written together here, so one
 * cannot move without the other.
 */
function applyAutoModeChange(task: HubTask, next: AutoModeState | undefined, change: AutoModeChange, at: string): void {
  if (next === undefined) delete task.autoMode; else task.autoMode = next;
  recordAutoModeChange(task, change, at);
}

export function setAutoMode(hub: HubState, taskId: string, enabled: boolean, deps: OperationDeps): HubTask {
  invariant(typeof enabled === 'boolean', 'INVALID_INPUT', 'Auto mode requires a boolean value.');
  const task = requireTask(hub, taskId);
  if (enabled) {
    // Enabling a paused task is its resume, so clearing the records is the whole change.
    if (task.autoMode?.enabled === true && task.autoMode.pause === undefined && task.autoMode.hold === undefined) return task;
    const at = timestamp(deps);
    applyAutoModeChange(task, { enabled: true }, { action: 'enabled' }, at);
    task.updatedAt = at;
    hub.updatedAt = at;
    return task;
  }
  if (task.autoMode === undefined) return task;
  const at = timestamp(deps);
  applyAutoModeChange(task, undefined, { action: 'disabled' }, at);
  task.updatedAt = at;
  hub.updatedAt = at;
  return task;
}

export function pauseAutoMode(hub: HubState, taskId: string, pause: AutoModePause, deps: OperationDeps, expectedColumnId?: string): HubTask {
  const task = requireTask(hub, taskId);
  if (task.autoMode?.enabled !== true) return task;
  if (expectedColumnId !== undefined && task.columnId !== expectedColumnId) return task;
  const at = timestamp(deps);
  applyAutoModeChange(task, { ...task.autoMode, pause: { ...pause } },
    { action: 'paused', reason: pause.reason, ...(pause.message === undefined ? {} : { message: pause.message }) }, at);
  task.updatedAt = at;
  hub.updatedAt = at;
  return task;
}

/**
 * Record the pause the agent requested. It suspends the automatic advance and
 * leaves auto mode enabled, so the user's setting survives the pause. A task
 * whose auto mode is disabled already does not advance, so nothing is recorded
 * for it and the caller reports that instead.
 */
export function pauseTask(hub: HubState, taskId: string, reason: unknown, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  const normalized = normalizePauseReason(reason);
  if (task.autoMode?.enabled !== true) return task;
  if (task.autoMode.hold?.reason === normalized) return task;
  // The agent pause owns its state transition through the hold helper; the record
  // still comes from the one writer every auto mode change uses.
  const at = timestamp(deps);
  applyHold(task, normalized, at);
  recordAutoModeChange(task, { action: 'agent-paused', reason: normalized }, at);
  task.updatedAt = at;
  hub.updatedAt = at;
  return task;
}

/**
 * Resume a paused task: the agent pause and any diagnostic pause are cleared and
 * auto mode keeps its setting, so resuming never enables a disabled task and
 * never advances a turn that already ended.
 */
export function resumeTask(hub: HubState, taskId: string, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  if (!clearAutoModeState(task)) return task;
  const at = timestamp(deps);
  recordAutoModeChange(task, { action: 'resumed' }, at);
  task.updatedAt = at;
  hub.updatedAt = at;
  return task;
}

/**
 * Record, replace, or clear the transition the task follows on its next advance.
 * The current stage must configure transitions and the target must be one of
 * them. A recording never moves the task, sends a message, or changes auto mode.
 */
export function recordTransition(hub: HubState, taskId: string, columnId: string | undefined, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  const source = board.workflow.columns.find(column => column.id === task.columnId);
  invariant(source, 'INVALID_TARGET', 'The task stage does not exist.');
  invariant(source.allowedTransitions !== undefined, 'TRANSITIONS_NOT_CONFIGURED', 'The current stage does not configure transitions.');
  if (columnId === undefined) {
    if (task.recordedTransition === undefined) return task;
    delete task.recordedTransition;
  } else {
    assertId(columnId, 'Column ID');
    invariant(columnId !== task.columnId, 'INVALID_TARGET', 'A recorded transition must target another stage.');
    invariant(transitionTargets(board.workflow, task.columnId).some(target => target.column.id === columnId),
      'TRANSITION_NOT_ALLOWED', 'The destination stage is not a configured transition of the current stage.');
    const fromColumnId = task.columnId;
    const at = timestamp(deps);
    task.recordedTransition = { fromColumnId, columnId, at };
    recordIntent(task, fromColumnId, columnId, at);
  }
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
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

/**
 * Retain one native session as a conversation of the task.
 *
 * `expectedEffectiveCwd` makes the attachment conditional on the task context
 * the caller aligned the conversation for, so a directory switch that completed
 * in between cannot attach a conversation to the wrong directory.
 */
export function addSession(hub: HubState, taskId: string, sessionId: string, deps: OperationDeps, expectedEffectiveCwd?: string): HubTask {
  assertId(sessionId, 'Session ID');
  const task = requireTask(hub, taskId);
  invariant(!task.operation, 'TASK_BUSY', 'Cannot add a conversation during a context operation.');
  invariant(expectedEffectiveCwd === undefined || task.effectiveCwd === expectedEffectiveCwd, 'CONTEXT_CHANGED', 'The task directory changed before the conversation was attached.');
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
  const write = validateNoteWrite(clone(input));
  requireTask(hub, taskId);
  const at = timestamp(deps);
  let note: Note;
  if (write.kind === 'update') {
    const current = hub.notes.find(item => item.id === write.id && item.taskId === taskId);
    invariant(current, 'NOTE_NOT_FOUND', 'Note does not exist for the target task.');
    note = { ...current, ...(write.content !== undefined ? { content: write.content } : {}), updatedAt: at };
    if (write.tags !== undefined) applyNoteTags(note, write.tags);
    hub.notes[hub.notes.indexOf(current)] = note;
  } else {
    note = { id: nextId(hub.notes, deps.id), taskId, content: write.content, createdAt: at, updatedAt: at };
    if (write.tags !== undefined) applyNoteTags(note, write.tags);
    hub.notes.push(note);
  }
  hub.updatedAt = at;
  return note;
}

export function deleteNote(hub: HubState, taskId: string, noteId: string, deps: OperationDeps): Note {
  assertId(noteId, 'Note ID');
  requireTask(hub, taskId);
  const index = hub.notes.findIndex(item => item.id === noteId && item.taskId === taskId);
  invariant(index >= 0, 'NOTE_NOT_FOUND', 'Note does not exist for the target task.');
  const note = hub.notes[index]!;
  hub.notes.splice(index, 1);
  hub.updatedAt = timestamp(deps);
  return note;
}

export function placeTask(hub: HubState, taskId: string, columnId: string, placement: Placement, enteredAt: number, options: { retainAgentPause?: boolean; at: string }): void {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  placeTaskIn(
    { workflow: board.workflow, tasks: hub.tasks.filter(value => value.boardId === board.id) },
    task, columnId, placement, enteredAt, options,
  );
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
