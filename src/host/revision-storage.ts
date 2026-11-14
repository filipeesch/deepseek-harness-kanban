import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { decodeRevisionLog, encodeRevisionLog, encodedRevisionLogSchema, type BoardRevisionLog, type EncodedRevisionLog } from '../domain/revisions/log.js';
import { KanbanError } from '../shared/errors.js';

const RevisionDomainSpec = defineDomain({
  name: 'kanban_revisions',
  version: 1,
  layout: 'per-record',
  tables: {
    logs: domainTable<string, EncodedRevisionLog>(encodedRevisionLogSchema),
  },
  global: {
    schema: z.strictObject({ initializedAt: z.string().datetime({ offset: true }).optional() }),
    initial: {},
  },
});

/** The one-record store shape this domain needs, so the wiring is testable without a host. */
export interface RevisionTablePort {
  get(key: string): EncodedRevisionLog | undefined;
  put(key: string, value: EncodedRevisionLog): Promise<void>;
  delete(key: string): Promise<unknown>;
  entries(): Iterable<[string, EncodedRevisionLog]>;
}

/** Durable storage for one board's local revision log. */
export interface RevisionStore {
  load(boardId: string): Promise<BoardRevisionLog | undefined>;
  save(log: BoardRevisionLog): Promise<void>;
  delete(boardId: string): Promise<void>;
  deleteHub(hubId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The revision store over one table. Records are written in the encoded form the
 * domain reads back, so a restart validates and decodes them instead of failing
 * on a record that was persisted in the in-memory shape.
 */
export function createRevisionStore(table: RevisionTablePort): RevisionStore {
  return {
    async load(boardId) {
      const value = table.get(boardId);
      if (value === undefined) return undefined;
      const decoded = decodeRevisionLog(value);
      if (decoded === undefined) throw new KanbanError('REVISION_LOG_UNREADABLE', 'The stored board revision log was written in a format this installation cannot read; it is reported instead of being treated as an absent history.');
      return decoded;
    },
    async save(log) {
      try { await table.put(log.boardId, encodeRevisionLog(log)); }
      catch (error) { throw new KanbanError('STORAGE_SAVE_FAILED', 'Could not durably save the board revision log: ' + (error instanceof Error ? error.message : String(error))); }
    },
    async delete(boardId) { await table.delete(boardId); },
    async deleteHub(hubId) {
      for (const [key, value] of table.entries()) if (value.hubId === hubId) await table.delete(key);
    },
    async close() {},
  };
}

/** Open the revision domain, which holds one record per board. */
export async function openRevisionStorage(ctx: Context): Promise<RevisionStore> {
  const domain = await ctx.storageDomain.open(RevisionDomainSpec);
  const store = createRevisionStore(domain.table('logs'));
  return { ...store, async close() { await domain.close(); } };
}
