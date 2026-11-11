import { describe, expect, it } from 'vitest';
import * as operations from '../../src/domain/hub-operations.js';
import { sampleHub, operationDeps } from './hub-helpers.js';
import { transitions } from '../support/transition-rules.js';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
import type { HubTask } from '../../src/shared/types.js';

/**
 * Place a task with the moment the record requires. These tests assert placement
 * semantics, so the timestamp only has to be valid; monotonic entry ids become
 * their epoch representation.
 */
function place(hub: Parameters<typeof operations.placeTask>[0], taskId: string, columnId: string, placement: Parameters<typeof operations.placeTask>[3], enteredAt: number, options: { retainAgentPause?: boolean } = {}): void {
  operations.placeTask(hub, taskId, columnId, placement, enteredAt, { ...options, at: new Date(enteredAt).toISOString() });
}

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
    place(hub, task.id, 'done', 'end', 1);
    expect(hub.tasks[0]!.autoMode?.pause).toBeUndefined();
    expect(hub.tasks[0]!.autoMode?.enabled).toBe(true);
  });

  it('records the pause the agent requested and resumes it without changing the setting', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Paused', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseTask(hub, task.id, '  Review the diff  ', deps);
    expect(task.autoMode?.hold).toEqual({ reason: 'Review the diff', at: expect.any(String) });
    expect(task.autoMode?.enabled).toBe(true);
    expect(task.columnId).toBe('backlog');

    operations.resumeTask(hub, task.id, deps);
    expect(task.autoMode).toEqual({ enabled: true });
    const settled = task.updatedAt;
    operations.resumeTask(hub, task.id, deps);
    expect(task.updatedAt).toBe(settled);
  });

  it('records nothing for a task whose auto mode is disabled and rejects a blank reason', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Idle', description: '' }, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    expect(task.autoMode).toBeUndefined();

    operations.setAutoMode(hub, task.id, true, deps);
    expect(() => operations.pauseTask(hub, task.id, '   ', deps)).toThrowError(/nonempty/);
    expect(task.autoMode?.hold).toBeUndefined();
  });

  it('clears a diagnostic pause and the agent pause together on resume', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Paused', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseAutoMode(hub, task.id, { reason: 'turn-error', at: '2026-01-01T00:00:00.000Z' }, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    expect(task.autoMode?.pause?.reason).toBe('turn-error');
    expect(task.autoMode?.hold?.reason).toBe('Review the diff');

    operations.resumeTask(hub, task.id, deps);
    expect(task.autoMode).toEqual({ enabled: true });
  });

  it('treats enabling auto mode on a paused task as its resume', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Paused', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    operations.setAutoMode(hub, task.id, true, deps);
    expect(task.autoMode).toEqual({ enabled: true });
  });

  it('resumes the agent pause on a user move and keeps it on an automatic placement', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Moved', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);

    place(hub, task.id, 'done', 'end', 1, { retainAgentPause: true });
    expect(task.autoMode?.hold?.reason).toBe('Review the diff');

    place(hub, task.id, 'backlog', 'end', 2);
    expect(task.autoMode?.hold).toBeUndefined();
    expect(task.autoMode?.enabled).toBe(true);
  });

  it('records, replaces, and clears the transition of the current stage without moving the task', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'review', name: 'Review' }, { id: 'done', name: 'Done' });
    hub.boards[0]!.workflow.columns[0]!.allowedTransitions = transitions('review', 'done');
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Route', description: '' }, deps);
    operations.recordTransition(hub, task.id, 'done', deps);
    expect(task.recordedTransition).toMatchObject({ fromColumnId: 'backlog', columnId: 'done' });
    expect(task.columnId).toBe('backlog');
    operations.recordTransition(hub, task.id, 'review', deps);
    expect(task.recordedTransition?.columnId).toBe('review');
    operations.recordTransition(hub, task.id, undefined, deps);
    expect(task.recordedTransition).toBeUndefined();
  });

  it('rejects a recording the current stage does not configure', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Route', description: '' }, deps);
    expect(() => operations.recordTransition(hub, task.id, 'done', deps)).toThrowError(/does not configure transitions/);
    hub.boards[0]!.workflow.columns[0]!.allowedTransitions = transitions('done');
    expect(() => operations.recordTransition(hub, task.id, 'backlog', deps)).toThrowError(/another stage/);
    expect(() => operations.recordTransition(hub, task.id, 'missing', deps)).toThrowError(/configured transition/);
    expect(task.recordedTransition).toBeUndefined();
  });

  it('discards the recording when the task leaves the stage and keeps it on a same-stage reorder', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    hub.boards[0]!.workflow.columns[0]!.allowedTransitions = transitions('done');
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Route', description: '' }, deps);
    operations.recordTransition(hub, task.id, 'done', deps);
    place(hub, task.id, 'backlog', 'end', 1);
    expect(task.recordedTransition).toMatchObject({ columnId: 'done' });
    place(hub, task.id, 'done', 'end', 2);
    expect(task.recordedTransition).toBeUndefined();
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
    place(hub, task.id, 'done', 'end', Date.now());
    expect(hub.tasks.find(value => value.id === task.id)).toMatchObject({ boardId: 'board', columnId: 'done' });
  });

  it('places a task at the requested position in its destination stage', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.saveBoardWorkflow(hub, 'board', 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n  - id: done\n    label: Done\n', deps);
    const first = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'First', description: '' }, deps);
    const second = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Second', description: '' }, deps);
    const third = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Third', description: '' }, deps);
    const order = () => hub.tasks.filter(task => task.columnId === 'done').sort((left, right) => left.position - right.position).map(task => task.title);
    place(hub, first.id, 'done', 'end', 1);
    place(hub, second.id, 'done', 'end', 2);
    place(hub, third.id, 'done', 'end', 3);
    expect(order()).toEqual(['First', 'Second', 'Third']);
    place(hub, third.id, 'done', 'start', 4);
    expect(order()).toEqual(['Third', 'First', 'Second']);
    place(hub, third.id, 'done', 'end', 5);
    expect(order()).toEqual(['First', 'Second', 'Third']);
    place(hub, third.id, 'done', { before: second.id }, 6);
    expect(order()).toEqual(['First', 'Third', 'Second']);
    place(hub, third.id, 'done', { before: 'missing-task' }, 7);
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

