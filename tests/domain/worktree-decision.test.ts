import { describe, expect, it } from 'vitest';
import { worktreeDecision } from '../../src/domain/first-execution.js';
import type { Project, Task } from '../../src/shared/types.js';

const project = { id: 'p', name: 'Web', projectKey: 'web', projectPath: '/repo', gitRootPath: '/repo' } as Project;
const folder = { id: 'd', name: 'Docs', projectKey: 'docs', projectPath: '/docs' } as Project;
function task(overrides: Partial<Task> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}

describe('worktree decision', () => {
  it('blocks a binding that is not ready', () => {
    expect(worktreeDecision(task({ worktree: { path: '/tree', branch: 'b', owned: true, status: 'error', error: { code: 'X', message: 'x' } } }), project)).toBe('blocked');
    expect(worktreeDecision(task({ worktree: { path: '/tree', branch: 'b', owned: true, status: 'preparing' } }), project)).toBe('blocked');
  });

  it('creates the default worktree when the choice is unresolved', () => {
    expect(worktreeDecision(task(), project)).toBe('create-default');
  });

  it('uses the recorded base project', () => {
    expect(worktreeDecision(task({ worktreeDismissed: true }), project)).toBe('base');
  });

  it('needs no choice for a ready worktree, an existing conversation, or a folder project', () => {
    expect(worktreeDecision(task({ worktree: { path: '/tree', branch: 'b', owned: true, status: 'ready' } }), project)).toBe('none');
    expect(worktreeDecision(task({ sessionIds: ['s'] }), project)).toBe('none');
    expect(worktreeDecision(task(), folder)).toBe('none');
    expect(worktreeDecision(task(), undefined)).toBe('none');
  });
});
