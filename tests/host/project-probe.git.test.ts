import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHostProjectProbe } from '../../src/host/project-probe.js';
import { cleanup, fixture, gitOk } from '../worktrees/helpers.js';

afterEach(cleanup);

describe('project probe against real repositories', () => {
  it('detects a repository root and its default branch', async () => {
    const f = await fixture();
    await expect(createHostProjectProbe().inspect(f.project.gitRootPath)).resolves.toEqual({
      kind: 'git', projectPath: f.project.gitRootPath, gitRootPath: f.project.gitRootPath, defaultBranch: 'main',
    });
  });

  it('detects a monorepo subdirectory and keeps both paths', async () => {
    const f = await fixture();
    await expect(createHostProjectProbe().inspect(f.project.projectPath)).resolves.toEqual({
      kind: 'git', projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath, defaultBranch: 'main',
    });
  });

  it('reports a folder outside any repository as a folder project', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await expect(createHostProjectProbe().inspect(outside)).resolves.toEqual({ kind: 'folder', projectPath: outside });
  });

  it('reports a missing path as unavailable instead of a folder', async () => {
    const f = await fixture();
    await expect(createHostProjectProbe().inspect(path.join(f.root, 'missing'))).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  });

  it('reports a file as unavailable instead of a folder', async () => {
    const f = await fixture();
    const file = path.join(f.root, 'file.txt');
    await writeFile(file, 'not a directory\n');
    await expect(createHostProjectProbe().inspect(file)).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  });

  it('prefers an explicit origin/HEAD target over a local main branch', async () => {
    const f = await fixture();
    const root = f.project.gitRootPath;
    await gitOk(root, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    await gitOk(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    await expect(createHostProjectProbe().inspect(root)).resolves.toMatchObject({ kind: 'git', defaultBranch: 'trunk' });
  });

  it('reports no suggested branch for a detached repository without local branches', async () => {
    const f = await fixture();
    const root = f.project.gitRootPath;
    await gitOk(root, ['checkout', '--detach', 'HEAD']);
    await gitOk(root, ['branch', '-D', 'main']);
    const location = await createHostProjectProbe().inspect(root);
    expect(location.kind).toBe('git');
    expect('defaultBranch' in location).toBe(false);
  });
});
