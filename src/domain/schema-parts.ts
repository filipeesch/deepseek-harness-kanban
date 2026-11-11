import { z } from 'zod';
import type { ConnectionLayout, Task, TransitionRule, Workflow } from '../shared/types.js';
import { STAGE_MIN_SIZE, STAGE_SIZE_LIMIT } from './stage-size.js';
import { PROJECT_KEY_PATTERN } from './project-key.js';
import { transitionRule as normalizeTransitionRule } from './transition-rule.js';
import { isAbsolutePath, isDomainId } from './validation.js';
import { ANCHOR_POINTS_PER_SIDE, CONNECTION_OFFSET_LIMIT } from './connection-anchor.js';

/**
 * Shared persisted-schema fragments. The legacy board aggregate and the Hub
 * aggregate validate the same task, workflow, note, and operation shapes; only
 * their cross-record rules differ, so each aggregate composes these parts and
 * keeps its own `superRefine`.
 */

export const id = z.string().refine(isDomainId, 'Expected a safe identifier.');
export const nonempty = z.string().refine(value => value.trim().length > 0, 'Expected nonempty text.');
export const absolutePath = z.string().refine(isAbsolutePath, 'Expected an absolute project or worktree path.');
export const timestamp = z.string().datetime({ offset: true });
export const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.record(z.string(), jsonValue),
]));
export const problem = z.strictObject({ code: nonempty, message: z.string(), details: z.record(z.string(), jsonValue).optional() });
export const createWorktree = z.strictObject({ mode: z.enum(['new', 'existing']), path: absolutePath, branchName: nonempty, sourceBranch: nonempty.optional() });
export const operationRequest = z.discriminatedUnion('kind', [
  createWorktree.extend({ kind: z.literal('create') }),
  z.strictObject({ kind: z.literal('attach'), path: absolutePath }),
  z.strictObject({ kind: z.literal('remove'), discardChanges: z.boolean(), expectedWorktreePath: absolutePath.nullable().optional(), force: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('delete'), discardChanges: z.boolean(), expectedWorktreePath: absolutePath.nullable().optional(), force: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('return') }),
]);
export const operation = z.strictObject({
  id, request: operationRequest,
  phase: z.enum(['queued', 'waiting', 'preflight', 'git', 'switching', 'removing', 'archiving', 'failed']),
  targetPath: absolutePath.optional(), targetDirectory: absolutePath.optional(),
  retainedCheckoutPath: absolutePath.optional(), retainedCheckoutReason: z.enum(['folder', 'unresolved']).optional(),
  previousDirectories: z.record(id, absolutePath), switchedSessionIds: z.array(id), archivedSessionIds: z.array(id),
  createAttempt: z.strictObject({ operationId: id, path: absolutePath, gitRootPath: absolutePath, branchName: nonempty, mode: z.enum(['new', 'existing']), absentBefore: z.literal(true) }).optional(),
  gitCompleted: z.boolean(), error: problem.optional(), createdAt: timestamp,
});
export const pendingTransition = z.strictObject({
  id, fromColumnId: id, columnId: id, mode: z.enum(['move', 'run']), sessionId: id.optional(), text: z.string().optional(), beforeTaskId: id.nullable().optional(),
  worktreeRequest: createWorktree.optional(), transitionOverride: z.boolean().optional(), status: z.enum(['waiting', 'sending', 'failed']), error: problem.optional(),
  origin: z.literal('auto').optional(),
});
export const autoModePause = z.strictObject({
  reason: z.enum(['turn-error', 'turn-blocked', 'turn-aborted', 'turn-max-tokens', 'advance-failed', 'transition-stale']),
  at: timestamp,
  message: z.string().optional(),
});
export const autoMode = z.strictObject({ enabled: z.boolean(), pause: autoModePause.optional() });
/** An authored stage position; the workflow parser owns the accepted range. */
export const stagePosition = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
/** One authored transition entry; the bare identifier form is normalized on read. */
export const transitionRule = z.union([
  id,
  z.strictObject({ to: id, when: nonempty.optional() }),
]).transform((value): TransitionRule => typeof value === 'string'
  ? normalizeTransitionRule(value)
  : normalizeTransitionRule(value.to, value.when));
