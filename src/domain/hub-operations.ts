import { establishStageEntry, ownsScriptedEntry } from './scripted-state.js';
import { captureStageTargets, ensureLocalStageIdentity, reconcileLocalStageIdentities } from './stage-identity.js';
import { openSessionIds } from '../shared/conversations.js';
import { declaredParameterNames, validateParameterValues } from './scripted-parameters.js';
import { KanbanError, invariant } from '../shared/errors.js';
import type { AgentModelFallback, AutoModePause, AutoModeState, Board, BoardSettings, HubRelation, HubRelationType, HubSchedule, HubState, HubTask, Note, Project, ProjectInput, ModelSelection, StagePatch, TaskAttachment, Workflow } from '../shared/types.js';
import { assertId, isAbsolutePath } from './validation.js';
import { assertSchedulable } from './cron.js';
import { isPublishedProject, requireProjectPath } from '../shared/project.js';
import { createBoard } from './hub-schema.js';
import { parseWorkflow } from './workflow.js';
import { orphanedStageReferences } from './workflow-orphans.js';
import { applyWorkflowEdits, type WorkflowTextEdit } from './workflow-edit.js';
import { entryInstruction, nextEnteredAt } from './stage-entry.js';
import { applyHold, clearAutoModeState, normalizePauseReason } from './auto-mode-hold.js';
import { normalizeTransitionReason } from './transition-reason.js';
import { renameTaskStage, updateStage } from './stage-update.js';
import { describeStageActivity, hasInFlightWork, persistedStageActivity } from '../shared/stage-activity.js';
import { ownsStageRouting, transitionTargets } from './transitions.js';
import { assertProjectSave, buildProject } from './project-registration.js';
import { assertKnownProjectIdentities, assertProjectCreatable, boardsAllowingIdentity, normalizeProjectKeys, publishedIdentityOf } from './board-project-scope.js';
import { allocateProjectKey, publishedProjectName, requireProjectKey } from './project-key.js';
import { planReceivedScope } from './received-project-scope.js';
import { applyNoteTags, validateNoteWrite, type NoteInput } from './note.js';
import type { Placement } from './placement.js';
import { compareTaskOrder } from './task-order.js';
import { recordAutoModeChange, recordCreation, recordIntent, type AutoModeChange } from './task-history/record.js';
import type { StageEntryOrigin } from '../shared/task-history.js';
import { placeTaskIn } from './task-placement.js';
import { HUB_RELATION_TYPES } from '../shared/types.js';
import { canonicalEndpoints, findExistingRelation, firstRelationProblem, MAX_RELATIONS_PER_WRITE } from './card-relation.js';
import { addTaskAttachments, removeTaskAttachment, type TaskAttachmentWrite as TaskAttachmentWriteInput } from './task-attachment.js';

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

export function deleteBoard(hub: HubState, boardId: string, deps: OperationDeps, options: { prune?: boolean } = {}): Board {
  const board = requireBoard(hub, boardId);
  const tasks = hub.tasks.filter(task => task.boardId === board.id);
  invariant(tasks.length === 0, 'BOARD_IN_USE', 'Delete or move the tasks in this board before deleting it.');
  hub.boards.splice(hub.boards.indexOf(board), 1);
  hub.updatedAt = timestamp(deps);
  // A placeholder exists because a board names its identity; deleting the last board
  // that named one leaves it stating nothing. A batch defers this to its own end.
  if (options.prune !== false) pruneUncitedPlaceholders(hub, deps);
  return board;
}

