import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { QuestionSessionRecord } from '../questions/indexer.js';
import type { StoredQuestionDraft } from '../shared/types.js';
import { QuestionPageSchema, StoredQuestionDraftSchema } from '../remote.js';

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
  dismissedTurns: z.array(turn).optional(),
}).strict();

/** Durable read/write surface owned by the host, never by a task record. */
export interface QuestionStore {
  load(sessionId: string): QuestionSessionRecord | undefined;
  save(sessionId: string, record: QuestionSessionRecord): Promise<void>;
  remove(sessionId: string): Promise<boolean>;
}

const roundId = z.string().min(1).max(200);
const stamp = z.string().min(1).max(64);

/**
 * Durable shape of one conversation's question drafts. Drafts live in their own
 * domain because they hold user text that is not in the transcript yet, while the
 * question projection is deliberately transcript-free derived metadata.
 */
export const QuestionDraftSessionRecordSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  drafts: z.record(roundId, StoredQuestionDraftSchema),
  updatedAt: stamp,
}).strict();

export interface QuestionDraftSessionRecord {
  version: 1;
  sessionId: string;
  drafts: Record<string, StoredQuestionDraft>;
  updatedAt: string;
}

/** Retention ordering data: one conversation's most recent draft write. */
export interface QuestionDraftRecordSummary { sessionId: string; updatedAt: string }

/** Narrow host-owned surface for form drafts; retention policy lives in the app. */
export interface QuestionDraftStore {
  load(sessionId: string): QuestionDraftSessionRecord | undefined;
  save(sessionId: string, record: QuestionDraftSessionRecord): Promise<void>;
  remove(sessionId: string): Promise<boolean>;
  records(): QuestionDraftRecordSummary[];
}

async function closeBoth(questions: { close(): Promise<void> }, drafts: { close(): Promise<void> }): Promise<void> {
  const [closedQuestions, closedDrafts] = await Promise.allSettled([questions.close(), drafts.close()]);
  if (closedQuestions.status === 'rejected') throw closedQuestions.reason;
  if (closedDrafts.status === 'rejected') throw closedDrafts.reason;
}

/** Open the conversation-scoped question projection and draft domains; the caller owns the returned close. */
export async function openQuestionStorage(ctx: Context): Promise<{ storage: QuestionStore; drafts: QuestionDraftStore; close: () => Promise<void> }> {
  const projectionSpec = defineDomain({
    name: 'kanban_questions',
    version: 1,
    layout: 'per-record',
    tables: { sessions: domainTable<string, QuestionSessionRecord>(QuestionSessionRecordSchema as unknown as z.ZodType<QuestionSessionRecord>) },
  });
  const draftSpec = defineDomain({
    name: 'kanban_question_drafts',
    version: 1,
    layout: 'per-record',
    tables: { sessions: domainTable<string, QuestionDraftSessionRecord>(QuestionDraftSessionRecordSchema as unknown as z.ZodType<QuestionDraftSessionRecord>) },
  });
  const projection = await ctx.storageDomain.open(projectionSpec);
  const openDrafts = async () => {
    try { return await ctx.storageDomain.open(draftSpec); }
    catch (error) { await projection.close(); throw error; }
  };
  const draftDomain = await openDrafts();
  const sessions = projection.table('sessions');
  const drafts = draftDomain.table('sessions');
  return {
    storage: {
      load: sessionId => {
        const value = sessions.get(sessionId);
        return value === undefined ? undefined : structuredClone(value);
      },
      save: async (sessionId, record) => { await sessions.put(sessionId, structuredClone(record)); },
      remove: async sessionId => sessions.delete(sessionId),
    },
    drafts: {
      load: sessionId => {
        const value = drafts.get(sessionId);
        return value === undefined ? undefined : structuredClone(value);
      },
      save: async (sessionId, record) => { await drafts.put(sessionId, structuredClone(record)); },
      remove: async sessionId => drafts.delete(sessionId),
      records: () => [...drafts.entries()].map(([sessionId, record]) => ({ sessionId, updatedAt: record.updatedAt })),
    },
    close: () => closeBoth(projection, draftDomain),
  };
}
