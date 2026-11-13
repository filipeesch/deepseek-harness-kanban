import { describe, expect, it } from 'vitest';
import { CommandSchema } from '../../src/remote.js';
import { operation } from '../../src/domain/schema-parts.js';

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

  it('accepts the discard and cancel recoveries', () => {
    expect(CommandSchema.parse({ type: 'worktree.discardCreate', taskId: 'task', confirmed: true })).toMatchObject({ confirmed: true });
    expect(CommandSchema.parse({ type: 'operation.cancel', taskId: 'task' })).toMatchObject({ type: 'operation.cancel' });
  });
});

describe('persisted creation attempt', () => {
  const journal = (attempt: unknown) => ({
    id: 'op', request: { kind: 'create', mode: 'new', path: '/trees/a', branchName: 'a' }, phase: 'failed', targetPath: '/trees/a',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-01-01T00:00:00.000Z', createAttempt: attempt,
  });
  const attempt = { operationId: 'op', path: '/trees/a', gitRootPath: '/repo', branchName: 'a', mode: 'new', absentBefore: true };

  it('still parses a journal written before the attempt state existed', () => {
    expect(operation.parse(journal(attempt)).createAttempt?.observed).toBeUndefined();
    expect(operation.parse(journal(attempt)).createAttempt?.sourceCommit).toBeUndefined();
  });

  it('accepts the recorded commit and the observed checkout state', () => {
    const parsed = operation.parse(journal({ ...attempt, sourceCommit: 'abc', observed: { directory: 'present', registration: 'none', at: '2026-01-01T00:00:00.000Z', parentCandidates: ['/trees'] } }));
    expect(parsed.createAttempt).toMatchObject({ sourceCommit: 'abc', observed: { directory: 'present', registration: 'none', parentCandidates: ['/trees'] } });
  });

  it('rejects an observation outside the two axes', () => {
    expect(() => operation.parse(journal({ ...attempt, observed: { directory: 'gone', registration: 'none', at: '2026-01-01T00:00:00.000Z', parentCandidates: [] } }))).toThrow();
    expect(() => operation.parse(journal({ ...attempt, observed: { directory: 'absent', registration: 'foreign', at: '2026-01-01T00:00:00.000Z', parentCandidates: [] } }))).toThrow();
  });
});
