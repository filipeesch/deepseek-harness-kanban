import { describe, expect, it } from 'vitest';
import { taskForSession } from '../../src/client/task-lookup.js';
import { fixture } from './helpers.js';

describe('taskForSession', () => {
  it('resolves the task, its Hub, and its board from one of its conversations', () => {
    const snapshot = fixture();
    const scope = taskForSession(snapshot, 's1');
    expect(scope?.task.id).toBe('t1');
    expect(scope?.hub.id).toBe('hub-1');
    expect(scope?.board.id).toBe('board-1');
  });

  it('resolves the same task from a second conversation of it', () => {
    expect(taskForSession(fixture(), 's2')?.task.id).toBe('t1');
  });

  it('resolves a closed conversation to the task that still owns it', () => {
    const snapshot = fixture();
    const task = snapshot.state.hubs[0]!.tasks.find(value => value.id === 't2')!;
    task.closedSessionIds = ['s-beta'];
    expect(taskForSession(snapshot, 's-beta')?.task.id).toBe('t2');
  });

  it('keeps two tasks with distinct conversations apart', () => {
    const snapshot = fixture();
    expect(taskForSession(snapshot, 's1')?.task.id).toBe('t1');
    expect(taskForSession(snapshot, 's-beta')?.task.id).toBe('t2');
  });

  it('resolves nothing for a Session of no task', () => {
    expect(taskForSession(fixture(), 's-ordinary-chat')).toBeUndefined();
  });

  it('resolves nothing outside the boards it knows', () => {
    const snapshot = fixture();
    snapshot.state.hubs[0]!.boards = [];
    expect(taskForSession(snapshot, 's1')).toBeUndefined();
  });
});
