import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { QuestionSessionRecord } from '../questions/indexer.js';
import { QuestionPageSchema } from '../remote.js';

const seq = z.number().int().nonnegative();
const turn = z.number().int().nonnegative();
const callId = z.string().min(1);
const QuestionEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), seq }).strict(),
  z.object({ kind: z.literal('end'), seq, turn }).strict(),
  z.object({ kind: z.literal('call'), seq, turn, callId, name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('native-page'), seq, turn, callId, page: QuestionPageSchema }).strict(),
  z.object({ kind: z.literal('ptc-start'), seq, callId, rootCallId: callId, parentCallId: callId }).strict(),
  z.object({ kind: z.literal('ptc-page'), seq, callId, rootCallId: callId, parentCallId: callId, page: QuestionPageSchema }).strict(),
]);

/** Durable shape of one conversation's question projection. */
export const QuestionSessionRecordSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  events: z.array(QuestionEventSchema),
}).strict();

/** Durable read/write surface owned by the host, never by a task record. */
export interface QuestionStore {
  load(sessionId: string): QuestionSessionRecord | undefined;
  save(sessionId: string, record: QuestionSessionRecord): Promise<void>;
}

/** Open the conversation-scoped question domain; the caller owns the returned close. */
export async function openQuestionStorage(ctx: Context): Promise<{ storage: QuestionStore; close: () => Promise<void> }> {
  const spec = defineDomain({
    name: 'kanban_questions',
    version: 1,
    layout: 'per-record',
    tables: { sessions: domainTable<string, QuestionSessionRecord>(QuestionSessionRecordSchema as unknown as z.ZodType<QuestionSessionRecord>) },
  });
  const domain = await ctx.storageDomain.open(spec);
  const table = domain.table('sessions');
  return {
    storage: {
      load: sessionId => {
        const value = table.get(sessionId);
        return value === undefined ? undefined : structuredClone(value);
      },
      save: async (sessionId, record) => { await table.put(sessionId, structuredClone(record)); },
    },
    close: () => domain.close(),
  };
}
