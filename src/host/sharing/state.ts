import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { SharedHubDocument } from '../../domain/sharing/document.js';
import { parseSharedDocument, serializeSharedDocument, SharedHubDocumentSchema } from '../../domain/sharing/document.js';
import type { OrphanMap, BoardBindings } from '../../domain/sharing/identity.js';
import { KanbanError } from '../../shared/errors.js';
import type { ProviderState, SharingBinding } from './provider.js';
import { isSharingProviderId } from './provider.js';

export interface StoredSharedDocument { token: string; document: SharedHubDocument }

/** One Hub's local publishing state. A record exists only while the Hub is published. */
export interface HubSharingRecord {
  version: 2;
  hubId: string;
  binding: SharingBinding;
  /** Provider-owned synchronization state, such as a Drive cursor and revision. */
  providerState: ProviderState;
  /** Hub revision whose content is present in the last published document. */
  syncedRevision: number | null;
  /** Last received (merged) document used for three-way comparison. */
  base: StoredSharedDocument | null;
  /** Last document read from the provider. */
  seen: StoredSharedDocument | null;
  bindings: BoardBindings;
  orphans: OrphanMap;
  /** Keys removed only from this installation; the team document keeps them. */
  removed: Record<string, { boardId: string; name: string }>;
  /** Keys this installation will drop from the team document on the next publish. */
  pendingRemovals: string[];
  /** The document read during connect, waiting for receive or publish-initial. */
  preview: StoredSharedDocument | null;
  lastCheck: { at: string; token: string } | null;
  /** Last successful publish or team-update application, not every readable check. */
  lastSyncedAt?: string | null;
  /** A concurrent write that still requires an explicit review, independent of transient errors. */
  reviewRequired?: { code: string; message: string } | null;
  lastError: { code: string; message: string } | null;
}

const storedDocument = z.strictObject({ token: z.string().min(1), document: SharedHubDocumentSchema });
const binding = z.strictObject({
  provider: z.enum(['git', 'google-drive']),
  intervalMinutes: z.number().int().min(0).max(1440),
  settings: z.record(z.string(), z.string()),
});
const v2Record = z.strictObject({
  version: z.literal(2),
  hubId: z.string().min(1),
  binding,
  providerState: z.record(z.string(), z.unknown()),
  syncedRevision: z.number().int().nonnegative().nullable(),
  base: storedDocument.nullable(),
  seen: storedDocument.nullable(),
  bindings: z.record(z.string(), z.string()),
  orphans: z.record(z.string(), z.strictObject({ lastKey: z.string().min(1), lastPublishedName: z.string().min(1) })),
  removed: z.record(z.string(), z.strictObject({ boardId: z.string().min(1), name: z.string().min(1) })),
  pendingRemovals: z.array(z.string()),
  preview: storedDocument.nullable(),
  lastCheck: z.strictObject({ at: z.string().min(1), token: z.string().min(1) }).nullable(),
  lastSyncedAt: z.string().min(1).nullable().optional(),
  reviewRequired: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  lastError: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});
const v1Binding = z.strictObject({ provider: z.literal('git'), repository: z.string().min(1), intervalMinutes: z.number().int().min(0).max(1440) });
const v1Record = z.strictObject({
  version: z.literal(1),
  hubId: z.string().min(1),
  binding: v1Binding,
  base: storedDocument.nullable(),
  seen: storedDocument.nullable(),
  bindings: z.record(z.string(), z.string()),
  orphans: z.record(z.string(), z.strictObject({ lastKey: z.string().min(1), lastPublishedName: z.string().min(1) })),
  removed: z.record(z.string(), z.strictObject({ boardId: z.string().min(1), name: z.string().min(1) })),
  pendingRemovals: z.array(z.string()),
  preview: storedDocument.nullable(),
  lastCheck: z.strictObject({ at: z.string().min(1), token: z.string().min(1) }).nullable(),
  lastSyncedAt: z.string().min(1).nullable().optional(),
  reviewRequired: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable().optional(),
  lastError: z.strictObject({ code: z.string().min(1), message: z.string() }).nullable(),
});

export const HubSharingRecordSchema: z.ZodType<HubSharingRecord> = v2Record as unknown as z.ZodType<HubSharingRecord>;

/** Read either the current record shape or the Git-only v1 shape. */
export function migrateSharingRecord(raw: unknown): HubSharingRecord | undefined {
  const current = v2Record.safeParse(raw);
  if (current.success) return current.data as HubSharingRecord;
  const legacy = v1Record.safeParse(raw);
  if (!legacy.success) return undefined;
  if (!isSharingProviderId(legacy.data.binding.provider)) return undefined;
  return {
    version: 2,
    hubId: legacy.data.hubId,
    binding: { provider: 'git', intervalMinutes: legacy.data.binding.intervalMinutes, settings: { repository: legacy.data.binding.repository } },
    providerState: {},
    syncedRevision: null,
    base: legacy.data.base,
    seen: legacy.data.seen,
    bindings: legacy.data.bindings,
    orphans: legacy.data.orphans,
    removed: legacy.data.removed,
    pendingRemovals: legacy.data.pendingRemovals,
    preview: legacy.data.preview,
    lastCheck: legacy.data.lastCheck,
    lastSyncedAt: null,
    reviewRequired: null,
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
  const validDocument = (value: StoredSharedDocument | null): boolean => {
    if (value === null) return true;
    try { parseSharedDocument(serializeSharedDocument(value.document)); return true; }
    catch { return false; }
  };
  for (const [hubId, raw] of table.entries()) {
    const parsed = migrateSharingRecord(raw);
    if (!parsed || parsed.hubId !== hubId || !validDocument(parsed.base) || !validDocument(parsed.seen) || !validDocument(parsed.preview)) {
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
