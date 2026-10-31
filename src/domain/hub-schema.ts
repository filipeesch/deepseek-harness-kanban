import { z } from 'zod';
import type { Board, HubState, HubTask, KanbanMeta, KanbanSettings } from '../shared/types.js';
import { isAbsolutePath, isDomainId } from './validation.js';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from './workflow.js';

const id = z.string().refine(isDomainId, 'Expected a safe identifier.');
const nonempty = z.string().refine(value => value.trim().length > 0, 'Expected nonempty text.');
const absolutePath = z.string().refine(isAbsolutePath, 'Expected an absolute project or worktree path.');
const timestamp = z.string().datetime({ offset: true });
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const column = z.strictObject({
  id, name: nonempty, onEnterPrompt: z.string().optional(), allowedTransitions: z.array(id).optional(),
});
const group = z.strictObject({ id, name: nonempty, columnIds: z.array(id).min(1) });
const workflow = z.strictObject({
  name: nonempty, initialColumnId: id, columns: z.array(column).min(1), groups: z.array(group),
});
const project = z.strictObject({
  id, name: nonempty, projectPath: absolutePath, gitRootPath: absolutePath.optional(), defaultBranch: nonempty.optional(), workspaceId: id.optional(), workspaceOwned: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.defaultBranch !== undefined && value.gitRootPath === undefined) context.addIssue({ code: 'custom', path: ['defaultBranch'], message: 'A default branch requires a Git root.' });
});
const problem = z.strictObject({ code: nonempty, message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
const createWorktree = z.strictObject({ mode: z.enum(['new', 'existing']), path: absolutePath, branchName: nonempty, sourceBranch: nonempty.optional() });
const operationRequest = z.discriminatedUnion('kind', [
  createWorktree.extend({ kind: z.literal('create') }),
  z.strictObject({ kind: z.literal('attach'), path: absolutePath }),
  z.strictObject({ kind: z.literal('remove'), discardChanges: z.boolean(), expectedWorktreePath: absolutePath.nullable().optional() }),
  z.strictObject({ kind: z.literal('delete'), discardChanges: z.boolean(), expectedWorktreePath: absolutePath.nullable().optional() }),
  z.strictObject({ kind: z.literal('return') }),
]);
const operation = z.strictObject({
  id, request: operationRequest,
  phase: z.enum(['waiting', 'preflight', 'git', 'switching', 'removing', 'archiving', 'failed']),
  targetPath: absolutePath.optional(), targetDirectory: absolutePath.optional(),
  previousDirectories: z.record(id, absolutePath), switchedSessionIds: z.array(id), archivedSessionIds: z.array(id),
  createAttempt: z.strictObject({ operationId: id, path: absolutePath, gitRootPath: absolutePath, branchName: nonempty, mode: z.enum(['new', 'existing']), absentBefore: z.literal(true) }).optional(),
  gitCompleted: z.boolean(), error: problem.optional(), createdAt: timestamp,
});
const pendingTransition = z.strictObject({
  id, fromColumnId: id, columnId: id, mode: z.enum(['move', 'run']), sessionId: id.optional(), text: z.string().optional(), beforeTaskId: id.nullable().optional(),
  worktreeRequest: createWorktree.optional(), transitionOverride: z.boolean().optional(), status: z.enum(['waiting', 'sending', 'failed']), error: problem.optional(),
});
const task = z.strictObject({
  id, boardId: id, projectId: id, title: nonempty, description: z.string(), columnId: id, position: z.number().finite(),
  sessionIds: z.array(id), closedSessionIds: z.array(id), effectiveCwd: absolutePath,
  worktree: z.strictObject({ path: absolutePath, branch: nonempty, owned: z.boolean(), status: z.enum(['preparing', 'ready', 'error']) }).nullable(),
  worktreeDismissed: z.boolean().optional(),
  unclaimedWorktrees: z.array(z.strictObject({ path: absolutePath, branch: nonempty, error: problem })).optional(),
  worktreeWorkspaceId: id.optional(), worktreeWorkspaceOwned: z.boolean().optional(),
  operation: operation.nullable(), pendingTransition: pendingTransition.optional(), instructionPending: z.strictObject({ columnId: id, enteredAt: z.number().finite() }).optional(), createdAt: timestamp, updatedAt: timestamp,
});
const note = z.strictObject({
  id, taskId: id, content: nonempty, createdAt: timestamp, updatedAt: timestamp, tags: z.array(nonempty).optional(),
});
const board = z.strictObject({
  id, name: nonempty, workflowYaml: nonempty, workflow, createdAt: timestamp, updatedAt: timestamp,
});

/** Persisted settings and initialization marker stored in the domain global slot. */
export const KanbanMetaSchema: z.ZodType<KanbanMeta> = z.strictObject({
  initializedAt: timestamp.optional(),
  settingsRevision: revision,
  worktreeBasePath: absolutePath.optional(),
});

/** Global user settings exposed to the client. */
export const KanbanSettingsSchema: z.ZodType<KanbanSettings> = z.strictObject({
  revision,
  worktreeBasePath: absolutePath.optional(),
});

export function canonicalWorkflow(value: Board['workflow']): string {
  return JSON.stringify({
    name: value.name,
    initialColumnId: value.initialColumnId,
    columns: value.columns.map(item => ({ id: item.id, name: item.name, onEnterPrompt: item.onEnterPrompt, allowedTransitions: item.allowedTransitions })),
    groups: value.groups.map(item => ({ id: item.id, name: item.name, columnIds: item.columnIds })),
  });
}

/** Validates one Hub aggregate. Cross-Hub ownership is enforced by the repository. */
export const HubStateSchema: z.ZodType<HubState> = z.strictObject({
  id, name: nonempty, revision, projects: z.array(project), boards: z.array(board), tasks: z.array(task), notes: z.array(note), createdAt: timestamp, updatedAt: timestamp,
}).superRefine((state, context) => {
  const issue = (path: (string | number)[], message: string): void => { context.addIssue({ code: 'custom', path, message }); };
  const unique = (values: string[], path: (string | number)[]): void => {
    if (new Set(values).size !== values.length) issue(path, 'Identifiers must be unique.');
  };
  unique(state.projects.map(value => value.id), ['projects']);
  unique(state.boards.map(value => value.id), ['boards']);
  unique(state.tasks.map(value => value.id), ['tasks']);
  unique(state.notes.map(value => value.id), ['notes']);
  const boardNames = state.boards.map(value => value.name.trim().toLocaleLowerCase());
  if (new Set(boardNames).size !== boardNames.length) issue(['boards'], 'Board names must be unique within a Hub.');
  const projectIds = new Set(state.projects.map(value => value.id));
  const taskIds = new Set(state.tasks.map(value => value.id));
  const boardById = new Map(state.boards.map(value => [value.id, value]));
  const sessionOwners = new Set<string>();
  const operationIds = new Set<string>();
  const transitionIds = new Set<string>();
  for (const [index, value] of state.boards.entries()) {
    unique(value.workflow.columns.map(column => column.id), ['boards', index, 'workflow', 'columns']);
    unique(value.workflow.groups.map(group => group.id), ['boards', index, 'workflow', 'groups']);
    if (!value.workflow.columns.some(column => column.id === value.workflow.initialColumnId)) issue(['boards', index, 'workflow', 'initialColumnId'], 'Initial column must exist.');
    try {
      const parsed = parseWorkflow(value.workflowYaml);
      if (canonicalWorkflow(parsed) !== canonicalWorkflow(value.workflow)) issue(['boards', index, 'workflow'], 'Normalized workflow does not match workflowYaml.');
    } catch (error) {
      issue(['boards', index, 'workflowYaml'], error instanceof Error ? error.message : 'Invalid workflow YAML.');
    }
  }
  for (const [index, value] of state.tasks.entries()) {
    const board = boardById.get(value.boardId);
    if (!board) { issue(['tasks', index, 'boardId'], 'Task board does not exist.'); continue; }
    if (!projectIds.has(value.projectId)) issue(['tasks', index, 'projectId'], 'Task project does not exist.');
    const columnIds = new Set(board.workflow.columns.map(column => column.id));
    if (!columnIds.has(value.columnId)) issue(['tasks', index, 'columnId'], 'Task column does not exist in its board.');
    unique(value.sessionIds, ['tasks', index, 'sessionIds']);
    unique(value.closedSessionIds, ['tasks', index, 'closedSessionIds']);
    const sessions = new Set(value.sessionIds);
    for (const sessionId of value.sessionIds) {
      if (sessionOwners.has(sessionId)) issue(['tasks', index, 'sessionIds'], 'A native session cannot belong to multiple tasks.');
      sessionOwners.add(sessionId);
    }
    for (const sessionId of value.closedSessionIds) {
      if (!sessions.has(sessionId)) issue(['tasks', index, 'closedSessionIds'], 'Closed sessions must belong to the task.');
    }
    if (value.instructionPending && !columnIds.has(value.instructionPending.columnId)) issue(['tasks', index, 'instructionPending', 'columnId'], 'Instruction entry column does not exist.');
    if (value.pendingTransition) {
      const pending = value.pendingTransition;
      if (transitionIds.has(pending.id)) issue(['tasks', index, 'pendingTransition', 'id'], 'Pending transition IDs must be unique.');
      transitionIds.add(pending.id);
      for (const key of ['fromColumnId', 'columnId'] as const) {
        if (!columnIds.has(pending[key])) issue(['tasks', index, 'pendingTransition', key], 'Pending transition column does not exist.');
      }
      if (pending.sessionId !== undefined && !sessions.has(pending.sessionId)) issue(['tasks', index, 'pendingTransition', 'sessionId'], 'Pending transition session must belong to the task.');
    }
    if (value.operation) {
      if (operationIds.has(value.operation.id)) issue(['tasks', index, 'operation', 'id'], 'Operation IDs must be unique.');
      operationIds.add(value.operation.id);
      for (const key of ['switchedSessionIds', 'archivedSessionIds'] as const) {
        unique(value.operation[key], ['tasks', index, 'operation', key]);
        for (const sessionId of value.operation[key]) {
          if (!sessions.has(sessionId)) issue(['tasks', index, 'operation', key], 'Operation sessions must belong to the task.');
        }
      }
      for (const sessionId of Object.keys(value.operation.previousDirectories)) {
        if (!sessions.has(sessionId)) issue(['tasks', index, 'operation', 'previousDirectories'], 'Operation directory entries must belong to the task.');
      }
    }
  }
  for (const [index, value] of state.notes.entries()) {
    if (!taskIds.has(value.taskId)) issue(['notes', index, 'taskId'], 'Note task does not exist.');
  }
});

/** The client-facing aggregate of all Hubs plus global settings. */
export const KanbanStateSchema = z.strictObject({
  hubs: z.array(HubStateSchema),
  settings: KanbanSettingsSchema,
});

export function createBoard(idValue: string, name: string, now: string, workflowYaml = DEFAULT_WORKFLOW_YAML): Board {
  return { id: idValue, name, workflowYaml, workflow: parseWorkflow(workflowYaml), createdAt: now, updatedAt: now };
}

export function initialHubState(idValue: string, name: string, now = new Date().toISOString()): HubState {
  return { id: idValue, name, revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now };
}

export function defaultHubState(idValue: string, name: string, boardId: string, boardName: string, now = new Date().toISOString()): HubState {
  const hub = initialHubState(idValue, name, now);
  hub.boards.push(createBoard(boardId, boardName, now));
  return hub;
}

/** A HubTask is a Task with its required board identity; the persisted schema enforces it. */
export type { HubTask };
