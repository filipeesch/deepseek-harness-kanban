import { z } from 'zod';
import type { Column, Task } from '../shared/types.js';
import type { ScriptedControl, ScriptedTarget } from '../shared/scripted.js';
import { SCRIPTED_HOLD_CODES, SCRIPTED_PHASES } from '../shared/scripted.js';
import { PENDING_USER_WORK_KINDS } from './pending-user-work.js';
import { PARAMETER_LIMITS, PARAMETER_NAME, scriptedDefinitionSchema } from './scripted-definition.js';
import { parameterValuesProblem } from './scripted-parameters.js';
import { isDomainId, isAbsolutePath } from './validation.js';
import { stageTargetSchema } from './stage-identity.js';

const id = z.string().refine(isDomainId);
const timestamp = z.string().datetime({ offset: true });
const problem = z.strictObject({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
export const taskStageEntrySchema = z.strictObject({ id, columnId: id, stageIdentity: id, enteredAt: timestamp });
/** The durable value set: declared-shaped names within the accepted bounds; undeclared extras are allowed after a declaration edit. */
export const parameterValuesSchema = z.record(z.string().regex(PARAMETER_NAME), z.string().min(1).max(PARAMETER_LIMITS.valueLength)).superRefine((values, context) => {
  const issue = parameterValuesProblem(values);
  if (issue !== null) context.addIssue({ code: 'custom', message: issue });
});
export const scriptedCaptureSchema = z.strictObject({
  sourceRef: z.string().min(1), fingerprint: z.string().min(1), language: z.enum(['bash', 'typescript']), directory: z.enum(['task', 'project']),
  executionDirectory: z.string().refine(isAbsolutePath), source: z.strictObject({ kind: z.enum(['inline', 'file']), path: z.string().optional(), reference: z.string().optional() }),
  env: z.array(z.string()), params: z.array(z.string().regex(PARAMETER_NAME)).max(PARAMETER_LIMITS.count), exits: z.record(z.string(), stageTargetSchema),
});
/** Bounded hold facts: at most three background items with bounded labels and unique pending kinds. */
export const scriptedHoldSchema = z.strictObject({
  code: z.enum(SCRIPTED_HOLD_CODES), at: timestamp,
  background: z.array(z.strictObject({ kind: z.enum(['job', 'schedule']), id: z.string().min(1).max(128).optional(), label: z.string().min(1).max(200) })).max(3).optional(),
  pending: z.array(z.enum(PENDING_USER_WORK_KINDS)).max(PENDING_USER_WORK_KINDS.length).optional(),
});
export const scriptedResultSchema = z.strictObject({ id, exit: z.string(), message: z.string(), at: timestamp, params: parameterValuesSchema.optional(), target: stageTargetSchema.optional(), synthetic: z.boolean().optional(), deliveryId: id.optional(), deliveryStatus: z.enum(['pending', 'accepted', 'failed']).optional(), error: problem.optional() });
export const scriptedControlSchema = z.strictObject({
  entryId: id, executionId: id, stageIdentity: id, definition: scriptedDefinitionSchema, targets: z.record(z.string(), stageTargetSchema).optional(),
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

/** Called only by actual entry placement or creation, inside the caller's transaction. */
export function establishStageEntry(task: Task, column: Column, stageIdentity: string, at: string, allocate: () => string, targets?: Record<string, ScriptedTarget>, parameters?: Readonly<Record<string, string>>): void {
  const entryId = allocate();
  task.stageEntry = { id: entryId, columnId: column.id, stageIdentity, enteredAt: at };
  delete task.scriptedHandoff;
  if (column.scripted === undefined) { delete task.scripted; return; }
  task.scripted = { entryId, executionId: allocate(), stageIdentity, definition: structuredClone(column.scripted), ...(targets === undefined ? {} : { targets }), ...(parameters === undefined ? {} : { parameters: { ...parameters } }), phase: 'capture-pending', startedAt: at, attempt: 0, restartCount: 0 };
  delete task.instructionPending;
}
