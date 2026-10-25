import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/domain/schema.js';
import { migrateLegacyState } from '../../src/host/legacy-migration.js';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
import type { BoardState } from '../../src/shared/types.js';

const now = () => '2026-01-01T00:00:00.000Z';

describe('legacy Kanban migration', () => {
  it('maps the untouched initial state to My Hub and a Kanban board', () => {
    const migrated = migrateLegacyState(initialState(), { now });
    expect(migrated.hub.name).toBe('My Hub');
    expect(migrated.hub.boards).toHaveLength(1);
    expect(migrated.hub.boards[0]!.name).toBe('Kanban');
    expect(migrated.meta.initializedAt).toBe(now());
    expect(HubStateSchema.safeParse(migrated.hub).success).toBe(true);
  });

  it('preserves workflow, projects, tasks, notes, sessions, worktrees, and the worktree base path', () => {
    const legacy = initialState() as BoardState & { workflow: BoardState['workflow'] };
    legacy.revision = 7;
    legacy.workflow = { ...legacy.workflow, name: 'OpenSpec Flow' };
    legacy.projects = [{ id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/repo' }];
    legacy.tasks = [{ id: 'task', projectId: 'project', title: 'Legacy', description: '', columnId: 'backlog', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: { path: '/trees/task', branch: 'task', owned: true, status: 'ready' }, operation: null, createdAt: now(), updatedAt: now() }];
    legacy.notes = [{ id: 'note', taskId: 'task', content: 'Note', createdAt: now(), updatedAt: now() }];
    legacy.settings = { worktreeBasePath: '/trees' };
    const migrated = migrateLegacyState(legacy, { now });
    expect(migrated.hub.boards[0]!.name).toBe('OpenSpec Flow');
    expect(migrated.hub.boards[0]!.workflowYaml).toBe(legacy.workflowYaml);
    expect(migrated.hub.projects).toEqual(legacy.projects);
    expect(migrated.hub.tasks[0]).toMatchObject({ id: 'task', boardId: 'default-board', sessionIds: ['session'], worktree: { path: '/trees/task' } });
    expect(migrated.hub.notes).toEqual(legacy.notes);
    expect(migrated.meta.worktreeBasePath).toBe('/trees');
  });

  it('fails rather than dropping an invalid task context', () => {
    const legacy = initialState();
    legacy.tasks = [{ id: 'task', projectId: 'project', title: 'Legacy', description: '', columnId: 'missing', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: now(), updatedAt: now() }];
    expect(() => migrateLegacyState(legacy, { now })).toThrow();
  });
});
