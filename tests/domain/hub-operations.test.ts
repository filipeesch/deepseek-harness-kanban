import { describe, expect, it } from 'vitest';
import * as operations from '../../src/domain/hub-operations.js';
import { sampleHub, operationDeps } from './hub-helpers.js';

describe('Hub operations', () => {
  it('creates and renames boards with case-insensitive uniqueness', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const second = operations.addBoard(hub, 'Delivery', deps);
    expect(hub.boards).toHaveLength(2); expect(second.name).toBe('Delivery');
    expect(() => operations.addBoard(hub, ' delivery ', deps)).toThrowError(/already exists/);
    operations.renameBoard(hub, second.id, 'Delivery 2', deps);
    expect(hub.boards[1]!.name).toBe('Delivery 2');
  });

  it('blocks deleting a board with tasks and allows the last empty board to leave an empty Hub', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Task', description: '' }, deps);
    expect(() => operations.deleteBoard(hub, 'board', deps)).toThrowError(/tasks/);
    hub.tasks = [];
    operations.deleteBoard(hub, 'board', deps);
    expect(hub.boards).toHaveLength(0);
  });

  it('keeps workflows isolated and rejects only the owning board orphan', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const other = operations.addBoard(hub, 'Other', deps);
    operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Task', description: '' }, deps);
    operations.saveBoardWorkflow(hub, other.id, 'name: Other\ninitial_column: done\ncolumns:\n  - id: done\n    label: Done\n', deps);
    expect(hub.boards[0]!.workflow.columns.map(column => column.id)).toEqual(['backlog']);
    expect(() => operations.saveBoardWorkflow(hub, 'board', 'name: Empty\ninitial_column: done\ncolumns:\n  - id: done\n    label: Done\n', deps)).toThrowError(/orphan/);
  });

  it('records auto-mode pauses only for the stage they were observed in and clears them on a move', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Auto', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    const pause = { reason: 'turn-error' as const, at: '2026-01-01T00:00:00.000Z' };
    operations.pauseAutoMode(hub, task.id, pause, deps, 'done');
    expect(hub.tasks[0]!.autoMode?.pause).toBeUndefined();
    operations.pauseAutoMode(hub, task.id, pause, deps, 'backlog');
    expect(hub.tasks[0]!.autoMode?.pause).toEqual(pause);
    operations.placeTask(hub, task.id, 'done', null, 1);
    expect(hub.tasks[0]!.autoMode?.pause).toBeUndefined();
    expect(hub.tasks[0]!.autoMode?.enabled).toBe(true);
  });

  it('creates a task in the board initial stage and preserves per-board positions', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const first = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'First', description: '' }, deps);
    const second = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Second', description: '' }, deps);
    expect(first.columnId).toBe('backlog'); expect(second.position).toBeLessThan(first.position);
    expect(() => operations.createTask(hub, { boardId: 'board', projectId: 'missing', title: 'No', description: '' }, deps)).toThrowError(/Project/);
  });

  it('blocks deleting a project used by a task on another board', () => {
    const hub = sampleHub(); const deps = operationDeps(); const other = operations.addBoard(hub, 'Other', deps);
    operations.createTask(hub, { boardId: other.id, projectId: 'project', title: 'Task', description: '' }, deps);
    expect(() => operations.deleteProject(hub, 'project', deps)).toThrowError(/tasks/);
    hub.tasks = [];
    operations.deleteProject(hub, 'project', deps);
    expect(hub.projects).toHaveLength(0);
  });

  it('places a task within its owning board workflow', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.saveBoardWorkflow(hub, 'board', 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n  - id: done\n    label: Done\n', deps);
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Task', description: '' }, deps);
    operations.placeTask(hub, task.id, 'done', null, Date.now());
    expect(hub.tasks.find(value => value.id === task.id)).toMatchObject({ boardId: 'board', columnId: 'done' });
  });

  it('updates task text and notes only for tasks in the Hub', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Before', description: '' }, deps);
    const edited = operations.editTask(hub, task.id, { title: 'After' }, deps);
    const note = operations.saveNote(hub, task.id, { content: 'Shared' }, deps);
    expect(edited.title).toBe('After'); expect(note.taskId).toBe(task.id);
    expect(() => operations.editTask(hub, 'missing', { title: 'No' }, deps)).toThrowError(/does not exist/);
  });
});
