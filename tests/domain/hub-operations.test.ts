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
    operations.placeTask(hub, task.id, 'done', 'end', 1);
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

  it('records auto mode on creation without changing the entry marker', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns[0]!.onEnterPrompt = 'Start here.';
    const enabled = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Auto', description: '', autoMode: true }, deps);
    expect(enabled.autoMode).toEqual({ enabled: true });
    expect(enabled.instructionPending).toBeDefined();
    const plain = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Plain', description: '' }, deps);
    expect(plain.autoMode).toBeUndefined();
    expect(() => operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Bad', description: '', autoMode: 'yes' as never }, deps)).toThrowError(/auto mode/);
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
    operations.placeTask(hub, task.id, 'done', 'end', Date.now());
    expect(hub.tasks.find(value => value.id === task.id)).toMatchObject({ boardId: 'board', columnId: 'done' });
  });

  it('places a task at the requested position in its destination stage', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.saveBoardWorkflow(hub, 'board', 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n  - id: done\n    label: Done\n', deps);
    const first = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'First', description: '' }, deps);
    const second = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Second', description: '' }, deps);
    const third = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Third', description: '' }, deps);
    const order = () => hub.tasks.filter(task => task.columnId === 'done').sort((left, right) => left.position - right.position).map(task => task.title);
    operations.placeTask(hub, first.id, 'done', 'end', 1);
    operations.placeTask(hub, second.id, 'done', 'end', 2);
    operations.placeTask(hub, third.id, 'done', 'end', 3);
    expect(order()).toEqual(['First', 'Second', 'Third']);
    operations.placeTask(hub, third.id, 'done', 'start', 4);
    expect(order()).toEqual(['Third', 'First', 'Second']);
    operations.placeTask(hub, third.id, 'done', 'end', 5);
    expect(order()).toEqual(['First', 'Second', 'Third']);
    operations.placeTask(hub, third.id, 'done', { before: second.id }, 6);
    expect(order()).toEqual(['First', 'Third', 'Second']);
    operations.placeTask(hub, third.id, 'done', { before: 'missing-task' }, 7);
    expect(order()).toEqual(['First', 'Second', 'Third']);
  });

  it('updates task text and notes only for tasks in the Hub', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Before', description: '' }, deps);
    const edited = operations.editTask(hub, task.id, { title: 'After' }, deps);
    const note = operations.saveNote(hub, task.id, { content: 'Shared' }, deps);
    expect(edited.title).toBe('After'); expect(note.taskId).toBe(task.id);
    expect(() => operations.editTask(hub, 'missing', { title: 'No' }, deps)).toThrowError(/does not exist/);
  });

  it('normalizes, replaces, preserves, and clears note tags without rewriting content', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Notes', description: '' }, deps);
    const other = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Other', description: '' }, deps);
    const note = operations.saveNote(hub, task.id, { content: 'Shared', tags: [' Design ', 'DESIGN', 'todo'] }, deps);
    expect(note.tags).toEqual(['design', 'todo']);
    const kept = operations.saveNote(hub, task.id, { id: note.id, content: 'Shared v2' }, deps);
    expect(kept).toMatchObject({ content: 'Shared v2', tags: ['design', 'todo'] });
    const tagsOnly = operations.saveNote(hub, task.id, { id: note.id, tags: ['review', 'Design'] }, deps);
    expect(tagsOnly).toMatchObject({ content: 'Shared v2', tags: ['review', 'design'] });
    const cleared = operations.saveNote(hub, task.id, { id: note.id, tags: [] }, deps);
    expect(cleared.content).toBe('Shared v2'); expect(cleared.tags).toBeUndefined();
    expect(() => operations.saveNote(hub, task.id, { id: note.id }, deps)).toThrowError(/content or tags/);
    expect(() => operations.saveNote(hub, task.id, { content: 'Invalid', tags: [4 as unknown as string] }, deps)).toThrowError(/text values/);
    const foreign = operations.saveNote(hub, other.id, { content: 'Foreign' }, deps);
    expect(operations.deleteNote(hub, task.id, note.id, deps).id).toBe(note.id);
    expect(hub.notes.map(value => value.id)).toEqual([foreign.id]);
    expect(() => operations.deleteNote(hub, task.id, 'missing', deps)).toThrowError(/does not exist/);
  });
});
