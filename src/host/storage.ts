import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { BoardStateSchema, initialState } from '../domain/schema.js';
import { HubStateSchema } from '../domain/hub-schema.js';
import type { BoardState, HubState, KanbanMeta } from '../shared/types.js';
import type { HubStorage, LegacyStateReader } from '../shared/ports.js';
import { KanbanError } from '../shared/errors.js';
import { migrateLegacyState } from './legacy-migration.js';

const current = () => new Date().toISOString();

const HubDomainSpec = defineDomain({
  name: 'kanban_hubs',
  version: 1,
  layout: 'per-record',
  tables: {
    hubs: domainTable<string, HubState>(HubStateSchema as unknown as z.ZodType<HubState>),
  },
  global: {
    schema: z.strictObject({
      initializedAt: z.string().datetime({ offset: true }).optional(),
      settingsRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      worktreeBasePath: z.string().optional(),
    }),
    initial: { settingsRevision: 0 },
  },
});

const LegacyGlobalSchema = z.unknown().refine(value => value !== null, 'Legacy Kanban state cannot be null.');

const LegacyDomainSpec = defineDomain({
  name: 'kanban',
  version: 1,
  layout: 'single',
  tables: {},
  global: {
    schema: LegacyGlobalSchema,
    initial: initialState(),
  },
});

type HubDomain = Domain<typeof HubDomainSpec>;
type LegacyDomain = Domain<typeof LegacyDomainSpec>;

function migratedV1State(raw: unknown): BoardState {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw) || (raw as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new KanbanError('UNSUPPORTED_VERSION', 'Stored Kanban state schema version is not supported.', { supportedVersion: 2 });
  }
  const state = structuredClone(raw) as Record<string, unknown>;
  if (!Array.isArray(state.tasks)) throw new KanbanError('UNSUPPORTED_VERSION', 'Stored task collection is not an array.', { supportedVersion: 2 });
  const tasks = state.tasks;
  for (const item of tasks) {
    if (!item || typeof item !== 'object' || !('archivedAt' in item)) continue;
    const archivedAt = (item as Record<string, unknown>).archivedAt;
    if (archivedAt !== null && archivedAt !== undefined) {
      throw new KanbanError('LEGACY_ARCHIVED_TASK', 'Stored task archive metadata is not supported by the delete-only lifecycle.', { taskId: (item as { id?: unknown }).id });
    }
  }
  state.schemaVersion = 2;
  state.tasks = tasks.map(item => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...(item as Record<string, unknown>) };
    delete copy.archivedAt;
    return copy;
  });
  return BoardStateSchema.parse(state);
}

class DomainHubStorage implements HubStorage {
  constructor(private readonly domain: HubDomain) {}

  async loadAll(): Promise<{ hubs: HubState[]; meta: KanbanMeta }> {
    const table = this.domain.table('hubs');
    const hubs = [...table.entries()].map(([, value]) => structuredClone(value));
    const meta = structuredClone(this.domain.global.get()) as KanbanMeta;
    return { hubs, meta };
  }

  async saveHub(state: HubState): Promise<void> {
    await this.domain.table('hubs').put(state.id, structuredClone(state));
  }

  async deleteHub(id: string): Promise<void> {
    await this.domain.table('hubs').delete(id);
  }

  async saveMeta(meta: KanbanMeta): Promise<void> {
    await this.domain.global.set(meta as never);
  }

  async close(): Promise<void> {
    await this.domain.close();
  }
}

class DomainLegacyReader implements LegacyStateReader {
  constructor(private readonly domain: LegacyDomain) {}
  async read(): Promise<BoardState> {
    const raw = this.domain.global.get();
    if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
      const version = (raw as { schemaVersion?: unknown }).schemaVersion;
      if (version === 2) return BoardStateSchema.parse(structuredClone(raw));
      if (version === 1) return migratedV1State(raw);
    }
    throw new KanbanError('UNSUPPORTED_VERSION', 'Stored Kanban state schema version is not supported.', { supportedVersion: 2 });
  }
  async close(): Promise<void> { await this.domain.close(); }
}

async function openLegacyState(ctx: Context): Promise<LegacyStateReader> {
  const domain = await ctx.storageDomain.open(LegacyDomainSpec);
  return new DomainLegacyReader(domain);
}

/**
 * Open the Hub domain and, when needed, migrate the untouched legacy document.
 * The legacy domain is read once and never written.
 */
export async function openKanbanStorage(ctx: Context, options: { legacy?: LegacyStateReader; now?: () => string } = {}): Promise<{ storage: HubStorage; close: () => Promise<void> }> {
  const domain = await ctx.storageDomain.open(HubDomainSpec);
  const storage = new DomainHubStorage(domain);
  const now = options.now ?? current;
  let legacy = options.legacy;
  let closeLegacy = false;
  try {
    const loaded = await storage.loadAll();
    if (loaded.meta.initializedAt === undefined) {
      if (loaded.hubs.length > 0) {
        // A previous migration may have persisted the Hub but not its metadata.
        // Recover the global setting when the legacy document is still readable;
        // the Hub data itself is already authoritative.
        let worktreeBasePath = loaded.meta.worktreeBasePath;
        if (worktreeBasePath === undefined) {
          try {
            if (!legacy) { legacy = await openLegacyState(ctx); closeLegacy = true; }
            worktreeBasePath = (await legacy.read()).settings?.worktreeBasePath;
          } catch { /* recovery is best effort; do not lose the migrated Hub */ }
        }
        await storage.saveMeta({ ...loaded.meta, initializedAt: now(), ...(worktreeBasePath ? { worktreeBasePath } : {}) });
      } else {
        if (!legacy) { legacy = await openLegacyState(ctx); closeLegacy = true; }
        const state = await legacy.read();
        const migrated = migrateLegacyState(state, { now });
        await storage.saveHub(migrated.hub);
        await storage.saveMeta(migrated.meta);
      }
    }
    return { storage, close: async () => { await storage.close(); } };
  } catch (error) {
    await domain.close().catch(() => undefined);
    throw error;
  } finally {
    if (closeLegacy && legacy) await legacy.close().catch(() => undefined);
  }
}
