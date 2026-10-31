import { describe, expect, it } from 'vitest';
import type { Attention, Task } from '../../src/shared/types.js';
import { EMPTY_SCOPE_ACTIVITY, projectScopeActivity } from '../../src/client/scope-activity.js';

function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, description: '', columnId: 'doing', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '', updatedAt: '' };
}

function attention(overrides: Partial<Attention> = {}): Attention {
  return { running: false, background: [], unread: false, awaitingReply: false, failed: false, ...overrides };
}

describe('projectScopeActivity', () => {
  it('projects an empty scope', () => {
    expect(projectScopeActivity([], {})).toEqual(EMPTY_SCOPE_ACTIVITY);
  });

  it('counts a task once even when it runs a turn and owns background work', () => {
    const tasks = [task('t1', 'Alpha')];
    const result = projectScopeActivity(tasks, { t1: attention({ running: true, background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }] }) });
    expect(result.runningTasks).toBe(1);
    expect(result.runningTaskTitles).toEqual(['Alpha']);
  });

  it('trusts the host running flag for a task whose owned subagent is still running', () => {
    const result = projectScopeActivity([task('t1', 'Alpha')], { t1: attention({ running: true }) });
    expect(result.runningTasks).toBe(1);
  });

  it('counts background work without an agent as a running task', () => {
    const result = projectScopeActivity([task('t1', 'Alpha')], { t1: attention({ background: [{ kind: 'job', label: 'Run tests' }] }) });
    expect(result.runningTasks).toBe(1);
  });

  it('counts distinct tasks and keeps their titles in task order', () => {
    const tasks = [task('t1', 'Alpha'), task('t2', 'Beta'), task('t3', 'Gamma'), task('t4', 'Delta')];
    const result = projectScopeActivity(tasks, {
      t1: attention({ background: [{ kind: 'job', label: 'Run tests' }] }),
      t2: attention(),
      t4: attention({ running: true }),
    });
    expect(result.runningTasks).toBe(2);
    expect(result.runningTaskTitles).toEqual(['Alpha', 'Delta']);
  });

  it('folds unread, awaiting-reply, and failure attention across the scope', () => {
    const tasks = [task('t1', 'Alpha'), task('t2', 'Beta'), task('t3', 'Gamma')];
    const result = projectScopeActivity(tasks, {
      t1: attention({ unread: true }),
      t2: attention({ failed: true, awaitingReply: true }),
      t3: attention({ unread: true, failed: true }),
    });
    expect(result.unread).toBe(true);
    expect(result.awaitingReply).toBe(true);
    expect(result.failed).toBe(true);
    expect(result.runningTasks).toBe(0);
    expect(result.runningTaskTitles).toEqual([]);
  });

  it('ignores tasks without attention facts', () => {
    const result = projectScopeActivity([task('t1', 'Alpha'), task('t2', 'Beta')], { t2: attention({ running: true }) });
    expect(result.runningTasks).toBe(1);
    expect(result.runningTaskTitles).toEqual(['Beta']);
    expect(result.unread).toBe(false);
    expect(result.awaitingReply).toBe(false);
    expect(result.failed).toBe(false);
  });
});
