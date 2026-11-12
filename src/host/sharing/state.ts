import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { SharedHubManifest } from '../../domain/sharing/manifest.js';
import { readSharedConfiguration, serializeSharedManifest, sharedManifestToken, SHARED_MANIFEST_VERSION, SharedHubManifestSchema, SHARED_MANIFEST_FILE } from '../../domain/sharing/manifest.js';
import type { OrphanMap, BoardBindings } from '../../domain/sharing/identity.js';
import { KanbanError } from '../../shared/errors.js';
import { SHARING_STORAGES } from '../../shared/types.js';
import type { ProviderState, SharingBinding } from './provider.js';
import { isSharingProviderId } from './provider.js';

/** One manifest the installation read or applied, with its content token. */
export interface StoredManifest { token: string; manifest: SharedHubManifest }

/** What this installation observed and applied for one board. */
export interface StoredBoard {
  /** The last sequence applied to the local board. */
  seq: number;
  /** The head the append must match. */
  head: string | null;
  /** The cheap probe the last check saw. */
  probe: string | null;
  /** How many published events this installation has not applied. */
  behind: number;
  /** The digest of the board's published workflow, so a local edit is visible as a draft. */
  published: string | null;
  /**
   * The published workflow text, kept only while the board needs a choice, so the
   * review panel can show both versions without reading the storage.
   */
  publishedText?: string | null;
  /** The local board differs from the published board, so a publish is due. */
  draft: boolean;
  /** Applying this board requires a choice before it can proceed. */
  conflict: 'identity' | 'lifecycle' | null;
  /** A board-local format error must not block observation of other boards. */
  problem?: { code: string; message: string } | null;
}

/** One Hub's local publishing state. A record exists only while the Hub is published. */
export interface HubSharingRecord {
  version: 3;
  hubId: string;
  binding: SharingBinding;
  providerState: ProviderState;
  /** Hub revision whose content is present in the last published configuration. */
  syncedRevision: number | null;
  /** The last manifest this installation applied. */
  base: StoredManifest | null;
  /** The last manifest read from the provider. */
  seen: StoredManifest | null;
  /** The manifest read during connect, waiting for receive or publish-initial. */
  preview: StoredManifest | null;
  bindings: BoardBindings;
  orphans: OrphanMap;
  /** Keys removed only from this installation; the team manifest keeps them. */
  removed: Record<string, { boardId: string; name: string }>;
  /** Keys this installation will drop from the team manifest on the next publish. */
  pendingRemovals: string[];
  /** What was observed and applied per board key. */
  boards: Record<string, StoredBoard>;
  lastCheck: { at: string; token: string } | null;
  lastSyncedAt?: string | null;
  reviewRequired?: { code: string; message: string } | null;
  storageReview?: { code: string; message: string; files: string[] } | null;
  lastError: { code: string; message: string } | null;
}

const storedBoard = z.strictObject({
  seq: z.number().int().min(0),
  published: z.string().min(1).nullable().optional(),
  publishedText: z.string().nullable().optional(),
  head: z.string().min(1).nullable(),
  probe: z.string().min(1).nullable(),
  behind: z.number().int().min(0),
  draft: z.boolean(),
  conflict: z.enum(['identity', 'lifecycle']).nullable(),
  problem: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
});
const storedManifest = z.strictObject({ token: z.string().min(1), manifest: SharedHubManifestSchema });
const binding = z.strictObject({
  provider: z.enum(SHARING_STORAGES),
  intervalMinutes: z.number().int().min(0).max(1440),
  settings: z.record(z.string(), z.string()),
});
const v3Record = z.strictObject({
  version: z.literal(3),
  hubId: z.string().min(1),
  binding,
  providerState: z.record(z.string(), z.unknown()),
  syncedRevision: z.number().int().nonnegative().nullable(),
  base: storedManifest.nullable(),
  seen: storedManifest.nullable(),
  preview: storedManifest.nullable(),
  bindings: z.record(z.string(), z.string()),
  orphans: z.record(z.string(), z.strictObject({ lastKey: z.string().min(1), lastPublishedName: z.string().min(1) })),
  removed: z.record(z.string(), z.strictObject({ boardId: z.string().min(1), name: z.string().min(1) })),
  pendingRemovals: z.array(z.string()),
  boards: z.record(z.string(), storedBoard),
  lastCheck: z.strictObject({ at: z.string().min(1), token: z.string().min(1) }).nullable(),
  lastSyncedAt: z.string().min(1).nullable().optional(),
  reviewRequired: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  storageReview: z.strictObject({ code: z.string().min(1), message: z.string(), files: z.array(z.string()) }).nullable().optional(),
  lastError: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});

