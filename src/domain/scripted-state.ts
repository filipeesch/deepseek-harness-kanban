import { z } from 'zod';
import type { Board, Column, Task, Workflow } from '../shared/types.js';
import type { ScriptedControl, ScriptedTarget } from '../shared/scripted.js';
import { SCRIPTED_HOLD_CODES, SCRIPTED_PHASES } from '../shared/scripted.js';
import { PENDING_USER_WORK_KINDS } from './pending-user-work.js';
import { PARAMETER_LIMITS, PARAMETER_NAME, scriptedDefinitionSchema } from './scripted-definition.js';
import { parameterValuesProblem } from './scripted-parameters.js';
import { isDomainId, isAbsolutePath } from './validation.js';

const id = z.string().refine(isDomainId);
const timestamp = z.string().datetime({ offset: true });
const problem = z.strictObject({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
export const localStageIdentitiesSchema = z.record(id, id).refine(value => new Set(Object.values(value)).size === Object.keys(value).length, 'Local stage associations must be unique.');
export const scriptedTargetSchema = z.strictObject({ columnId: id, stageIdentity: id });
export const taskStageEntrySchema = z.strictObject({ id, columnId: id, stageIdentity: id, enteredAt: timestamp });
/** The durable value set: declared-shaped names within the accepted bounds; undeclared extras are allowed after a declaration edit. */
export const parameterValuesSchema = z.record(z.string().regex(PARAMETER_NAME), z.string().min(1).max(PARAMETER_LIMITS.valueLength)).superRefine((values, context) => {
  const issue = parameterValuesProblem(values);
  if (issue !== null) context.addIssue({ code: 'custom', message: issue });
});
export const scriptedCaptureSchema = z.strictObject({
  sourceRef: z.string().min(1), fingerprint: z.string().min(1), language: z.enum(['bash', 'typescript']), directory: z.enum(['task', 'project']),
  executionDirectory: z.string().refine(isAbsolutePath), source: z.strictObject({ kind: z.enum(['inline', 'file']), path: z.string().optional(), reference: z.string().optional() }),
  env: z.array(z.string()), params: z.array(z.string().regex(PARAMETER_NAME)).max(PARAMETER_LIMITS.count), exits: z.record(z.string(), scriptedTargetSchema),
});
/** Bounded hold facts: at most three background items with bounded labels and unique pending kinds. */
export const scriptedHoldSchema = z.strictObject({
  code: z.enum(SCRIPTED_HOLD_CODES), at: timestamp,
  background: z.array(z.strictObject({ kind: z.enum(['job', 'schedule']), id: z.string().min(1).max(128).optional(), label: z.string().min(1).max(200) })).max(3).optional(),
  pending: z.array(z.enum(PENDING_USER_WORK_KINDS)).max(PENDING_USER_WORK_KINDS.length).optional(),
});
export const scriptedResultSchema = z.strictObject({ id, exit: z.string(), message: z.string(), at: timestamp, params: parameterValuesSchema.optional(), target: scriptedTargetSchema.optional(), synthetic: z.boolean().optional(), deliveryId: id.optional(), deliveryStatus: z.enum(['pending', 'accepted', 'failed']).optional(), error: problem.optional() });
export const scriptedControlSchema = z.strictObject({
  entryId: id, executionId: id, stageIdentity: id, definition: scriptedDefinitionSchema, targets: z.record(z.string(), scriptedTargetSchema).optional(),
  parameters: parameterValuesSchema.optional(),
  phase: z.enum(SCRIPTED_PHASES), startedAt: timestamp, attempt: z.number().int().nonnegative(), restartCount: z.number().int().nonnegative(),
  attemptId: id.optional(), capture: scriptedCaptureSchema.optional(), result: scriptedResultSchema.optional(), error: problem.optional(), hold: scriptedHoldSchema.optional(),
});
export const scriptedHandoffSchema = z.strictObject({ id, entryId: id, executionId: id, fromColumnId: id, columnId: id, exit: z.string(), message: z.string(), at: timestamp, params: parameterValuesSchema.optional(), acceptedAt: timestamp.optional(), error: problem.optional(), instruction: z.string().optional(), sessionId: id.optional() });

/** Durable entry ownership outlives edits to the stage's saved execution mode. */
export function ownsScriptedEntry(task: Pick<Task, 'stageEntry' | 'scripted'> & Partial<Pick<Task, 'columnId'>>): boolean {
  return task.stageEntry !== undefined && task.scripted?.entryId === task.stageEntry.id
    && task.scripted.stageIdentity === task.stageEntry.stageIdentity
    && (task.columnId === undefined || task.columnId === task.stageEntry.columnId);
}
export function scriptedCurrent(task: Pick<Task, 'stageEntry' | 'scripted'>, expected: { entryId: string; executionId: string; attemptId?: string }): boolean {
  const control = task.scripted;
  return ownsScriptedEntry(task) && control?.entryId === expected.entryId && control.executionId === expected.executionId && (expected.attemptId === undefined || control.attemptId === expected.attemptId);
}
export function acceptsScriptedResult(task: Pick<Task, 'stageEntry' | 'scripted'>, expected: { entryId: string; executionId: string; attemptId: string }): boolean {
  return scriptedCurrent(task, expected) && task.scripted?.phase === 'active' && task.scripted.result === undefined;
}
export function scriptedActive(control: Pick<ScriptedControl, 'phase'> | undefined): boolean { return control?.phase === 'active' || control?.phase === 'stopping'; }

/** Resolve a captured identity, never a newly reused authored identifier. */
export function resolveScriptedTarget(board: Pick<Board, 'workflow' | 'localStageIdentities'>, target: ScriptedTarget): Column | undefined {
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
export function captureScriptedTargets(board: Pick<Board, 'workflow' | 'localStageIdentities'>, column: Column, allocate: () => string): Record<string, ScriptedTarget> {
  if (column.scripted === undefined) return {};
  return Object.fromEntries(Object.entries(column.scripted.exits).map(([name, columnId]) => [name, { columnId, stageIdentity: ensureLocalStageIdentity(board, columnId, allocate) }]));
}
/** Called only by actual entry placement or creation, inside the caller's transaction. */
export function establishStageEntry(task: Task, column: Column, stageIdentity: string, at: string, allocate: () => string, targets?: Record<string, ScriptedTarget>, parameters?: Readonly<Record<string, string>>): void {
  const entryId = allocate();
  task.stageEntry = { id: entryId, columnId: column.id, stageIdentity, enteredAt: at };
  delete task.scriptedHandoff;
  if (column.scripted === undefined) { delete task.scripted; return; }
  task.scripted = { entryId, executionId: allocate(), stageIdentity, definition: structuredClone(column.scripted), ...(targets === undefined ? {} : { targets }), ...(parameters === undefined ? {} : { parameters: { ...parameters } }), phase: 'capture-pending', startedAt: at, attempt: 0, restartCount: 0 };
  delete task.instructionPending;
}
