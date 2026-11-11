import { describe, expect, it } from 'vitest';
import { CommandSchema } from '../../src/remote.js';

describe('worktree.create command schema', () => {
  it('accepts a new-branch request that omits the derived branch and destination', () => {
    const parsed = CommandSchema.parse({ type: 'worktree.create', taskId: 'task', mode: 'new' });
    expect(parsed).toEqual({ type: 'worktree.create', taskId: 'task', mode: 'new' });
  });

  it('accepts a new-branch request that states both values', () => {
    expect(CommandSchema.parse({ type: 'worktree.create', taskId: 'task', mode: 'new', path: '/trees/a', branchName: 'a' })).toMatchObject({ path: '/trees/a', branchName: 'a' });
  });

  it('keeps an empty branch or destination from crossing the wire', () => {
    expect(() => CommandSchema.parse({ type: 'worktree.create', taskId: 'task', mode: 'new', branchName: '' })).toThrow();
    expect(() => CommandSchema.parse({ type: 'worktree.create', taskId: 'task', mode: 'new', path: '' })).toThrow();
  });

  it('still rejects an unknown field on the same command', () => {
    expect(() => CommandSchema.parse({ type: 'worktree.create', taskId: 'task', mode: 'new', unexpected: true })).toThrow();
  });
});
