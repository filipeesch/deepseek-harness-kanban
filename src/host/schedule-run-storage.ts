import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { absolutePath, id, nonempty, timestamp } from '../domain/schema-parts.js';

const runProblem = z.strictObject({
  code: nonempty, message: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** Durable shape of one schedule's runtime state; never part of the Hub revision. */
export const ScheduleRunRecordSchema = z.strictObject({
  version: z.literal(1),
  hubId: id,
  scheduleId: id,
  /** The session the run created or reused, recorded before any prompt is sent. */
  running: z.strictObject({ startedAt: timestamp, manual: z.boolean(), sessionId: id.optional() }).optional(),
  lastRun: z.strictObject({
    status: z.enum(['sent', 'failed']),
    at: timestamp,
    manual: z.boolean(),
    sessionId: id.optional(),
    error: runProblem.optional(),
    /** Present when the conversation could not be archived; the delivery outcome is unchanged. */
    archiveError: runProblem.optional(),
  }).optional(),
  /** The project the continuous conversation was created for. */
  continuousSession: z.strictObject({ sessionId: id, projectId: id, projectPath: absolutePath }).optional(),
  /** Legacy pre-release binding without a project; it is treated as stale and replaced. */
  continuousSessionId: id.optional(),
});
export type ScheduleRunRecord = z.infer<typeof ScheduleRunRecordSchema>;

/** Convert a thrown value into the JSON-safe last-run failure shape. */
export function scheduleRunProblem(error: unknown): { code: string; message: string; details?: Record<string, string | number | boolean> } {
  const source: unknown = typeof error === 'object' && error !== null ? error : undefined;
  const record = source as { code?: unknown; message?: unknown; details?: unknown } | undefined;
  const details: Record<string, string | number | boolean> = {};
  if (typeof record?.details === 'object' && record.details !== null) {
    for (const [key, value] of Object.entries(record.details as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details[key] = value;
      else if (value !== undefined && value !== null) details[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }
  return {
    code: typeof record?.code === 'string' && record.code.trim() ? record.code : 'SCHEDULE_RUN_FAILED',
    message: typeof record?.message === 'string' && record.message.trim() ? record.message : 'The scheduled occurrence failed.',
    ...(Object.keys(details).length === 0 ? {} : { details }),
  };
}

/** Durable read/write surface owned by the host, never by the Hub record. */
export interface ScheduleRunStorage {
  load(scheduleId: string): ScheduleRunRecord | undefined;
  loadAll(): ScheduleRunRecord[];
  /** Persist one record and return the stored value. */
  save(record: ScheduleRunRecord): Promise<void>;
  delete(scheduleId: string): Promise<void>;
}

/** Open the schedule runtime domain; the caller owns the returned close. */
export async function openScheduleRunStorage(ctx: Context): Promise<{ storage: ScheduleRunStorage; close: () => Promise<void> }> {
  const spec = defineDomain({
    name: 'kanban_schedule_runs',
    version: 1,
    layout: 'per-record',
    tables: { runs: domainTable<string, ScheduleRunRecord>(ScheduleRunRecordSchema as unknown as z.ZodType<ScheduleRunRecord>) },
  });
  const domain = await ctx.storageDomain.open(spec);
  const table = domain.table('runs');
  return {
    storage: {
      load: scheduleId => {
        const value = table.get(scheduleId);
        return value === undefined ? undefined : structuredClone(value);
      },
      loadAll: () => [...table.entries()].map(([, value]) => structuredClone(value)),
      save: async record => { await table.put(record.scheduleId, structuredClone(record)); },
      delete: async scheduleId => { await table.delete(scheduleId); },
    },
    close: () => domain.close(),
  };
}