describe('task flow facts', () => {
  it('records the creation with the stage it was created in', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Created', description: '' }, deps);
    expect(task.history).toEqual([{ kind: 'created', at: expect.any(String), columnId: 'backlog' }]);
  });

  it('records one entry per stage change and none for a placement inside the current stage', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Moved', description: '' }, deps);
    operations.placeTask(hub, task.id, 'done', 'end', 1, { at: '2026-02-01T10:00:00.000Z' });
    operations.placeTask(hub, task.id, 'done', 'start', 2, { at: '2026-02-01T10:05:00.000Z' });
    const stages = (task.history ?? []).filter(entry => entry.kind === 'stage');
    expect(stages).toEqual([{ kind: 'stage', at: '2026-02-01T10:00:00.000Z', fromColumnId: 'backlog', columnId: 'done' }]);
  });

  it('records a recorded destination, its replacement, and nothing when it is cleared', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'review', name: 'Review' }, { id: 'done', name: 'Done' });
    hub.boards[0]!.workflow.columns[0]!.allowedTransitions = transitions('review', 'done');
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Route', description: '' }, deps);
    operations.recordTransition(hub, task.id, 'done', deps);
    operations.recordTransition(hub, task.id, 'review', deps);
    operations.recordTransition(hub, task.id, undefined, deps);
    const intents = (task.history ?? []).filter(entry => entry.kind === 'intent');
    expect(intents.map(entry => (entry as { columnId: string }).columnId)).toEqual(['done', 'review']);
    expect(intents).toHaveLength(2);
  });

  it('records every auto mode change, including a repeated pause for the same reason', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Auto', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseAutoMode(hub, task.id, { reason: 'turn-error', at: '2026-02-01T10:00:00.000Z', message: 'Rate limited.' }, deps);
    operations.pauseAutoMode(hub, task.id, { reason: 'turn-error', at: '2026-02-01T10:01:00.000Z', message: 'Rate limited.' }, deps);
    operations.resumeTask(hub, task.id, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    operations.setAutoMode(hub, task.id, false, deps);
    const changes = (task.history ?? []).filter(entry => entry.kind === 'auto-mode').map(entry => {
      const value = entry as { action: string; reason?: string; message?: string };
      return { action: value.action, ...(value.reason === undefined ? {} : { reason: value.reason }), ...(value.message === undefined ? {} : { message: value.message }) };
    });
    expect(changes).toEqual([
      { action: 'enabled' },
      { action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { action: 'resumed' },
      { action: 'agent-paused', reason: 'Review the diff' },
      { action: 'disabled' },
    ]);
  });


  it('records the resume a placement causes, including a same-stage reorder', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Moved', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    operations.placeTask(hub, task.id, 'backlog', 'end', 1, { at: '2026-02-01T10:00:00.000Z' });
    const kinds = () => (task.history ?? []).map(entry => (entry.kind === 'auto-mode' ? entry.action : entry.kind));
    expect(kinds()).toEqual(['created', 'enabled', 'agent-paused', 'resumed']);
    operations.pauseAutoMode(hub, task.id, { reason: 'turn-error', at: '2026-02-01T10:01:00.000Z' }, deps);
    operations.placeTask(hub, task.id, 'done', 'end', 2, { at: '2026-02-01T10:02:00.000Z' });
    expect(kinds()).toEqual(['created', 'enabled', 'agent-paused', 'resumed', 'paused', 'stage', 'resumed']);
    expect(task.history?.[3]).toMatchObject({ kind: 'auto-mode', action: 'resumed', at: '2026-02-01T10:00:00.000Z' });
  });

  it('keeps one row for an agent pause repeated with the same reason', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Paused', description: '' }, deps);
    operations.setAutoMode(hub, task.id, true, deps);
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    const afterFirst = (task.history ?? []).length;
    operations.pauseTask(hub, task.id, 'Review the diff', deps);
    expect((task.history ?? []).length).toBe(afterFirst);
  });

  it('renames a stage to an identifier a removed stage used and keeps the stored Hub valid', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.saveBoardWorkflow(hub, 'board', 'name: Flow\ninitial_column: retired\ncolumns:\n  - id: retired\n    label: Retired\n  - id: plan\n    label: Plan\n', deps);
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Reuse', description: '' }, deps);
    operations.placeTask(hub, task.id, 'plan', 'end', 1, { at: '2026-02-01T10:00:00.000Z' });
    // The unused stage leaves, so its identifier is free for the rename below.
    operations.saveBoardWorkflow(hub, 'board', 'name: Flow\ninitial_column: plan\ncolumns:\n  - id: plan\n    label: Plan\n', deps);
    operations.updateBoardStage(hub, 'board', { stageId: 'plan', patch: { id: 'retired' } }, deps);
    expect(task.columnId).toBe('retired');
    expect((task.history ?? []).filter(entry => entry.kind === 'stage')).toEqual([
      { kind: 'stage', at: '2026-02-01T10:00:00.000Z', fromColumnId: 'retired', columnId: 'retired' },
    ]);
    expect(HubStateSchema.safeParse(hub).success).toBe(true);
  });


  it('records the first fact of a task stored before the feature', () => {
    const hub = sampleHub(); const deps = operationDeps();
    hub.boards[0]!.workflow.columns.push({ id: 'done', name: 'Done' });
    const legacy: HubTask = {
      id: 'legacy', boardId: 'board', projectId: 'project', title: 'Legacy', description: '', columnId: 'backlog', position: 0,
      sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    hub.tasks.push(legacy);
    expect(legacy.history).toBeUndefined();
    operations.placeTask(hub, legacy.id, 'done', 'end', 1, { at: '2026-02-01T10:00:00.000Z' });
    expect(legacy.history).toEqual([{ kind: 'stage', at: '2026-02-01T10:00:00.000Z', fromColumnId: 'backlog', columnId: 'done' }]);
  });

  it('records nothing for conversation, note, and text activity', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const task = operations.createTask(hub, { boardId: 'board', projectId: 'project', title: 'Quiet', description: '' }, deps);
    const before = (task.history ?? []).length;
    operations.addSession(hub, task.id, 'session', deps);
    operations.closeSession(hub, task.id, 'session', deps);
    operations.reopenSession(hub, task.id, 'session', deps);
    const note = operations.saveNote(hub, task.id, { content: 'Shared' }, deps);
    operations.deleteNote(hub, task.id, note.id, deps);
    operations.editTask(hub, task.id, { title: 'Renamed', description: 'New' }, deps);
    expect((task.history ?? []).length).toBe(before);
  });
});