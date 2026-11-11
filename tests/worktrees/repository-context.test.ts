import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { cleanup, fixture, LocalExecutor } from './helpers.js';

afterEach(cleanup);

function count(executor: LocalExecutor, match: (args: string[]) => boolean): number {
  return executor.calls.filter(match).length;
}

const isRootIdentity = (root: string) => (args: string[]) => args.includes('-C') && args[1] === root && args.includes('--show-toplevel');
const isCommonIdentity = (root: string) => (args: string[]) => args.includes('-C') && args[1] === root && args.includes('--git-common-dir');
const isRegistration = (args: string[]) => args.includes('worktree') && args.includes('list');

describe('one repository context per operation', () => {
  it('resolves the repository layout once and reuses it for reads', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    const other = path.join(f.root, 'trees', 'other');
    await adapter.create(f.project, { mode: 'new', path: other, branchName: 'other' }, []);
    executor.calls.length = 0;

    const repository = await adapter.resolve(f.project, []);
    await adapter.inspect(f.project, f.tree, [], repository);
    await adapter.inspect(f.project, other, [], repository);

    // The repository itself is identified once for the operation, not once per read.
    expect(count(executor, isRootIdentity(f.project.gitRootPath))).toBe(1);
    expect(count(executor, isCommonIdentity(f.project.gitRootPath))).toBe(1);
    // The registration is read once and shared by both inspections.
    expect(count(executor, isRegistration)).toBe(1);
    // Each inspected checkout still reports its own identity and branch.
    expect(count(executor, isRootIdentity(f.tree))).toBe(1);
    expect(count(executor, isRootIdentity(other))).toBe(1);
    expect(count(executor, args => args.includes('branch') && args.includes('--show-current'))).toBe(2);
  });

  it('skips the local-change scan when discard consent already decided the removal', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    executor.calls.length = 0;

    const repository = await adapter.resolve(f.project, []);
    await adapter.remove(f.project, f.tree, true, [], undefined, repository);

    expect(count(executor, args => args.includes('status'))).toBe(0);
    expect(count(executor, args => args.includes('worktree') && args.includes('remove'))).toBe(1);
  });

  it('reads the local-change state exactly once when it can still refuse the removal', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    executor.calls.length = 0;

    const repository = await adapter.resolve(f.project, []);
    await adapter.remove(f.project, f.tree, false, [], undefined, repository);
    expect(count(executor, args => args.includes('status'))).toBe(1);
  });

  it('verifies a created checkout from the checkout itself instead of re-inspecting the repository', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    const tree = await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'verified' }, []);
    expect(tree.branch).toBe('verified');
    expect(tree.path).toBe(f.tree);
    expect(tree.dirty).toBe(false);
    expect(tree.commonDirectory).toBe(path.join(f.project.gitRootPath, '.git'));
  });
});
