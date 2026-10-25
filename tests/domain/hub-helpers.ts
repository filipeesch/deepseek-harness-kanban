import type { HubStorage } from '../../src/shared/ports.js';
import type { HubState, KanbanMeta } from '../../src/shared/types.js';

export class MemoryHubStorage implements HubStorage {
  hubs = new Map<string, HubState>();
  meta: KanbanMeta = { settingsRevision: 0 };
  writes: string[] = [];
  metaWrites = 0;
  failLoad = false;
  failSave = false;
  failDelete = false;
  failMeta = false;
  async loadAll() {
    if (this.failLoad) throw new Error('Load failed.');
    return { hubs: [...this.hubs.values()].map(value => structuredClone(value)), meta: structuredClone(this.meta) };
  }
  async saveHub(state: HubState) {
    if (this.failSave) throw new Error('Disk is full.');
    this.hubs.set(state.id, structuredClone(state)); this.writes.push(state.id);
  }
  async deleteHub(id: string) {
    if (this.failDelete) throw new Error('Delete failed.');
    this.hubs.delete(id);
  }
  async saveMeta(meta: KanbanMeta) { if (this.failSave || this.failMeta) throw new Error('Disk is full.'); this.meta = structuredClone(meta); this.metaWrites++; }
  async close() {}
}

export function operationDeps() {
  let id = 0; let tick = 0;
  return {
    id: () => 'id-' + (++id),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  };
}

export function sampleHub(id = 'hub', name = 'Hub'): HubState {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id, name, revision: 0, projects: [{ id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/repo' }],
    boards: [{ id: 'board', name: 'Board', workflowYaml: 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n', workflow: { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: now, updatedAt: now }],
    tasks: [], notes: [], createdAt: now, updatedAt: now,
  };
}