/** An authored stage size; the workflow parser owns the accepted minimum and range. */
export const stageSize = z.strictObject({
  width: z.number().finite().min(STAGE_MIN_SIZE.width).max(STAGE_SIZE_LIMIT),
  height: z.number().finite().min(STAGE_MIN_SIZE.height).max(STAGE_SIZE_LIMIT),
});
/** One authored touch point on a stage boundary. */
export const connectionAnchor = z.strictObject({
  side: z.enum(['top', 'right', 'bottom', 'left']),
  at: z.number().int().min(0).max(ANCHOR_POINTS_PER_SIDE - 1),
});
/** One authored displacement of an adjustable connection segment. */
export const connectionSegment = z.strictObject({
  axis: z.enum(['x', 'y']),
  offset: z.number().finite().min(-CONNECTION_OFFSET_LIMIT).max(CONNECTION_OFFSET_LIMIT),
});
/** One authored connection layout; the workflow parser owns the pair rule. */
export const connectionLayout = z.strictObject({
  from: id, to: id, source: connectionAnchor.optional(), target: connectionAnchor.optional(), segments: z.array(connectionSegment).optional(),
});
export const column = z.strictObject({
  id, name: nonempty, onEnterPrompt: z.string().optional(), allowedTransitions: z.array(transitionRule).optional(), position: stagePosition.optional(), size: stageSize.optional(),
});
export const group = z.strictObject({ id, name: nonempty, columnIds: z.array(id).min(1) });
export const workflow = z.strictObject({
  name: nonempty, initialColumnId: id, defaultView: z.enum(['board', 'workflow']).optional(), columns: z.array(column).min(1), groups: z.array(group),
  connections: z.array(connectionLayout).optional(),
});
export const note = z.strictObject({
  id, taskId: id, content: nonempty, createdAt: timestamp, updatedAt: timestamp, tags: z.array(nonempty).optional(),
});
const relocationLocationShape = { projectPath: absolutePath, gitRootPath: absolutePath.optional(), defaultBranch: nonempty.optional() };
const relocationFrom = z.strictObject(relocationLocationShape).superRefine((value, context) => {
  if (value.defaultBranch !== undefined && value.gitRootPath === undefined) context.addIssue({ code: 'custom', path: ['defaultBranch'], message: 'A default branch requires a Git root.' });
});
const relocationTo = z.strictObject({ name: nonempty, ...relocationLocationShape }).superRefine((value, context) => {
  if (value.defaultBranch !== undefined && value.gitRootPath === undefined) context.addIssue({ code: 'custom', path: ['defaultBranch'], message: 'A default branch requires a Git root.' });
});
/** The durable project relocation journal; absent on a project with no recorded relocation. */
export const projectRelocation = z.strictObject({
  id,
  request: z.strictObject({ from: relocationFrom, to: relocationTo }),
  phase: z.enum(['queued', 'preflight', 'waiting', 'migrating', 'worktrees', 'sessions', 'workspace', 'failed']),
  error: problem.optional(),
  migratedSessionIds: z.array(id),
  started: z.boolean(),
  createdAt: timestamp,
});
/** A stable project key: lowercase, hyphen-separated, bounded. */
export const projectKey = z.string().refine(value => PROJECT_KEY_PATTERN.test(value), 'Expected a safe project key.');
/**
 * The project fields both record shapes share. A project is either registered with a
 * directory, or a placeholder that exists only because a received board names its key.
 * A placeholder never carries a path, a Git root, or a default branch, so no
 * path-dependent operation can read a fake directory.
 */
const projectFields = {
  id, name: nonempty,
  projectPath: absolutePath.optional(),
  gitRootPath: absolutePath.optional(), defaultBranch: nonempty.optional(), workspaceId: id.optional(), workspaceOwned: z.boolean().optional(), operation: projectRelocation.optional(),
  /** Present only on a placeholder created from a received document. */
  origin: z.literal('published').optional(),
};
function projectIssues(value: { origin?: 'published'; projectPath?: string; gitRootPath?: string; defaultBranch?: string; workspaceId?: string; workspaceOwned?: boolean; operation?: unknown }, context: z.RefinementCtx): void {
  const issue = (path: string, message: string): void => { context.addIssue({ code: 'custom', path: [path], message }); };
  if (value.origin === 'published') {
    if (value.projectPath !== undefined) issue('projectPath', 'A published placeholder has no project path.');
    if (value.gitRootPath !== undefined) issue('gitRootPath', 'A published placeholder is not Git-backed.');
    if (value.defaultBranch !== undefined) issue('defaultBranch', 'A published placeholder has no default branch.');
    if (value.workspaceId !== undefined || value.workspaceOwned !== undefined) issue('workspaceId', 'A published placeholder has no native workspace.');
    if (value.operation !== undefined) issue('operation', 'A published placeholder has no relocation.');
    return;
  }
  if (value.projectPath === undefined) issue('projectPath', 'A project requires a project path.');
  if (value.defaultBranch !== undefined && value.gitRootPath === undefined) issue('defaultBranch', 'A default branch requires a Git root.');
}
/** A stored project whose key may still be missing until the open backfill assigns one. */
export const storedProject = z.strictObject({ ...projectFields, projectKey: projectKey.optional() }).superRefine(projectIssues);
/** A project in an opened Hub: it always carries its key. */
export const project = z.strictObject({ ...projectFields, projectKey }).superRefine(projectIssues);


