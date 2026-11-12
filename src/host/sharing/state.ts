import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { SharingBinding, ProviderState } from './provider.js';
import { isSharingProviderId } from './provider.js';
import type { BoardBindings, OrphanMap } from '../../domain/sharing/identity.js';
import { KanbanError } from '../../shared/errors.js';
import { SHARING_STORAGES } from '../../shared/types.js';

/** What this installation last applied for one board, plus what the last check observed. */
export interface StoredBoard {
  /** The last sequence applied. */
  seq: number;
  /** The head token the last append must match. */
  head: string | null;
  /** The cheap probe the last check saw. */
  probe: string | null;
  /** Whether the storage enumerated this board's log at the last observation. */
  present: boolean;
  /** The applied authored workflow. */
  workflow: string | null;
  /** The applied board name. */
  name: string | null;
  /** The applied project scope; null means the board allows every project. */
  projectKeys: string[] | null;
  /** The applied position in the Hub's board order. */
  rank: string | null;
  /** Published events observed beyond the cursor. */
  updates: number;
  /** The observed log carries a removal event this installation has not applied. */
  removal: boolean;
  /** The team's text that could not be applied, while the board needs a choice. */
  incoming: string | null;
  /** Applying this board requires a choice before it can proceed. */
  conflict: 'identity' | 'lifecycle' | null;
  /** A board-local format error must not block observation of other boards. */
  problem: { code: string; message: string } | null;
}

/** One board as the last check enumerated it. */
export interface PublishedBoard { key: string; name: string; rank: string | null; removed: boolean }

/** One published board read at connection time, so the choice can name what differs. */
export interface PreviewBoard { key: string; name: string; projectKeys: string[] | null; rank: string | null; workflow: string }

/** One Hub's local publishing state. A record exists only while the Hub is published. */
export interface HubSharingRecord {
  version: 4;
  hubId: string;
  binding: SharingBinding;
  providerState: ProviderState;
  bindings: BoardBindings;
  orphans: OrphanMap;
  /** Keys removed only from this installation; the team still carries them. */
  removed: Record<string, { boardId: string; name: string }>;
  /** Keys whose removal this installation still owes the team a removal event for. */
  pendingRemovals: Record<string, { name: string }>;
  /** What this installation applied, per published board key. */
  boards: Record<string, StoredBoard>;
  /** The published set as the last check enumerated it. */
  published: Record<string, PublishedBoard>;
  /** The published boards read during connect, waiting for receive or publish-initial. */
  preview: { boards: PreviewBoard[] } | null;
  /** Something the connection must report without failing, such as an abandoned older layout. */
  notice?: { code: string; message: string } | null;
  lastCheck: { at: string; token: string } | null;
  lastSyncedAt: string | null;
  reviewRequired?: { code: string; message: string } | null;
  storageReview?: { code: string; message: string; files: string[] } | null;
  lastError: { code: string; message: string } | null;
}

const storedBoard = z.strictObject({
  seq: z.number().int().min(-1),
  head: z.string().min(1).nullable(),
  probe: z.string().min(1).nullable(),
  present: z.boolean(),
  workflow: z.string().nullable(),
  name: z.string().nullable(),
  projectKeys: z.array(z.string()).nullable(),
  rank: z.string().nullable(),
  updates: z.number().int().min(0),
  removal: z.boolean(),
  incoming: z.string().nullable(),
  conflict: z.enum(['identity', 'lifecycle']).nullable(),
  problem: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});
