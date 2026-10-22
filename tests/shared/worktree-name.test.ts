import { describe, expect, it } from 'vitest';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';

describe('taskTitleSlug', () => {
  it.each([
    ['Fix login', 'fix-login'],
    ['Criação de tarefas', 'criacao-de-tarefas'],
    ['Já está pronto', 'ja-esta-pronto'],
    ['  Fix   LOGIN!!  ', 'fix-login'],
    ['fix-login', 'fix-login'],
    ['ABC_123', 'abc-123'],
  ])('derives %j as %s', (title, expected) => {
    expect(taskTitleSlug(title)).toBe(expected);
  });

  it.each(['', '   ', '🚀🔥', '---', '!!!'])('falls back to task for %j', title => {
    expect(taskTitleSlug(title)).toBe('task');
  });

  it('limits the slug to 48 characters without a trailing hyphen', () => {
    const slug = taskTitleSlug('a'.repeat(47) + '-next');
    expect(slug).toHaveLength(47);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps exactly 48 alphanumeric characters', () => {
    expect(taskTitleSlug('a'.repeat(48))).toBe('a'.repeat(48));
  });

  it('truncates a longer alphanumeric title to 48 characters', () => {
    expect(taskTitleSlug('b'.repeat(60))).toBe('b'.repeat(48));
  });

  it('falls back for a title without Latin characters', () => {
    expect(taskTitleSlug('プロジェクト')).toBe('task');
  });
});

describe('worktreePathForBranch', () => {
  it.each([
    ['/worktrees', 'fix-login', '/worktrees/fix-login'],
    ['/worktrees/', 'fix-login', '/worktrees/fix-login'],
    ['/worktrees///', 'fix-login', '/worktrees/fix-login'],
    ['/', 'fix-login', '/fix-login'],
    ['/worktrees', 'feature/x', '/worktrees/feature/x'],
    ['C:\\trees', 'fix-login', 'C:\\trees\\fix-login'],
    ['C:\\trees\\', 'fix-login', 'C:\\trees\\fix-login'],
    ['C:\\', 'fix-login', 'C:\\fix-login'],
    ['C:\\trees', 'feature/x', 'C:\\trees\\feature\\x'],
    ['\\\\server\\share', 'fix-login', '\\\\server\\share\\fix-login'],
  ])('joins base %j and branch %j as %s', (base, branch, expected) => {
    expect(worktreePathForBranch(base, branch)).toBe(expected);
  });

  it.each([
    ['', 'fix-login'],
    ['/worktrees', ''],
    ['/worktrees', '   '],
    ['/worktrees', '../escape'],
    ['/worktrees', 'feature/../escape'],
    ['/worktrees', 'feature/./next'],
    ['/worktrees', '/leading'],
    ['/worktrees', 'trailing/'],
    ['/worktrees', 'double//segment'],
    ['/worktrees', 'back\\slash'],
  ])('returns an empty path for base %j and branch %j', (base, branch) => {
    expect(worktreePathForBranch(base, branch)).toBe('');
  });

  it('returns an empty path for an undefined base', () => {
    expect(worktreePathForBranch(undefined, 'fix-login')).toBe('');
  });
});
