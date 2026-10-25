import { describe, expect, it } from 'vitest';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
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
});