const publishedBoard = z.strictObject({
  key: z.string().min(1), name: z.string().min(1), rank: z.string().nullable(), removed: z.boolean(),
});
const previewBoard = z.strictObject({
  key: z.string().min(1), name: z.string().min(1), projectKeys: z.array(z.string()).nullable(), rank: z.string().nullable(), workflow: z.string().min(1),
});
const binding = z.strictObject({
  provider: z.enum(SHARING_STORAGES),
  intervalMinutes: z.number().int().min(0).max(1440),
  settings: z.record(z.string(), z.string()),
});
const recordSchema = z.strictObject({
  version: z.literal(4),
  hubId: z.string().min(1),
  binding,
  providerState: z.record(z.string(), z.unknown()),
  bindings: z.record(z.string(), z.string()),
  orphans: z.record(z.string(), z.strictObject({ lastKey: z.string().min(1), lastPublishedName: z.string().min(1) })),
  removed: z.record(z.string(), z.strictObject({ boardId: z.string().min(1), name: z.string().min(1) })),
  pendingRemovals: z.record(z.string(), z.strictObject({ name: z.string().min(1) })),
  boards: z.record(z.string(), storedBoard),
  published: z.record(z.string(), publishedBoard),
  preview: z.strictObject({ boards: z.array(previewBoard) }).nullable(),
  notice: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  lastCheck: z.strictObject({ at: z.string().min(1), token: z.string().min(1) }).nullable(),
  lastSyncedAt: z.string().min(1).nullable(),
  reviewRequired: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  storageReview: z.strictObject({ code: z.string().min(1), message: z.string(), files: z.array(z.string()) }).nullable().optional(),
  lastError: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});

export const HubSharingRecordSchema: z.ZodType<HubSharingRecord> = recordSchema as unknown as z.ZodType<HubSharingRecord>;

/** A board this installation never observed: nothing applied, nothing pending. */
export function emptyBoard(): StoredBoard {
  return { seq: -1, head: null, probe: null, present: false, workflow: null, name: null, projectKeys: null, rank: null, updates: 0, removal: false, incoming: null, conflict: null, problem: null };
}

/** A record for a Hub that is being connected. */
export function emptyRecord(hubId: string, binding: SharingBinding, at: string): HubSharingRecord {
  return {
    version: 4, hubId, binding, providerState: {},
    bindings: {}, orphans: {}, removed: {}, pendingRemovals: {}, boards: {}, published: {},
    preview: null, notice: null, lastCheck: { at, token: 'none' }, lastSyncedAt: null,
    reviewRequired: null, storageReview: null, lastError: null,
  };
}

/** Read the current record shape. A record from another layout version is ignored. */
export function readSharingRecord(raw: unknown): HubSharingRecord | undefined {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const record = parsed.data as HubSharingRecord;
  if (!isSharingProviderId(record.binding.provider)) return undefined;
  return record;
}

export interface HubSharingStore {
  load(hubId: string): HubSharingRecord | undefined;
  list(): HubSharingRecord[];
  save(record: HubSharingRecord): Promise<void>;
  delete(hubId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Durable publishing state, independent from the Hub aggregate. Records are validated
 * on read; a corrupt or older record is quarantined with a typed error rather than
 * preventing the Hub domain from opening.
 */
export async function openSharingStorage(ctx: Context, options: { report?: (error: unknown) => void } = {}): Promise<{ storage: HubSharingStore; close: () => Promise<void> }> {
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'kanban_sharing',
    version: 2,
    layout: 'per-record',
    tables: { records: domainTable<string, unknown>(z.unknown()) },
  }));
  const table = domain.table('records');
  const records = new Map<string, HubSharingRecord>();
  for (const [hubId, raw] of table.entries()) {
    const parsed = readSharingRecord(raw);
    if (!parsed || parsed.hubId !== hubId) {
      options.report?.(new KanbanError('SHARING_STORAGE_INVALID', 'Stored publishing state is invalid and was ignored.', { hubId }));
      continue;
    }
    records.set(hubId, parsed);
  }
  const storage: HubSharingStore = {
    load: hubId => { const value = records.get(hubId); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => {
      const parsed = HubSharingRecordSchema.safeParse(value);
      if (!parsed.success) throw new KanbanError('SHARING_STORAGE_INVALID', 'Refusing to store invalid publishing state.', { hubId: value.hubId });
      await table.put(value.hubId, structuredClone(parsed.data));
      records.set(value.hubId, structuredClone(parsed.data));
    },
    delete: async hubId => { await table.delete(hubId); records.delete(hubId); },
    close: () => domain.close(),
  };
  return { storage, close: () => domain.close() };
}