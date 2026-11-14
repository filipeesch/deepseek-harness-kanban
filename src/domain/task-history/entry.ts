import { z } from 'zod';
import { AUTO_MODE_HISTORY_ACTIONS, WORKTREE_HISTORY_ACTIONS, type TaskHistoryEntry } from '../../shared/task-history.js';
import { parameterValuesSchema } from '../deterministic-state.js';
import { isDomainId } from '../validation.js';

/** The validated shape of one task's flow record. */
const identifier = z.string().refine(isDomainId, 'Expected a safe identifier.');
const moment = z.string().datetime({ offset: true });
const failure = z.strictObject({ code: z.string().min(1), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
const stageOrigin = z.string().regex(/^(?:manual|agent|auto|(?:script|error):[A-Za-z][A-Za-z0-9_-]*)$/, 'Expected a stage entry origin.');

export const taskHistoryEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deterministic-execution'), at: moment, executionId: identifier, columnId: identifier, outcome: z.enum(['completed', 'stopped', 'failed']), exit: z.string().optional(), message: z.string().optional(), error: failure.optional(), parameters: parameterValuesSchema.optional() }),
  z.strictObject({ kind: z.literal('deterministic-handoff'), at: moment, deliveryId: identifier, executionId: identifier, fromColumnId: identifier, columnId: identifier, outcome: z.enum(['accepted', 'failed']), exit: z.string(), message: z.string(), parameters: parameterValuesSchema.optional(), error: failure.optional() }),
  z.strictObject({ kind: z.literal('created'), at: moment, columnId: identifier }),
  z.strictObject({ kind: z.literal('stage'), at: moment, fromColumnId: identifier, columnId: identifier, origin: stageOrigin.optional() }),
  z.strictObject({ kind: z.literal('intent'), at: moment, fromColumnId: identifier, columnId: identifier }),
  z.strictObject({
    kind: z.literal('auto-mode'), at: moment, action: z.enum(AUTO_MODE_HISTORY_ACTIONS),
    reason: z.string().min(1).optional(), message: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('worktree'), at: moment, action: z.enum(WORKTREE_HISTORY_ACTIONS),
    path: z.string().min(1).optional(), branch: z.string().min(1).optional(), error: failure.optional(),
  }),
]);

/**
 * The pairing each entry must satisfy beyond its shape: the codec validates a
 * kind's fields independently, so what one field requires of another is checked
 * here instead of being inferred by whatever reads the record.
 */
export function taskHistoryIssue(entry: TaskHistoryEntry): string | null {
  // A stage and an intent no longer require two different identifiers: renaming a
  // stage to an identifier a removed one used rewrites history into the same
  // identifier on both sides, which is the truthful result of that rename. The
  // record's write path still refuses a placement that changes no stage.
  if ((entry.kind === 'deterministic-execution' || entry.kind === 'deterministic-handoff') && entry.outcome === 'failed' && entry.error === undefined) return 'A failed deterministic outcome requires its diagnostic.';
  if (entry.kind === 'auto-mode') {
    const paused = entry.action === 'paused' || entry.action === 'agent-paused';
    if (paused && (entry.reason === undefined || entry.reason.trim().length === 0)) return 'A pause entry requires the reason that paused it.';
    if (!paused && entry.reason !== undefined) return 'Only a pause entry carries a reason.';
    if (entry.message !== undefined && entry.action !== 'paused') return 'Only a host pause entry carries a message.';
  }
  if (entry.kind === 'worktree') {
    if (entry.action === 'failed') {
      if (entry.error === undefined) return 'A failed operation entry requires the failure that ended it.';
    } else if (entry.path === undefined) return 'A worktree outcome entry requires the checkout path it acted on.';
    if (entry.action === 'created' && entry.branch === undefined) return 'A created worktree entry requires its branch.';
  }
  return null;
}

/** The stored flow record: an ordered list whose entries are each coherent. */
export const taskHistorySchema = z.array(taskHistoryEntrySchema).superRefine((entries, context) => {
  entries.forEach((value, index) => {
    const issue = taskHistoryIssue(value as TaskHistoryEntry);
    if (issue !== null) context.addIssue({ code: 'custom', path: [index], message: issue });
  });
});
