import { z } from 'zod';
import type { Board, Column, Task, Workflow } from '../shared/types.js';
import type { DeterministicControl, DeterministicTarget } from '../shared/deterministic.js';
import { DETERMINISTIC_HOLD_CODES, DETERMINISTIC_PHASES } from '../shared/deterministic.js';
import { PENDING_USER_WORK_KINDS } from './pending-user-work.js';
import { PARAMETER_LIMITS, PARAMETER_NAME, deterministicDefinitionSchema } from './deterministic-definition.js';
import { parameterValuesProblem } from './deterministic-parameters.js';
import { isDomainId, isAbsolutePath } from './validation.js';

const id = z.string().refine(isDomainId);
const timestamp = z.string().datetime({ offset: true });
const problem = z.strictObject({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
export const localStageIdentitiesSchema = z.record(id, id).refine(value => new Set(Object.values(value)).size === Object.keys(value).length, 'Local stage associations must be unique.');
export const deterministicTargetSchema = z.strictObject({ columnId: id, stageIdentity: id });
export const taskStageEntrySchema = z.strictObject({ id, columnId: id, stageIdentity: id, enteredAt: timestamp });
/** The durable value set: declared-shaped names within the accepted bounds; undeclared extras are allowed after a declaration edit. */
export const parameterValuesSchema = z.record(z.string().regex(PARAMETER_NAME), z.string().min(1).max(PARAMETER_LIMITS.valueLength)).superRefine((values, context) => {
  const issue = parameterValuesProblem(values);
  if (issue !== null) context.addIssue({ code: 'custom', message: issue });
});
export const deterministicCaptureSchema = z.strictObject({
  sourceRef: z.string().min(1), fingerprint: z.string().min(1), language: z.enum(['bash', 'typescript']), directory: z.enum(['task', 'project']),
  executionDirectory: z.string().refine(isAbsolutePath), source: z.strictObject({ kind: z.enum(['inline', 'file']), path: z.string().optional(), reference: z.string().optional() }),
  env: z.array(z.string()), params: z.array(z.string().regex(PARAMETER_NAME)).max(PARAMETER_LIMITS.count), exits: z.record(z.string(), deterministicTargetSchema),
});
/** Bounded hold facts: at most three background items with bounded labels and unique pending kinds. */
export const deterministicHoldSchema = z.strictObject({
  code: z.enum(DETERMINISTIC_HOLD_CODES), at: timestamp,
  background: z.array(z.strictObject({ kind: z.enum(['job', 'schedule']), id: z.string().min(1).max(128).optional(), label: z.string().min(1).max(200) })).max(3).optional(),
  pending: z.array(z.enum(PENDING_USER_WORK_KINDS)).max(PENDING_USER_WORK_KINDS.length).optional(),
});
export const deterministicResultSchema = z.strictObject({ id, exit: z.string(), message: z.string(), at: timestamp, target: deterministicTargetSchema.optional(), synthetic: z.boolean().optional(), deliveryId: id.optional(), deliveryStatus: z.enum(['pending', 'accepted', 'failed']).optional(), error: problem.optional() });
export const deterministicControlSchema = z.strictObject({
  entryId: id, executionId: id, stageIdentity: id, definition: deterministicDefinitionSchema, targets: z.record(z.string(), deterministicTargetSchema).optional(),
  parameters: parameterValuesSchema.optional(),
  phase: z.enum(DETERMINISTIC_PHASES), startedAt: timestamp, attempt: z.number().int().nonnegative(), restartCount: z.number().int().nonnegative(),
  attemptId: id.optional(), capture: deterministicCaptureSchema.optional(), result: deterministicResultSchema.optional(), error: problem.optional(), hold: deterministicHoldSchema.optional(),
});
export const deterministicHandoffSchema = z.strictObject({ id, entryId: id, executionId: id, fromColumnId: id, columnId: id, exit: z.string(), message: z.string(), at: timestamp, acceptedAt: timestamp.optional(), error: problem.optional(), instruction: z.string().optional(), sessionId: id.optional() });

/** Durable entry ownership outlives edits to the stage's saved execution mode. */
export function ownsDeterministicEntry(task: Pick<Task, 'stageEntry' | 'deterministic'> & Partial<Pick<Task, 'columnId'>>): boolean {
  return task.stageEntry !== undefined && task.deterministic?.entryId === task.stageEntry.id
    && task.deterministic.stageIdentity === task.stageEntry.stageIdentity
    && (task.columnId === undefined || task.columnId === task.stageEntry.columnId);
}
export function deterministicCurrent(task: Pick<Task, 'stageEntry' | 'deterministic'>, expected: { entryId: string; executionId: string; attemptId?: string }): boolean {
  const control = task.deterministic;
  return ownsDeterministicEntry(task) && control?.entryId === expected.entryId && control.executionId === expected.executionId && (expected.attemptId === undefined || control.attemptId === expected.attemptId);
}
export function acceptsDeterministicResult(task: Pick<Task, 'stageEntry' | 'deterministic'>, expected: { entryId: string; executionId: string; attemptId: string }): boolean {
  return deterministicCurrent(task, expected) && task.deterministic?.phase === 'active' && task.deterministic.result === undefined;
}
export function deterministicActive(control: Pick<DeterministicControl, 'phase'> | undefined): boolean { return control?.phase === 'active' || control?.phase === 'stopping'; }

/** Resolve a captured identity, never a newly reused authored identifier. */
export function resolveDeterministicTarget(board: Pick<Board, 'workflow' | 'localStageIdentities'>, target: DeterministicTarget): Column | undefined {
  return board.workflow.columns.find(column => (board.localStageIdentities?.[column.id] ?? column.key) === target.stageIdentity);
}
/** Reconcile only existing associations; a removed/recreated identifier receives a fresh identity. */
export function reconcileLocalStageIdentities(board: Pick<Board, 'workflow' | 'localStageIdentities'>, next: Workflow): void {
  if (board.localStageIdentities === undefined) return;
  const previous = board.workflow.columns;
  const mapping: Record<string, string> = {};
  for (const column of next.columns) {
    const old = previous.find(item => column.key !== undefined && item.key === column.key) ?? previous.find(item => item.id === column.id && item.key === undefined);
    if (old !== undefined && board.localStageIdentities[old.id] !== undefined) mapping[column.id] = board.localStageIdentities[old.id]!;
  }
  board.localStageIdentities = mapping;
}
/** Allocate local scope without manufacturing an authored publication key. */
export function ensureLocalStageIdentity(board: Pick<Board, 'workflow' | 'localStageIdentities'>, columnId: string, allocate: () => string): string {
  const column = board.workflow.columns.find(item => item.id === columnId);
  if (column === undefined) throw new Error('The stage no longer exists.');
  const existing = board.localStageIdentities?.[columnId];
  if (existing !== undefined) {
    if (!isDomainId(existing) || Object.entries(board.localStageIdentities ?? {}).some(([id, value]) => id !== columnId && value === existing)) throw new Error('The local stage association is invalid or reused by another stage.');
    return existing;
  }
  const used = new Set(Object.entries(board.localStageIdentities ?? {}).filter(([id]) => id !== columnId).map(([, identity]) => identity));
  for (const other of board.workflow.columns) if (other.id !== columnId && other.key !== undefined) used.add(other.key);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const identity = column.key ?? allocate();
    if (!isDomainId(identity) || used.has(identity)) {
      if (column.key !== undefined) throw new Error('The authored stage identity conflicts with another local association.');
      continue;
    }
    (board.localStageIdentities ??= {})[columnId] = identity;
    return identity;
  }
  throw new Error('Could not allocate a unique local stage identity.');
}
/** Freeze destination identities before asynchronous file capture or configuration edits. */
export function captureDeterministicTargets(board: Pick<Board, 'workflow' | 'localStageIdentities'>, column: Column, allocate: () => string): Record<string, DeterministicTarget> {
  if (column.deterministic === undefined) return {};
  return Object.fromEntries(Object.entries(column.deterministic.exits).map(([name, columnId]) => [name, { columnId, stageIdentity: ensureLocalStageIdentity(board, columnId, allocate) }]));
}
/** Called only by actual entry placement or creation, inside the caller's transaction. */
export function establishStageEntry(task: Task, column: Column, stageIdentity: string, at: string, allocate: () => string, targets?: Record<string, DeterministicTarget>, parameters?: Readonly<Record<string, string>>): void {
  const entryId = allocate();
  task.stageEntry = { id: entryId, columnId: column.id, stageIdentity, enteredAt: at };
  delete task.deterministicHandoff;
  if (column.deterministic === undefined) { delete task.deterministic; return; }
  task.deterministic = { entryId, executionId: allocate(), stageIdentity, definition: structuredClone(column.deterministic), ...(targets === undefined ? {} : { targets }), ...(parameters === undefined ? {} : { parameters: { ...parameters } }), phase: 'capture-pending', startedAt: at, attempt: 0, restartCount: 0 };
  delete task.instructionPending;
}
