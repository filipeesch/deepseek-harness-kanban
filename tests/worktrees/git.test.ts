import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { cleanup, fixture, git, gitOk, LocalExecutor } from './helpers.js';

afterEach(cleanup);

describe('GitAdapter through the injected executor', () => {
  it('discovers a picked directory and its Git root without a registered project', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await expect(adapter.discover(f.project.projectPath)).resolves.toEqual({ projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath });
    const outside = path.join(f.root, 'outside'); await mkdir(outside);
    await expect(adapter.discover(outside)).resolves.toEqual({ projectPath: outside, gitRootPath: outside });
  });
  it('creates a new branch and preserves the monorepo project directory', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    const tree = await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature', sourceBranch: 'main' }, ['a', 'b']);
    expect(tree.branch).toBe('feature'); expect(tree.dirty).toBe(false);
    expect(await adapter.projectDirectory(f.project, tree.path)).toBe(path.join(f.tree, 'packages/api'));
    expect(await adapter.projectDirectory(f.project)).toBe(f.project.projectPath);
    expect(executor.policies.some(call => call.write && call.paths.includes(tree.commonDirectory) && call.ids.join() === 'a,b')).toBe(true);
  });

  it('creates a checkout for an existing branch without deleting that branch on removal', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await gitOk(f.project.gitRootPath, ['branch', 'existing']);
    const tree = await adapter.create(f.project, { mode: 'existing', path: f.tree, branchName: 'existing' }, ['a']);
    expect(tree.branch).toBe('existing');
    await adapter.remove(f.project, tree.path, false, ['a']);
    await expect(stat(tree.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', 'refs/heads/existing'])).exitCode).toBe(0);
    await adapter.remove(f.project, tree.path, false, ['a']);
  });

  it('inspects an external worktree using common-dir identity, not branch names', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await gitOk(f.project.gitRootPath, ['worktree', 'add', '-b', 'external', f.tree]);
    const tree = await adapter.inspect(f.project, f.tree, []);
    expect(tree.commonDirectory).toBe(path.join(f.project.gitRootPath, '.git'));
    const other = await fixture();
    await expect(adapter.inspect(f.project, other.project.gitRootPath, [])).rejects.toMatchObject({ code: 'REPOSITORY_MISMATCH' });
    await expect(adapter.inspect(f.project, path.join(f.tree, 'packages/api'), [])).rejects.toMatchObject({ code: 'WORKTREE_ROOT_REQUIRED' });
  });

  it('requires separate discard consent for tracked and untracked changes', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'dirty' }, []);
    await writeFile(path.join(f.tree, 'packages/api/app.txt'), 'modified');
    await writeFile(path.join(f.tree, 'untracked.txt'), 'new');
    await expect(adapter.remove(f.project, f.tree, false, [])).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    expect((await stat(f.tree)).isDirectory()).toBe(true);
    await adapter.remove(f.project, f.tree, true, []);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', 'refs/heads/dirty'])).exitCode).toBe(0);
  });

  it('never removes the base path, Git root, their ancestors, or a symlink alias', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    const alias = path.join(f.root, 'alias'); await symlink(f.project.projectPath, alias);
    for (const target of [f.project.projectPath, f.project.gitRootPath, f.root, alias, path.join(f.project.gitRootPath, '.git')]) {
      await expect(adapter.remove(f.project, target, true, [])).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE_TARGET' });
    }
    expect((await stat(f.project.projectPath)).isDirectory()).toBe(true);
  });

  it('rejects unregistered directories and locked worktrees even with discard consent', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    const ordinary = path.join(f.root, 'ordinary'); await mkdir(ordinary);
    await expect(adapter.remove(f.project, ordinary, true, [])).rejects.toMatchObject({ code: 'WORKTREE_NOT_REGISTERED' });
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'locked' }, []);
    await gitOk(f.project.gitRootPath, ['worktree', 'lock', f.tree]);
    await expect(adapter.remove(f.project, f.tree, true, [])).rejects.toMatchObject({ code: 'WORKTREE_LOCKED' });
  });

  it('checks nonzero Git results without falling back to another executor or deleting files', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'kept' }, []);
    executor.fail = args => args.includes('remove') ? { exitCode: 37, stdout: '', stderr: 'Injected removal failure' } : undefined;
    await expect(adapter.remove(f.project, f.tree, true, [])).rejects.toMatchObject({ code: 'GIT_FAILED', details: { exitCode: 37 } });
    expect((await stat(f.tree)).isDirectory()).toBe(true);
    expect(executor.calls.filter(args => args.includes('remove'))).toHaveLength(1);
  });

  it('surfaces policy denial before any Git write and never retries unrestricted', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    executor.deny = (_paths, write) => write;
    await expect(adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'denied' }, ['a'])).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' });
    expect(executor.calls.some(args => args.includes('add'))).toBe(false);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', '--quiet', 'refs/heads/denied'])).exitCode).toBe(1);
  });

  it('rejects nonexistent relative project directories instead of using the worktree root', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'missing' }, []);
    const missing = { ...f.project, projectPath: path.join(f.project.gitRootPath, 'new-project') };
    await mkdir(missing.projectPath);
    await expect(adapter.projectDirectory(missing, f.tree)).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  });

  it('discovers branches and rejects option-like branch names as data', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await gitOk(f.project.gitRootPath, ['branch', 'second']);
    expect(await adapter.branches(f.project, [])).toEqual(['main', 'second']);
    await expect(adapter.create(f.project, { mode: 'new', path: f.tree, branchName: '--force' }, [])).rejects.toMatchObject({ code: 'INVALID_BRANCH' });
    expect(executor.calls.some(args => args.includes('add'))).toBe(false);
  });
  it('advertises only local branches and rejects a remote-only existing choice before writes', async () => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    await gitOk(f.project.gitRootPath, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    expect(await adapter.branches(f.project, [])).toEqual(['main']);
    await expect(adapter.create(f.project, { mode: 'existing', path: f.tree, branchName: 'origin/feature' }, [])).rejects.toMatchObject({ code: 'LOCAL_BRANCH_REQUIRED' });
    expect(executor.calls.some(args => args.includes('worktree') && args.includes('add'))).toBe(false);
    await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/feature'])).exitCode).toBe(0);
  });

  it('can use an explicit remote ref as the source of a new attached local branch', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await gitOk(f.project.gitRootPath, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    const tree = await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'local-feature', sourceBranch: 'refs/remotes/origin/feature' }, []);
    expect(tree.branch).toBe('local-feature');
    expect((await gitOk(f.tree, ['symbolic-ref', '--quiet', 'HEAD'])).trim()).toBe('refs/heads/local-feature');
  });

  it('keeps local branch names and attachment exact even when remote refs or tags are ambiguous', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    await gitOk(f.project.gitRootPath, ['branch', 'origin/feature']);
    await gitOk(f.project.gitRootPath, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    await gitOk(f.project.gitRootPath, ['tag', 'origin/feature']);
    expect(await adapter.branches(f.project, [])).toEqual(['main', 'origin/feature']);
    const tree = await adapter.create(f.project, { mode: 'existing', path: f.tree, branchName: 'origin/feature' }, []);
    expect(tree.branch).toBe('origin/feature');
    expect((await gitOk(f.tree, ['symbolic-ref', '--quiet', 'HEAD'])).trim()).toBe('refs/heads/origin/feature');
    await adapter.remove(f.project, f.tree, false, []);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', '--quiet', 'refs/heads/origin/feature'])).exitCode).toBe(0);
  });

  it.each(['HEAD', '@', 'refs/heads/shadow'])('does not advertise or create unsupported pseudo/ref-spelled branch %s', async branchName => {
    const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
    const commit = (await gitOk(f.project.gitRootPath, ['rev-parse', '--verify', 'HEAD'])).trim();
    await gitOk(f.project.gitRootPath, ['update-ref', 'refs/heads/' + branchName, commit]);
    expect(await adapter.branches(f.project, [])).not.toContain(branchName);
    await expect(adapter.create(f.project, { mode: 'existing', path: f.tree, branchName }, [])).rejects.toMatchObject({ code: 'INVALID_BRANCH' });
    expect(executor.calls.some(args => args.includes('worktree') && args.includes('add'))).toBe(false);
    await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
  });

});

describe('absent worktree removal', () => {
  it('removes an absent registered checkout without pruning unrelated missing worktrees', async () => {
    const f = await fixture(); const adapter = new GitAdapter(new LocalExecutor());
    const other = path.join(f.root, 'trees', 'other');
    await adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'absent' }, []);
    await adapter.create(f.project, { mode: 'new', path: other, branchName: 'other' }, []);
    await rm(f.tree, { recursive: true, force: true });
    await adapter.remove(f.project, f.tree, false, []);
    const listed = (await git(f.project.gitRootPath, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).not.toContain(f.tree);
    expect(listed).toContain(other);
  });
});
