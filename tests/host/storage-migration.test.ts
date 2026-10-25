import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { initialState } from '../../src/domain/schema.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { openKanbanStorage } from '../../src/host/storage.js';
import type { BoardState, HubState, KanbanMeta } from '../../src/shared/types.js';

function facility() {
  const hubs = new Map<string, HubState>();
  const meta: KanbanMeta = { settingsRevision: 0 };
  let legacy: BoardState = initialState();
  let opens = 0;
  const table = (records: Map<string, unknown>) => ({
    get: (key: string) => records.get(key), entries: () => records.entries(), keys: () => records.keys(), size: records.size,
    put: async (key: string, value: unknown) => { records.set(key, structuredClone(value)); },
    delete: async (key: string) => records.delete(key), update: async () => { throw new Error('unused'); },
  });
  return {
    hubs, get meta() { return meta; }, get legacy() { return legacy; }, get opens() { return opens; },
    setLegacy(value: BoardState) { legacy = value; },
    ctx: {
      storageDomain: {
        open: async (spec: { name: string }) => {
          opens++;
          if (spec.name === 'kanban_hubs') return { global: { get: () => structuredClone(meta), set: async (value: KanbanMeta) => { Object.assign(meta, structuredClone(value)); } }, table: () => table(hubs as unknown as Map<string, unknown>), close: async () => {} };
          if (spec.name === 'kanban') return { global: { get: () => structuredClone(legacy), set: async (value: BoardState) => { legacy = structuredClone(value); } }, close: async () => {} };
          throw new Error('Unexpected domain ' + spec.name);
        },
      },
    } as unknown as Context,
  };
}

describe('Hub storage migration wiring', () => {
  it('migrates the legacy single-board domain once and leaves it untouched', async () => {
    const f = facility();
    const legacy = initialState();
    legacy.revision = 3;
    const legacyYaml = 'name: Legacy Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n';
    legacy.workflowYaml = legacyYaml; legacy.workflow = parseWorkflow(legacyYaml);
    legacy.projects = [{ id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/repo' }];
    legacy.tasks = [{ id: 'task', projectId: 'project', title: 'Legacy task', description: '', columnId: 'backlog', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    legacy.settings = { worktreeBasePath: '/trees' };
    f.setLegacy(legacy);
    const first = await openKanbanStorage(f.ctx, { now: () => '2026-02-01T00:00:00.000Z' });
    expect(f.hubs.get('default')).toMatchObject({ name: 'My Hub', tasks: [{ id: 'task', boardId: 'default-board' }], boards: [{ name: 'Legacy Flow' }] });
    expect(f.meta).toMatchObject({ initializedAt: '2026-02-01T00:00:00.000Z', worktreeBasePath: '/trees' });
    expect(f.legacy).toEqual(legacy);
    await first.close();
    const opensAfterFirst = f.opens;
    const second = await openKanbanStorage(f.ctx, { now: () => '2026-03-01T00:00:00.000Z' });
    expect(f.opens).toBe(opensAfterFirst + 1);
    expect(f.meta.initializedAt).toBe('2026-02-01T00:00:00.000Z');
    await second.close();
  });

  it('accepts the legacy version-one document and rejects archived cards', async () => {
    const f = facility(); const v1 = initialState() as unknown as Record<string, unknown>;
    v1.schemaVersion = 1;
    v1.workflowYaml = 'name: Legacy\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n';
    v1.workflow = parseWorkflow(v1.workflowYaml as string);
    v1.projects = [{ id: 'project', name: 'Project', projectPath: '/repo', gitRootPath: '/repo' }];
    const task = { id: 'task', projectId: 'project', title: 'Legacy', description: '', columnId: 'backlog', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', archivedAt: null };
    v1.tasks = [task];
    f.setLegacy(v1 as unknown as BoardState);
    const storage = await openKanbanStorage(f.ctx, { now: () => '2026-02-01T00:00:00.000Z' });
    expect(f.hubs.get('default')?.tasks[0]).toMatchObject({ id: 'task' });
    await storage.close();

    const archived = facility(); const invalid = structuredClone(v1); (invalid.tasks as Array<Record<string, unknown>>)[0]!.archivedAt = '2026-01-02T00:00:00.000Z'; archived.setLegacy(invalid as unknown as BoardState);
    await expect(openKanbanStorage(archived.ctx, { now: () => '2026-02-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVED_TASK' });
    expect(archived.meta.initializedAt).toBeUndefined();
  });

  it('rejects a version-one document whose task collection is not an array instead of dropping tasks', async () => {
    const f = facility(); const v1 = initialState() as unknown as Record<string, unknown>;
    v1.schemaVersion = 1;
    v1.workflowYaml = 'name: Legacy\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n';
    v1.workflow = parseWorkflow(v1.workflowYaml as string);
    v1.projects = [];
    v1.tasks = null;
    f.setLegacy(v1 as unknown as BoardState);
    await expect(openKanbanStorage(f.ctx, { now: () => '2026-02-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    expect(f.meta.initializedAt).toBeUndefined();
    expect(f.hubs.size).toBe(0);
  });

  it('does not initialize the new domain when the legacy state is invalid', async () => {
    const f = facility(); const invalid = initialState();
    invalid.tasks = [{ id: 'task', projectId: 'missing', title: 'Bad', description: '', columnId: 'backlog', position: 0, sessionIds: ['s'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    f.setLegacy(invalid);
    await expect(openKanbanStorage(f.ctx, { now: () => '2026-02-01T00:00:00.000Z' })).rejects.toBeTruthy();
    expect(f.meta.initializedAt).toBeUndefined();
    expect(f.hubs.size).toBe(0);
  });
});