export function saveBoardWorkflow(hub: HubState, boardId: string, yaml: string, deps: OperationDeps): Workflow {
  const board = requireBoard(hub, boardId);
  const workflow = parseWorkflow(yaml);
  const orphaned = orphanedStageReferences(workflow, hub.tasks.filter(task => task.boardId === board.id));
  invariant(orphaned.length === 0, 'WORKFLOW_ORPHAN_COLUMNS', 'Workflow update would orphan existing task columns: ' + orphaned.join(', ') + '.');
  reconcileLocalStageIdentities(board, workflow);
  board.workflowYaml = yaml;
  board.workflow = workflow;
  // A saved scripted stage can be reviewed before any card enters, so the
  // write freezes its stable identity and its destinations' identities.
  for (const column of workflow.columns) {
    if (column.scripted !== undefined) {
      ensureLocalStageIdentity(board, column.id, deps.id);
      for (const destination of Object.values(column.scripted.exits)) ensureLocalStageIdentity(board, destination, deps.id);
    }
    if (column.decision !== undefined) {
      ensureLocalStageIdentity(board, column.id, deps.id);
      for (const option of column.decision.options) ensureLocalStageIdentity(board, option.to, deps.id);
    }
  }
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
  const localIdentity = board.localStageIdentities?.[input.stageId];
  if (result.renamedFrom !== undefined && result.renamedTo !== undefined) {
    const reasons = new Set<string>();
    for (const task of hub.tasks) {
      if (task.boardId !== board.id) continue;
      for (const reason of persistedStageActivity(task)) reasons.add(reason);
    }
    invariant(!hasInFlightWork([...reasons]), 'STAGE_RENAME_IN_FLIGHT', 'The board has work in flight (' + describeStageActivity([...reasons]) + '). Finish it before renaming a stage.');
    if (board.localStageIdentities?.[result.renamedFrom] !== undefined) {
      board.localStageIdentities[result.renamedTo] = board.localStageIdentities[result.renamedFrom]!;
      delete board.localStageIdentities[result.renamedFrom];
    }
    for (const task of hub.tasks) {
      if (task.boardId !== board.id) continue;
      renameTaskStage(task, result.renamedFrom, result.renamedTo);
    }
  }
  const workflow = saveBoardWorkflow(hub, boardId, result.text, deps);
  if (result.renamedTo !== undefined && localIdentity !== undefined) (board.localStageIdentities ??= {})[result.renamedTo] = localIdentity;
  return workflow;
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
  // Adoption supplies a directory and nothing else: the keys a team published stay, so no
  // board scope of the receiving installation is rewritten by the person filling a path.
  if (current !== undefined && isPublishedProject(current)) {
    const requestedLocal = value.projectKey === undefined || value.projectKey.trim() === '' ? current.projectKey : requireProjectKey(value.projectKey);
    const requestedPublished = typeof value.publishedKey === 'string' ? (value.publishedKey.trim() === '' ? undefined : requireProjectKey(value.publishedKey)) : current.publishedKey;
    invariant(requestedLocal === current.projectKey && (requestedPublished ?? null) === (current.publishedKey ?? null), 'PROJECT_IDENTITY_FIXED', 'Adopting a received project keeps the keys its board scopes name. Adopt it first, then edit the keys.');
  }
  // A save that claims an identity a placeholder holds takes that placeholder over, so
  // the placeholder's local key — which is that same identity — must not read as a
  // conflict while the claim is being built.
  const others = hub.projects.filter(project => project.id !== projectId);
  // The identity this save will state, read the way buildProject reads it: an explicit
  // published key wins, an empty one leaves the identity to the local key, an absent one
  // keeps the stored published key, and a local key that is neither requested nor stored
  // is allocated below (so it can name no placeholder yet).
  const requestedPublished = typeof value.publishedKey === 'string' ? value.publishedKey.trim() : undefined;
  const publishedAfter = requestedPublished === undefined ? current?.publishedKey : (requestedPublished === '' ? undefined : requireProjectKey(requestedPublished));
  const localAfter = value.projectKey === undefined || value.projectKey.trim() === '' ? current?.projectKey : requireProjectKey(value.projectKey);
  const claimedIdentity = publishedAfter ?? localAfter;
  const absorbed = claimedIdentity === undefined ? undefined : others.find(project => isPublishedProject(project) && publishedIdentityOf(project) === claimedIdentity);
  const takenKeys = others.filter(project => project !== absorbed).map(project => project.projectKey);
  const project = buildProject(projectId, value, current, takenKeys);
  const previous = current === undefined ? null : publishedIdentityOf(current);
  const next = publishedIdentityOf(project);
  // A published identity answers one project and one project only. A placeholder states
  // that a team identity is not answered yet, so a save that claims it takes it over;
  // another project already answering it is a conflict the person must resolve.
  const holder = hub.projects.find(candidate => candidate.id !== projectId && publishedIdentityOf(candidate) === next);
  if (holder !== undefined) {
    if (!isPublishedProject(holder)) throw new KanbanError('PROJECT_KEY_CONFLICT', 'Another project of this Hub already uses that published key.', { projectKey: next });
    hub.projects.splice(hub.projects.indexOf(holder), 1);
  }
  // Changing the published identity is a local reference migration: every board scope of
  // the Hub follows it in the same write, so no board is left naming an identity no
  // project owns. A local key edit that leaves the identity alone touches no scope.
  if (previous !== null && previous !== next) {
    for (const board of boardsAllowingIdentity(hub.boards, previous)) {
      board.allowedProjectKeys = normalizeProjectKeys((board.allowedProjectKeys ?? []).map(key => key === previous ? next : key));
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
  // A received identity is answered by its placeholder, and removing that answer from the
  // board scopes would make them differ from the published version. Ignoring it is the
  // operation that keeps every scope valid.
  if (isPublishedProject(project)) throw new KanbanError('PROJECT_NOT_DELETABLE', 'This project was received from a team board. Ignore it instead of deleting it: an ignore keeps every board scope naming a project of the Hub.', { projectId });
  invariant(!project.operation, 'PROJECT_BUSY', 'Resolve the project relocation before deleting the project.');
  invariant(!hub.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Delete the tasks in this project before deleting the project.');
  invariant(!(hub.schedules ?? []).some(schedule => schedule.projectId === projectId), 'PROJECT_IN_USE', 'Delete or repoint the schedules in this project before deleting the project.');
  // A deleted project cannot stay in a board's scope: the identity leaves every board
  // that names it, which may leave a restricted board with fewer keys or with none at all.
  const identity = publishedIdentityOf(project);
  for (const board of boardsAllowingIdentity(hub.boards, identity)) {
    board.allowedProjectKeys = normalizeProjectKeys((board.allowedProjectKeys ?? []).filter(key => key !== identity));
    board.updatedAt = timestamp(deps);
  }
  hub.projects.splice(hub.projects.indexOf(project), 1);
  hub.updatedAt = timestamp(deps);
  return project;
}

/**
 * Give the Hub a published placeholder for every identity it does not answer yet.
 *
 * Reception is what makes a team board readable here: the identities its scope names
 * are written as placeholders in the same transaction that writes the scope, so the
 * scope names projects of the Hub and no board is left naming an identity nothing
 * answers. An identity the Hub already answers, including an ignored one, is left
 * alone. Returns the identities this call created, in the order they were received.
 */
export function ensurePublishedProjects(hub: HubState, identities: readonly string[], deps: OperationDeps): string[] {
  // A document may name one identity twice; one placeholder answers both.
  const { placeholders } = planReceivedScope([...new Set(identities.map(requireProjectKey))], hub.projects);
  const takenLocalKeys = new Set(hub.projects.map(project => project.projectKey));
  // Every incoming identity keeps its natural local key when nothing holds it, so a
  // mechanical key never takes the natural key of an identity received beside it.
  const reserved = new Set([...takenLocalKeys, ...placeholders]);
  const created: string[] = [];
  for (const identity of placeholders) {
    // The identity is the natural local key, but a registered project may already hold that
    // local key while answering a different team key (it is linked). A local key is unique
    // within the Hub, so the placeholder takes a mechanical one and keeps the received
    // identity as the key every board scope names.
    const localKey = takenLocalKeys.has(identity) ? allocateProjectKey(identity, reserved) : identity;
    takenLocalKeys.add(localKey);
    reserved.add(localKey);
    const project: Project = {
      id: nextId(hub.projects, deps.id), name: publishedProjectName(identity), projectKey: localKey, origin: 'published',
      ...(localKey === identity ? {} : { publishedKey: identity }),
    };
    hub.projects.push(project);
    created.push(identity);
  }
  if (created.length > 0) hub.updatedAt = timestamp(deps);
  return created;
}

/**
 * Acknowledge one received identity without a project, or take that back.
 *
 * The placeholder stays, marked and hidden, so every board scope that names its
 * identity keeps naming a project of the Hub: removing the identity from the scopes
 * instead would make those boards differ from the version the team published. Only a
 * placeholder can be ignored, because a registered project is already answered.
 */
export function dismissProject(hub: HubState, projectId: string, dismissed: unknown, deps: OperationDeps): Project {
  const project = requireProject(hub, projectId);
  if (!isPublishedProject(project)) throw new KanbanError('PROJECT_NOT_IGNORABLE', 'Only a project received from a team can be ignored.');
  invariant(typeof dismissed === 'boolean', 'INVALID_INPUT', 'The ignored state must be a boolean.');
  if (dismissed) project.dismissed = true;
  else delete project.dismissed;
  hub.updatedAt = timestamp(deps);
  return project;
}

/** The published identities whose placeholders no board of the Hub names, without writing. */
export function uncitedPlaceholders(hub: HubState): string[] {
  const cited = new Set<string>();
  for (const board of hub.boards) for (const key of board.allowedProjectKeys ?? []) cited.add(key);
  return hub.projects
    .filter(project => isPublishedProject(project) && !cited.has(publishedIdentityOf(project)))
    .map(publishedIdentityOf);
}

/**
 * Drop the placeholders no board of the Hub names any more.
 *
 * A placeholder exists because a board named its identity; once nothing names it, it
 * states nothing. Pruning never records an ignore, so a team that names the identity
 * again receives a fresh placeholder awaiting adoption.
 */
export function pruneUncitedPlaceholders(hub: HubState, deps: OperationDeps): string[] {
  const cited = new Set<string>();
  for (const board of hub.boards) for (const key of board.allowedProjectKeys ?? []) cited.add(key);
  const removed: string[] = [];
  for (const project of [...hub.projects]) {
    if (!isPublishedProject(project)) continue;
    if (cited.has(publishedIdentityOf(project))) continue;
    hub.projects.splice(hub.projects.indexOf(project), 1);
    removed.push(publishedIdentityOf(project));
  }
  if (removed.length > 0) hub.updatedAt = timestamp(deps);
  return removed;
}

/** Set or clear one board's project scope; an absent list allows every project of the Hub. */
export function setBoardProjectScope(hub: HubState, boardId: string, projectKeys: readonly string[] | undefined, deps: OperationDeps, options: { prune?: boolean } = {}): Board {
  const board = requireBoard(hub, boardId);
  if (projectKeys === undefined) {
    delete board.allowedProjectKeys;
  } else {
    const keys = normalizeProjectKeys(projectKeys.map(requireProjectKey));
    assertKnownProjectIdentities(keys, hub.projects);
    board.allowedProjectKeys = keys;
  }
  board.updatedAt = timestamp(deps);
  hub.updatedAt = timestamp(deps);
  // Every scope write is the chance to drop the placeholders it stopped naming, whether a
  // person narrowed the scope or a team update settled it. A batch defers this, so a
  // scope that drops an identity never prunes one another board of the batch adds.
  if (options.prune !== false) pruneUncitedPlaceholders(hub, deps);
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

export function createTask(hub: HubState, input: { boardId: string; projectId: string; title: string; description: string; autoMode?: boolean; /** A caller that already stored bytes under this identity supplies it. */ id?: string; attachments?: readonly TaskAttachmentWriteInput[] }, deps: OperationDeps): HubTask {
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
  // A caller that already stored this task's attachment bytes supplies the identity,
  // so the files it wrote resolve; otherwise the domain allocates a fresh one.
  const taskId = value.id === undefined ? nextId(hub.tasks, deps.id) : (invariant(!hub.tasks.some(task => task.id === value.id), 'TASK_EXISTS', 'A task with that identity already exists.'), value.id);
  const task: HubTask = {
    id: taskId, boardId: board.id, projectId: project.id, title: value.title.trim(), description: value.description,
    columnId: board.workflow.initialColumnId, position, sessionIds: [], closedSessionIds: [], effectiveCwd: requireProjectPath(project),
    worktree: null, operation: null,
    ...(value.autoMode === true ? { autoMode: { enabled: true as const } } : {}),
    ...(entryInstruction(initialColumn) !== undefined ? { instructionPending: { columnId: initialColumn!.id, enteredAt: nextEnteredAt(Date.parse(at)) } } : {}),
    createdAt: at, updatedAt: at,
  };
  // A creation carrying files records them in the same mutation, so a task is
  // never observable without the evidence it was created with.
  if (value.attachments !== undefined && value.attachments.length > 0) addTaskAttachments(task, value.attachments);
  if (initialColumn !== undefined) establishStageEntry(task, initialColumn, ensureLocalStageIdentity(board, initialColumn.id, deps.id), at, deps.id, captureStageTargets(board, initialColumn, deps.id));
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
 * Record, replace, or clear the transition the task follows at the end of its
 * next completed turn. The current stage must configure transitions and the
 * target must be one of them, and naming a target requires the reason the agent
 * declares it with. Clearing needs no reason. A recording never moves the task,
 * sends a message, or changes auto mode.
 */
export function recordTransition(hub: HubState, taskId: string, columnId: string | undefined, reason: unknown, parameters: unknown, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  const source = board.workflow.columns.find(column => column.id === task.columnId);
  invariant(source, 'INVALID_TARGET', 'The task stage does not exist.');
  if (columnId === undefined) {
    invariant(parameters === undefined, 'INVALID_PARAMETERS', 'Parameters require a destination stage. Omit parameters to clear the recorded transition.');
    if (task.recordedTransition === undefined) return task;
    delete task.recordedTransition;
  } else {
    invariant(source.allowedTransitions !== undefined, 'TRANSITIONS_NOT_CONFIGURED', 'The current stage does not configure transitions.');
    assertId(columnId, 'Column ID');
    invariant(columnId !== task.columnId, 'INVALID_TARGET', 'A recorded transition must target another stage.');
    invariant(transitionTargets(board.workflow, task.columnId).some(target => target.column.id === columnId),
      'TRANSITION_NOT_ALLOWED', 'The destination stage is not a configured transition of the current stage.');
    const destination = board.workflow.columns.find(column => column.id === columnId);
    const declared = declaredParameterNames(destination?.scripted?.params);
    let values: Record<string, string> | undefined;
    // A destination that declares none takes no set at all; a destination that
    // declares parameters requires exactly that set.
    if (declared.length === 0) {
      invariant(parameters === undefined, 'INVALID_PARAMETERS', 'The destination stage declares no parameters. Omit parameters.');
    } else {
      const checked = validateParameterValues(declared, parameters);
      invariant(checked.ok, 'INVALID_PARAMETERS', checked.ok ? '' : checked.message + ' Accepted names: ' + declared.join(', ') + '.');
      values = checked.values;
    }
    const fromColumnId = task.columnId;
    const at = timestamp(deps);
    task.recordedTransition = { fromColumnId, columnId, at, reason: normalizeTransitionReason(reason), ...(values === undefined ? {} : { parameters: values }) };
    recordIntent(task, fromColumnId, columnId, at);
  }
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

/** The host must recheck the live boundary synchronously inside the serialized write. */
export interface ExceptionalTurnWrite {
  sessionId: string; turn: number; entryId?: string; fromColumnId: string; isCurrent(): boolean;
}

/** Store exceptional intent only for the verified entry and live originating turn. */
export function recordExceptionalTransition(hub: HubState, taskId: string, columnId: string, reason: unknown, parameters: unknown, owner: ExceptionalTurnWrite, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  const source = board.workflow.columns.find(column => column.id === task.columnId);
  invariant(source && !ownsStageRouting(source) && !ownsScriptedEntry(task), 'INVALID_TARGET', 'A stage that owns its routing does not accept a declared transition.');
  const sameEntry = owner.entryId === undefined
    ? task.stageEntry === undefined && task.scripted === undefined && task.scriptedHandoff === undefined
    : task.stageEntry?.id === owner.entryId && task.stageEntry.columnId === owner.fromColumnId;
  invariant(sameEntry && task.columnId === owner.fromColumnId,
    'TRANSITION_STALE', 'The task entry changed or cannot be verified before the exceptional declaration was recorded.');
  invariant(openSessionIds(task).includes(owner.sessionId) && Number.isSafeInteger(owner.turn) && owner.turn > 0 && owner.isCurrent(),
    'EXCEPTION_TURN_UNAVAILABLE', 'The originating open turn can no longer be verified.');
  invariant(!task.operation && !task.pendingTransition && !task.autoMode?.hold, 'TASK_BUSY', 'The task is held or has work in flight.');
  assertId(columnId, 'Column ID');
  const destination = board.workflow.columns.find(column => column.id === columnId);
  invariant(destination && columnId !== task.columnId, 'INVALID_TARGET', 'An exceptional destination must be another existing stage.');
  invariant(!transitionTargets(board.workflow, task.columnId).some(target => target.column.id === columnId), 'INVALID_TARGET', 'The destination is configured; declare it as a normal transition.');
  const declared = declaredParameterNames(destination.scripted?.params);
  let values: Record<string, string> | undefined;
  if (declared.length === 0) invariant(parameters === undefined, 'INVALID_PARAMETERS', 'The destination stage declares no parameters. Omit parameters.');
  else {
    const checked = validateParameterValues(declared, parameters);
    invariant(checked.ok, 'INVALID_PARAMETERS', checked.ok ? '' : checked.message + ' Accepted names: ' + declared.join(', ') + '.');
    values = checked.values;
  }
  const normalizedReason = normalizeTransitionReason(reason);
  const at = timestamp(deps);
  const id = deps.id();
  task.recordedTransition = {
    fromColumnId: task.columnId, columnId, at, reason: normalizedReason,
    // For an unambiguous legacy entry, the fresh declaration id is a sentinel.
    // Any later real stage placement establishes a distinct stageEntry.
    exception: { id, sessionId: owner.sessionId, turn: owner.turn, entryId: owner.entryId ?? id },
    ...(values === undefined ? {} : { parameters: values }),
  };
  recordIntent(task, task.columnId, columnId, at);
  task.updatedAt = at;
  hub.updatedAt = at;
  return task;
}

/** Expire one unadmitted declaration without clearing a concurrent replacement. */
export function clearExceptionalTransition(hub: HubState, taskId: string, exceptionId: string, deps: OperationDeps): boolean {
  const task = requireTask(hub, taskId);
  if (task.recordedTransition?.exception?.id !== exceptionId) return false;
  delete task.recordedTransition;
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return true;
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
export function addSession(hub: HubState, taskId: string, sessionId: string, deps: OperationDeps, expectedEffectiveCwd?: string, agent?: string, fallback?: AgentModelFallback): HubTask {
  assertId(sessionId, 'Session ID');
  const task = requireTask(hub, taskId);
  invariant(!task.operation, 'TASK_BUSY', 'Cannot add a conversation during a context operation.');
  invariant(expectedEffectiveCwd === undefined || task.effectiveCwd === expectedEffectiveCwd, 'CONTEXT_CHANGED', 'The task directory changed before the conversation was attached.');
  assertAvailableSession(hub, sessionId);
  task.sessionIds.push(sessionId);
  // The agent binding is part of the attachment: a conversation never joins a task
  // without the role that decides which conversation the task's stages talk to.
  // The route outcome lands with the binding: the card and the instruction read one
  // durable record, and a failed later write cannot separate them.
  if (agent !== undefined) task.sessionRoles = { ...(task.sessionRoles ?? {}), [sessionId]: { agent, ...(fallback === undefined ? {} : { modelFallback: fallback }) } };
  else if (task.sessionRoles !== undefined) delete task.sessionRoles[sessionId];
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

/**
 * Record one attachment on a task. The caller stored the bytes first, so the
 * record never names an object that does not exist.
 */
/** Record one attachment on an already-loaded task, without touching Hub timestamps. */
export function addTaskAttachmentRecord(task: HubTask, attachment: TaskAttachmentWriteInput): void {
  addTaskAttachments(task, [attachment]);
}

export function addTaskAttachment(hub: HubState, taskId: string, attachment: TaskAttachmentWriteInput, deps: OperationDeps): HubTask {
  const task = requireTask(hub, taskId);
  addTaskAttachments(task, [attachment]);
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return task;
}

/**
 * Forget one attachment on a task and report what was recorded, so the caller can
 * delete its bytes. The record is the authority: a failure to delete bytes must
 * not leave the task naming an attachment the user removed.
 */
export function removeTaskAttachmentRecord(hub: HubState, taskId: string, attachmentId: string, deps: OperationDeps): TaskAttachment {
  const task = requireTask(hub, taskId);
  const removed = removeTaskAttachment(task, attachmentId);
  task.updatedAt = timestamp(deps);
  hub.updatedAt = task.updatedAt;
  return removed;
}

export function placeTask(hub: HubState, taskId: string, columnId: string, placement: Placement, enteredAt: number, options: { retainAgentPause?: boolean; at: string; /** How the move happened; absent records no origin. */ origin?: StageEntryOrigin; parameters?: Readonly<Record<string, string>>; decision?: { optionId: string; note?: string } }): void {
  const task = requireTask(hub, taskId);
  const board = boardForTask(hub, task);
  placeTaskIn(
    { workflow: board.workflow, localStageIdentities: (board.localStageIdentities ??= {}), tasks: hub.tasks.filter(value => value.boardId === board.id) },
    task, columnId, placement, enteredAt, options,
  );
}

/**
 * Remove one task and everything the Hub stores for it, in a single mutation: the
 * task record, its shared notes, and every relation in which it is an endpoint.
 * A stored relation whose endpoint is gone would be invalid state, so no caller
 * may remove a task without also removing its relations; every path that removes
 * a task goes through this cascade instead of filtering the collections itself.
 *
 * The task must already exist. The removal does not touch the Hub revision, the
 * relations of other tasks, or any other stored collection, so a caller can run
 * it inside a transaction that holds further checks of its own.
 */
export function removeTaskCascade(hub: HubState, taskId: string): HubTask {
  const task = requireTask(hub, taskId);
  // The attachment metadata leaves with the task in this same mutation; the bytes
  // are the caller's to delete, because the domain owns no filesystem.
  hub.tasks = hub.tasks.filter(value => value.id !== taskId);
  hub.notes = hub.notes.filter(note => note.taskId !== taskId);
  if (hub.relations !== undefined) hub.relations = hub.relations.filter(relation => relation.from !== taskId && relation.to !== taskId);
  return task;
}

/** Delete one task through the shared cascade. */
export function deleteTask(hub: HubState, taskId: string): HubTask {
  return removeTaskCascade(hub, taskId);
}

/** One requested relation; the aggregate normalizes its endpoints and allocates its identity. */
export interface RelationWriteInput { type: HubRelationType; from: string; to: string }

/**
 * Record a batch of relations all or nothing. Both endpoints must be tasks of this
 * Hub, an epic batch must not close a cycle, and a symmetric pair that already
 * exists is returned instead of stored twice.
 */
export function createRelations(hub: HubState, inputs: readonly RelationWriteInput[], deps: OperationDeps): HubRelation[] {
  invariantArray(inputs, 'relations');
  const stored = [...(hub.relations ?? [])];
  const written: HubRelation[] = [];
  const taskIds = new Set(hub.tasks.map(value => value.id));
  for (const input of inputs) {
    invariant(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT', 'Every relation must be a mapping.');
    invariant(HUB_RELATION_TYPES.includes(input.type), 'INVALID_INPUT', 'Relation type must be epic or related.');
    assertId(input.from, 'Source task ID');
    assertId(input.to, 'Target task ID');
    requireTask(hub, input.from);
    requireTask(hub, input.to);
    invariant(input.from !== input.to, 'INVALID_RELATION', 'A relation cannot target its own task.');
    const existing = findExistingRelation(stored, input.type, input.from, input.to);
    if (existing !== undefined) { written.push(existing); continue; }
    const endpoints = canonicalEndpoints(input.type, input.from, input.to);
    const relation: HubRelation = { id: nextId(stored, deps.id), type: input.type, ...endpoints };
    stored.push(relation);
    written.push(relation);
  }
  const problem = firstRelationProblem(taskIds, stored);
  invariant(problem === undefined, 'INVALID_RELATION', problem ?? 'The relation collection is invalid.');
  hub.relations = stored;
  hub.updatedAt = timestamp(deps);
  return written;
}

/** Remove a batch of relations by identifier, all or nothing. */
export function deleteRelations(hub: HubState, relationIds: readonly string[], deps: OperationDeps): HubRelation[] {
  invariantArray(relationIds, 'relation identifiers');
  const stored = hub.relations ?? [];
  const unique = [...new Set(relationIds)];
  const removed: HubRelation[] = [];
  for (const relationId of unique) {
    assertId(relationId, 'Relation ID');
    const relation = stored.find(value => value.id === relationId);
    invariant(relation, 'RELATION_NOT_FOUND', 'Relation does not exist.');
    removed.push(relation);
  }
  const removedIds = new Set(unique);
  hub.relations = stored.filter(value => !removedIds.has(value.id));
  hub.updatedAt = timestamp(deps);
  return removed;
}

/** A bounded, nonempty collection of relation writes or identifiers. */
function invariantArray(value: readonly unknown[], label: string): void {
  invariant(Array.isArray(value) && value.length > 0, 'INVALID_INPUT', 'Provide at least one of the ' + label + '.');
  invariant(value.length <= MAX_RELATIONS_PER_WRITE, 'TOO_MANY_RELATIONS', 'At most ' + MAX_RELATIONS_PER_WRITE + ' may be written in one call.');
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