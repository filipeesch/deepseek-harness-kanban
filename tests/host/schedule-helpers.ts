import type { Context } from '@deepseek-ai/cordis';
import { openScheduleRunStorage, type ScheduleRunStorage } from '../../src/host/schedule-run-storage.js';

/** In-memory storage-domain facility for one schedule runtime store. */
export function scheduleRunFacility() {
  const specs: Array<{ name: string; version: number; layout?: string }> = [];
  const state = new Map<string, Map<string, Map<string, unknown>>>();
  return {
    specs,
    async open(spec: { name: string; version: number; layout?: string; tables: Record<string, unknown> }) {
      specs.push(spec);
      let tables = state.get(spec.name);
      if (!tables) {
        tables = new Map();
        for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
        state.set(spec.name, tables);
      }
      return {
        name: spec.name,
        table(name: string) {
          const map = tables!.get(name);
          if (!map) throw new Error('Unknown table ' + name);
          return {
            get: (key: string) => map.get(key),
            entries: () => map.entries(),
            keys: () => map.keys(),
            get size() { return map.size; },
            put: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); },
            delete: async (key: string) => map.delete(key),
            update: async () => { throw new Error('unused'); },
          };
        },
        async close() {},
      };
    },
  };
}

export async function memoryRunStorage(): Promise<{ storage: ScheduleRunStorage; close: () => Promise<void> }> {
  const ctx = { storageDomain: scheduleRunFacility() } as unknown as Context;
  return openScheduleRunStorage(ctx);
}