/** The task fields both aggregates persist; the Hub aggregate adds `boardId`. */
export const baseTask = z.strictObject({
  id, projectId: id, title: nonempty, description: z.string(), columnId: id, position: z.number().finite(),
  sessionIds: z.array(id), closedSessionIds: z.array(id), effectiveCwd: absolutePath,
  worktree: z.strictObject({ path: absolutePath, branch: nonempty, owned: z.boolean(), status: z.enum(['preparing', 'ready', 'error']), error: problem.optional() }).nullable(),
  worktreeDismissed: z.boolean().optional(),
  unclaimedWorktrees: z.array(z.strictObject({ path: absolutePath, branch: nonempty, error: problem })).optional(),
  worktreeWorkspaceId: id.optional(), worktreeWorkspaceOwned: z.boolean().optional(),
  operation: operation.nullable(), pendingTransition: pendingTransition.optional(), instructionPending: z.strictObject({ columnId: id, enteredAt: z.number().finite() }).optional(), autoMode: autoMode.optional(),
  recordedTransition: z.strictObject({ fromColumnId: id, columnId: id, at: timestamp }).optional(), createdAt: timestamp, updatedAt: timestamp,
});

/** The task fields the shared invariant check reads. */
export type TaskCheckValue = Pick<Task, 'projectId' | 'columnId' | 'sessionIds' | 'closedSessionIds' | 'operation' | 'pendingTransition' | 'instructionPending' | 'recordedTransition'>;

/** The authored connection layouts in a stable order, so identity does not depend on edit order. */
function sortedConnections(value: readonly ConnectionLayout[] | undefined): ConnectionLayout[] {
  if (value === undefined) return [];
  return [...value].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

function shapeConnection(value: ConnectionLayout): Record<string, unknown> {
  return {
    from: value.from,
    to: value.to,
    source: value.source,
    target: value.target,
    segments: value.segments?.map(segment => ({ axis: segment.axis, offset: segment.offset })),
  };
}

function workflowShape(value: Workflow, includeLayout: boolean): string {
  return JSON.stringify({
    name: value.name,
    defaultView: value.defaultView,
    initialColumnId: value.initialColumnId,
    columns: value.columns.map(item => ({
      id: item.id, name: item.name, onEnterPrompt: item.onEnterPrompt,
      allowedTransitions: item.allowedTransitions?.map(rule => normalizeTransitionRule(rule.to, rule.when)),
      ...(includeLayout ? { position: item.position, size: item.size } : {}),
    })),
    groups: value.groups.map(item => ({ id: item.id, name: item.name, columnIds: item.columnIds })),
    ...(includeLayout ? { connections: sortedConnections(value.connections).map(shapeConnection) } : {}),
  });
}

/** The persisted workflow identity, including its diagram layout. */
export function canonicalWorkflow(value: Workflow): string {
  return workflowShape(value, true);
}

/** The workflow without its diagram layout: the flow two versions must share to merge. */
export function workflowMeaning(value: Workflow): string {
  return workflowShape(value, false);
}

type Issue = (path: (string | number)[], message: string) => void;

/**
 * One shared per-task invariant pass. Both aggregates record issues at the same
 * `tasks.<index>.<field>` paths; the caller supplies the column set that applies
 * to each task, because a Hub resolves them per board.
 */
export function createTaskInvariantChecker(projectIds: ReadonlySet<string>, issue: Issue) {
  const sessionOwners = new Set<string>();
  const operationIds = new Set<string>();
  const transitionIds = new Set<string>();
  const unique = (values: string[], path: (string | number)[]): void => {
    if (new Set(values).size !== values.length) issue(path, 'Identifiers must be unique.');
  };
  return {
    check(value: TaskCheckValue, index: number, columnIds: ReadonlySet<string>, columnMessage = 'Task column does not exist.'): void {
      if (!projectIds.has(value.projectId)) issue(['tasks', index, 'projectId'], 'Task project does not exist.');
      if (!columnIds.has(value.columnId)) issue(['tasks', index, 'columnId'], columnMessage);
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
      // A recorded transition is routing intent, not a reference the workflow must
      // still satisfy: a workflow edit may remove its target, and that is exactly
      // the stale recording the advance must report instead of refusing the edit.
      if (value.recordedTransition && !columnIds.has(value.recordedTransition.fromColumnId)) {
        issue(['tasks', index, 'recordedTransition', 'fromColumnId'], 'Recorded transition source column does not exist.');
      }
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
    },
  };
}
