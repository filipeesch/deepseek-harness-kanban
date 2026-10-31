import { z } from 'zod';
import type { Task, Workflow } from '../shared/types.js';
import { isAbsolutePath, isDomainId } from './validation.js';

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
  reason: z.enum(['turn-error', 'turn-blocked', 'turn-aborted', 'turn-max-tokens', 'advance-failed']),
  at: timestamp,
  message: z.string().optional(),
});
export const autoMode = z.strictObject({ enabled: z.boolean(), pause: autoModePause.optional() });
export const column = z.strictObject({
  id, name: nonempty, onEnterPrompt: z.string().optional(), allowedTransitions: z.array(id).optional(),
});
export const group = z.strictObject({ id, name: nonempty, columnIds: z.array(id).min(1) });
export const workflow = z.strictObject({
  name: nonempty, initialColumnId: id, columns: z.array(column).min(1), groups: z.array(group),
});
export const note = z.strictObject({
  id, taskId: id, content: nonempty, createdAt: timestamp, updatedAt: timestamp, tags: z.array(nonempty).optional(),
});
export const project = z.strictObject({
  id, name: nonempty, projectPath: absolutePath, gitRootPath: absolutePath.optional(), defaultBranch: nonempty.optional(), workspaceId: id.optional(), workspaceOwned: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.defaultBranch !== undefined && value.gitRootPath === undefined) context.addIssue({ code: 'custom', path: ['defaultBranch'], message: 'A default branch requires a Git root.' });
});

/** The task fields both aggregates persist; the Hub aggregate adds `boardId`. */
export const baseTask = z.strictObject({
  id, projectId: id, title: nonempty, description: z.string(), columnId: id, position: z.number().finite(),
  sessionIds: z.array(id), closedSessionIds: z.array(id), effectiveCwd: absolutePath,
  worktree: z.strictObject({ path: absolutePath, branch: nonempty, owned: z.boolean(), status: z.enum(['preparing', 'ready', 'error']), error: problem.optional() }).nullable(),
  worktreeDismissed: z.boolean().optional(),
  unclaimedWorktrees: z.array(z.strictObject({ path: absolutePath, branch: nonempty, error: problem })).optional(),
  worktreeWorkspaceId: id.optional(), worktreeWorkspaceOwned: z.boolean().optional(),
  operation: operation.nullable(), pendingTransition: pendingTransition.optional(), instructionPending: z.strictObject({ columnId: id, enteredAt: z.number().finite() }).optional(), autoMode: autoMode.optional(), createdAt: timestamp, updatedAt: timestamp,
});

/** The task fields the shared invariant check reads. */
export type TaskCheckValue = Pick<Task, 'projectId' | 'columnId' | 'sessionIds' | 'closedSessionIds' | 'operation' | 'pendingTransition' | 'instructionPending'>;

export function canonicalWorkflow(value: Workflow): string {
  return JSON.stringify({
    name: value.name,
    initialColumnId: value.initialColumnId,
    columns: value.columns.map(item => ({ id: item.id, name: item.name, onEnterPrompt: item.onEnterPrompt, allowedTransitions: item.allowedTransitions })),
    groups: value.groups.map(item => ({ id: item.id, name: item.name, columnIds: item.columnIds })),
  });
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
