import { initialState } from '../../src/domain/schema.js';
import type { BoardState, HubState, KanbanMeta } from '../../src/shared/types.js';

/** Minimal storage-domain facility for host tests that mount the real plugin. */
export function fakeKanbanStorage() {
  const hubs = new Map<string, HubState>();
  const meta: KanbanMeta = { initializedAt: new Date(0).toISOString(), settingsRevision: 0 };
  let legacy: BoardState = initialState();
  const questionTables = new Map<string, Map<string, unknown>>();
  const table = (records: Map<string, unknown>) => ({
    get: (key: string) => records.get(key),
    entries: () => records.entries(),
    keys: () => records.keys(),
    get size() { return records.size; },
    put: async (key: string, value: unknown) => { records.set(key, structuredClone(value)); },
    delete: async (key: string) => records.delete(key),
    update: async () => { throw new Error('unused'); },
  });
  return {
    hubs,
    meta,
    get legacy() { return legacy; },
    facility: {
      async open(spec: { name: string }) {
        if (spec.name === 'kanban_hubs') return {
          name: spec.name,
          global: { get: () => structuredClone(meta), set: async (value: KanbanMeta) => { Object.assign(meta, structuredClone(value)); } },
          table: (name: string) => { if (name !== 'hubs') throw new Error('Unknown table ' + name); return table(hubs as unknown as Map<string, unknown>); },
          close: async () => {},
        };
        if (spec.name === 'kanban') return {
          name: spec.name,
          global: { get: () => structuredClone(legacy), set: async (value: BoardState) => { legacy = structuredClone(value); } },
          close: async () => {},
        };
        const records = questionTables.get(spec.name) ?? new Map<string, unknown>();
        questionTables.set(spec.name, records);
        return { name: spec.name, table: () => table(records), close: async () => {} };
      },
    },
  };
}
