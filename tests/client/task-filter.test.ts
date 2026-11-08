import { describe, expect, it } from 'vitest';
import type { Task } from '../../src/shared/types.js';
import { filterTasks } from '../../src/client/task-filter.js';

function task(id: string, title: string, projectId: string, position: number): Task {
  return {
    id, projectId, title, description: 'copy ' + title, columnId: 'one', position,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const tasks = [task('a', 'Alpha', 'p1', 1), task('b', 'Beta', 'p2', 0), task('c', 'Gamma', 'p1', 2)];

describe('shared task filter', () => {
  it('matches the title or description and keeps task order', () => {
    expect(filterTasks(tasks, { search: 'beta', projectFilter: '' }).map(value => value.id)).toEqual(['b']);
    expect(filterTasks(tasks, { search: 'copy gamma', projectFilter: '' }).map(value => value.id)).toEqual(['c']);
  });

  it('filters by project and combines both filters', () => {
    expect(filterTasks(tasks, { search: '', projectFilter: 'p1' }).map(value => value.id)).toEqual(['a', 'c']);
    expect(filterTasks(tasks, { search: 'gamma', projectFilter: 'p1' }).map(value => value.id)).toEqual(['c']);
    expect(filterTasks(tasks, { search: 'gamma', projectFilter: 'p2' })).toEqual([]);
  });

  it('returns every task sorted when no filter is active', () => {
    expect(filterTasks(tasks, { search: '  ', projectFilter: '' }).map(value => value.id)).toEqual(['b', 'a', 'c']);
  });
});