/** The shape every previous version stored, read only to migrate it. */
const legacyDocument = z.strictObject({
  version: z.number().int().positive(),
  boards: z.array(z.object({ key: z.string(), name: z.string(), projectKeys: z.array(z.string()).optional() }).passthrough()),
});
const legacyStoredDocument = z.strictObject({ token: z.string().min(1), document: legacyDocument });
const legacyRecord = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  hubId: z.string().min(1),
  binding: z.object({ provider: z.string(), intervalMinutes: z.number().int().min(0).max(1440), settings: z.record(z.string(), z.string()).optional(), repository: z.string().optional() }).passthrough(),
  providerState: z.record(z.string(), z.unknown()).optional(),
  syncedRevision: z.number().int().nonnegative().nullable().optional(),
  base: legacyStoredDocument.nullable(),
  seen: legacyStoredDocument.nullable(),
  preview: legacyStoredDocument.nullable(),
  bindings: z.record(z.string(), z.string()),
  orphans: z.record(z.string(), z.strictObject({ lastKey: z.string().min(1), lastPublishedName: z.string().min(1) })),
  removed: z.record(z.string(), z.strictObject({ boardId: z.string().min(1), name: z.string().min(1) })),
  pendingRemovals: z.array(z.string()),
  lastCheck: z.strictObject({ at: z.string().min(1), token: z.string().min(1) }).nullable(),
  lastSyncedAt: z.string().min(1).nullable().optional(),
  reviewRequired: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  storageReview: z.strictObject({ code: z.string().min(1), message: z.string(), files: z.array(z.string()) }).nullable().optional(),
  lastError: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});

export const HubSharingRecordSchema: z.ZodType<HubSharingRecord> = v3Record as unknown as z.ZodType<HubSharingRecord>;

/** The manifest a previously stored document described. */
function manifestOf(document: z.infer<typeof legacyDocument>): StoredManifest {
  const read = readSharedConfiguration(serializeSharedManifest({ version: SHARED_MANIFEST_VERSION, boards: document.boards.map(entry => ({ key: entry.key, name: entry.name, ...(entry.projectKeys === undefined ? {} : { projectKeys: entry.projectKeys }) })) }));
  return { token: sharedManifestToken(read.manifest), manifest: read.manifest };
}

/** Read the current record shape, or migrate one written before per-board publishing. */
export function migrateSharingRecord(raw: unknown): HubSharingRecord | undefined {
  const current = v3Record.safeParse(raw);
  if (current.success) {
    const record = current.data as HubSharingRecord;
    for (const [key, board] of Object.entries(record.boards)) {
      record.boards[key] = { ...board, published: board.published ?? null, publishedText: board.publishedText ?? null };
    }
    return record;
  }
  const legacy = legacyRecord.safeParse(raw);
  if (!legacy.success) return undefined;
  const provider = legacy.data.binding.provider;
  if (!isSharingProviderId(provider)) return undefined;
  const settings = legacy.data.binding.settings ?? (legacy.data.binding.repository === undefined ? {} : { repository: legacy.data.binding.repository });
  return {
    version: 3,
    hubId: legacy.data.hubId,
    binding: { provider, intervalMinutes: legacy.data.binding.intervalMinutes, settings },
    providerState: legacy.data.providerState ?? {},
    syncedRevision: legacy.data.syncedRevision ?? null,
    base: legacy.data.base === null ? null : manifestOf(legacy.data.base.document),
    seen: legacy.data.seen === null ? null : manifestOf(legacy.data.seen.document),
    preview: legacy.data.preview === null ? null : manifestOf(legacy.data.preview.document),
    bindings: legacy.data.bindings,
    orphans: legacy.data.orphans,
    removed: legacy.data.removed,
    pendingRemovals: legacy.data.pendingRemovals,
    boards: {},
    lastCheck: legacy.data.lastCheck,
    lastSyncedAt: legacy.data.lastSyncedAt ?? null,
    reviewRequired: legacy.data.reviewRequired ?? null,
    storageReview: legacy.data.storageReview ?? null,
    lastError: legacy.data.lastError,
  };
}

export interface HubSharingStore {
  load(hubId: string): HubSharingRecord | undefined;
  list(): HubSharingRecord[];
  save(record: HubSharingRecord): Promise<void>;
  delete(hubId: string): Promise<void>;
  close(): Promise<void>;
}

/** A board cursor with no observation yet, which is what a fresh binding starts from. */
export function emptyBoard(): StoredBoard {
  return { seq: 0, head: null, probe: null, behind: 0, published: null, publishedText: null, draft: false, conflict: null };
}

/**
 * Durable publishing state, independent from the Hub aggregate. Records are
 * validated on read; a corrupt record is quarantined with a typed error rather
 * than preventing the Hub domain from opening.
 */
export async function openSharingStorage(ctx: Context, options: { report?: (error: unknown) => void } = {}): Promise<{ storage: HubSharingStore; close: () => Promise<void> }> {
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'kanban_sharing',
    version: 1,
    layout: 'per-record',
    tables: { records: domainTable<string, unknown>(z.unknown()) },
  }));
  const table = domain.table('records');
  const records = new Map<string, HubSharingRecord>();
  for (const [hubId, raw] of table.entries()) {
    const parsed = migrateSharingRecord(raw);
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

export { SHARED_MANIFEST_FILE };
