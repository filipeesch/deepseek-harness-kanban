import { describe, expect, it } from 'vitest';
import { HubStateSchema, StoredHubStateSchema } from '../../src/domain/hub-schema.js';
import type { HubState, HubTask } from '../../src/shared/types.js';
import { sampleHub } from './hub-helpers.js';

const now = '2026-01-01T00:00:00.000Z';
function task(overrides: Partial<HubTask> = {}): HubTask {
  return { id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null, createdAt: now, updatedAt: now, ...overrides };
}
function hubWith(...tasks: HubTask[]): HubState { const hub = sampleHub(); hub.tasks = tasks; return hub; }

describe('HubState schema', () => {
  it('accepts a valid Hub with a board, project, and task', () => {
    expect(HubStateSchema.safeParse(hubWith(task())).success).toBe(true);
  });

  it('rejects a duplicate board name within the Hub', () => {
    const hub = hubWith(); hub.boards.push({ ...hub.boards[0]!, id: 'board-2', name: ' board ' });
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('accepts a board project scope of known keys and rejects an unknown or repeated one', () => {
    const hub = hubWith();
    hub.projects.push({ id: 'other', name: 'Other', projectKey: 'other', projectPath: '/repo/other' });
    hub.boards[0]!.allowedProjectKeys = ['project', 'other'];
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
    hub.boards[0]!.allowedProjectKeys = ['project', 'project'];
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
    hub.boards[0]!.allowedProjectKeys = ['missing'];
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
    hub.boards[0]!.allowedProjectKeys = [];
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });

  it('accepts a published placeholder without a path and rejects an inconsistent one', () => {
    const placeholder = hubWith();
    placeholder.projects.push({ id: 'ops', name: 'ops', projectKey: 'ops', origin: 'published' });
    placeholder.boards[0]!.allowedProjectKeys = ['ops'];
    expect(HubStateSchema.safeParse(placeholder).success).toBe(true);
    const withPath = hubWith();
    withPath.projects.push({ id: 'ops', name: 'ops', projectKey: 'ops', origin: 'published', projectPath: '/repo/ops' } as unknown as HubState['projects'][number]);
    expect(HubStateSchema.safeParse(withPath).success).toBe(false);
    const withoutPath = hubWith();
    withoutPath.projects[0] = { ...withoutPath.projects[0]!, projectPath: undefined } as unknown as HubState['projects'][number];
    expect(HubStateSchema.safeParse(withoutPath).success).toBe(false);
  });

  it('rejects a project without a key or with a key another project uses', () => {
    const keyless = hubWith();
    keyless.projects[0] = { id: 'project', name: 'Project', projectPath: '/repo/app' } as unknown as HubState['projects'][number];
    expect(HubStateSchema.safeParse(keyless).success).toBe(false);
    const duplicate = hubWith();
    duplicate.projects.push({ id: 'other', name: 'Other', projectKey: 'project', projectPath: '/repo/other' });
    expect(HubStateSchema.safeParse(duplicate).success).toBe(false);
  });

  it('reads a stored record whose project predates project keys, but not as an opened Hub', () => {
    const stored = hubWith();
    stored.projects[0] = { id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/repo' } as unknown as HubState['projects'][number];
    // The storage domain validates every record before the repository can backfill it.
    expect(StoredHubStateSchema.safeParse(stored).success).toBe(true);
    expect(HubStateSchema.safeParse(stored).success).toBe(false);
  });

  it('refuses workspace or relocation metadata on a placeholder, and a task that names one', () => {
    const withWorkspace = hubWith();
    withWorkspace.projects.push({ id: 'ops', name: 'ops', projectKey: 'ops', origin: 'published', workspaceId: 'workspace' } as unknown as HubState['projects'][number]);
    expect(StoredHubStateSchema.safeParse(withWorkspace).success).toBe(false);
    const taskOnPlaceholder = hubWith(task({ projectId: 'ops' }));
    taskOnPlaceholder.projects.push({ id: 'ops', name: 'ops', projectKey: 'ops', origin: 'published' });
    expect(HubStateSchema.safeParse(taskOnPlaceholder).success).toBe(false);
  });

  it('rejects a task whose board does not exist', () => {
    const hub = hubWith(task({ boardId: 'missing' }));
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('rejects a task column that belongs to another board', () => {
    const hub = hubWith(task({ columnId: 'done' }));
    hub.boards.push({ ...hub.boards[0]!, id: 'board-2', name: 'Other', workflow: { name: 'Other', initialColumnId: 'done', columns: [{ id: 'done', name: 'Done' }], groups: [] }, workflowYaml: 'name: Other\ninitial_column: done\ncolumns:\n  - id: done\n    label: Done\n' });
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('rejects a note whose task does not exist', () => {
    const hub = hubWith(); hub.notes.push({ id: 'note', taskId: 'missing', content: 'note', createdAt: now, updatedAt: now });
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('rejects the same native session on two tasks', () => {
    expect(HubStateSchema.safeParse(hubWith(task(), task({ id: 'task-2' }))).success).toBe(false);
  });

  it('rejects a pending transition into another board workflow', () => {
    const hub = hubWith(task({ pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting' } }));
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('rejects workflow YAML that does not match the normalized workflow', () => {
    const hub = hubWith(); hub.boards[0]!.workflow.name = 'Tampered';
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    expect(HubStateSchema.safeParse({ ...hubWith(task()), extra: true }).success).toBe(false);
  });

  it('accepts auto mode with and without a pause', () => {
    expect(HubStateSchema.safeParse(hubWith(task({ autoMode: { enabled: true } }))).success).toBe(true);
    expect(HubStateSchema.safeParse(hubWith(task({ autoMode: { enabled: true, pause: { reason: 'turn-error', at: now } } }))).success).toBe(true);
    expect(HubStateSchema.safeParse(hubWith(task({ autoMode: { enabled: false } }))).success).toBe(true);
  });

  it('rejects an unknown auto-mode pause reason and extra auto-mode fields', () => {
    const unknownReason = task({ autoMode: { enabled: true, pause: { reason: 'turn-unknown' as never, at: now } } });
    expect(HubStateSchema.safeParse(hubWith(unknownReason)).success).toBe(false);
    const extra = task({ autoMode: { enabled: true, extra: true } as never });
    expect(HubStateSchema.safeParse(hubWith(extra)).success).toBe(false);
    const extraPause = task({ autoMode: { enabled: true, pause: { reason: 'advance-failed', at: now, code: 'X' } } as never });
    expect(HubStateSchema.safeParse(hubWith(extraPause)).success).toBe(false);
  });

  it('treats a pending transition without an origin as user-confirmed', () => {
    const user = task({ pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'backlog', mode: 'move', status: 'waiting' } });
    const parsed = HubStateSchema.safeParse(hubWith(user));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.pendingTransition?.origin).toBeUndefined();
  });

  it('accepts an automatic pending transition and rejects a user origin', () => {
    const auto = task({ pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'backlog', mode: 'move', status: 'waiting', origin: 'auto' } });
    const parsed = HubStateSchema.safeParse(hubWith(auto));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.pendingTransition?.origin).toBe('auto');
    expect(HubStateSchema.safeParse(hubWith(task({ pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'backlog', mode: 'move', status: 'waiting', origin: 'user' as never } }))).success).toBe(false);
  });
});
