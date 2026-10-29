import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../src/shared/ports.js';
import {
  HostProjectProbe, createDefaultBranchProbe, createRepositoryProbe,
  type DefaultBranchProbe, type DirectoryProbe, type ProbeRunner, type RepositoryProbe,
} from '../../src/host/project-probe.js';
import { KanbanError } from '../../src/shared/errors.js';

const directory: DirectoryProbe = { async resolve(value: string) { return value; } };
const noBranch: DefaultBranchProbe = { async resolve() { return undefined; } };

function repository(answer: string | null): RepositoryProbe {
  return { async locate() { return answer; } };
}

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return { exitCode: 0, stdout: '', stderr: '', ...overrides };
}

const notARepository = result({ exitCode: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' });

describe('composed project probe', () => {
  it('reports a Git location with its root and suggested branch', async () => {
    const probe = new HostProjectProbe(directory, repository('/repo'), { async resolve() { return 'main'; } });
    await expect(probe.inspect('/repo/apps/web')).resolves.toEqual({ kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
  });

  it('reports a folder location when no repository contains the path', async () => {
    const probe = new HostProjectProbe(directory, repository(null), noBranch);
    await expect(probe.inspect('/plain/notes')).resolves.toEqual({ kind: 'folder', projectPath: '/plain/notes' });
  });

  it('omits the branch when none is suggested', async () => {
    const probe = new HostProjectProbe(directory, repository('/repo'), noBranch);
    const location = await probe.inspect('/repo');
    expect(location).toEqual({ kind: 'git', projectPath: '/repo', gitRootPath: '/repo' });
    expect('defaultBranch' in location).toBe(false);
  });

  it('rejects a project outside its reported Git root', async () => {
    const probe = new HostProjectProbe(directory, repository('/elsewhere'), noBranch);
    await expect(probe.inspect('/repo/apps/web')).rejects.toMatchObject({ code: 'PROJECT_OUTSIDE_GIT_ROOT' });
  });

  it('keeps a valid repository when the branch suggestion fails', async () => {
    const failing: DefaultBranchProbe = { async resolve() { throw new Error('branch probe failed'); } };
    const probe = new HostProjectProbe(directory, repository('/repo'), failing);
    await expect(probe.inspect('/repo')).resolves.toEqual({ kind: 'git', projectPath: '/repo', gitRootPath: '/repo' });
  });

  it('propagates an unavailable path instead of reporting a folder', async () => {
    const missing: DirectoryProbe = { async resolve(value: string) { throw new KanbanError('PATH_UNAVAILABLE', 'The selected folder cannot be resolved.', { path: value }); } };
    const probe = new HostProjectProbe(missing, repository(null), noBranch);
    await expect(probe.inspect('/missing')).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  });
});

describe('repository probe classification', () => {
  it('returns null only for a repository miss', async () => {
    const probe = createRepositoryProbe(async () => notARepository);
    await expect(probe.locate('/plain')).resolves.toBeNull();
  });

  it('reports an inspection failure as a typed problem', async () => {
    const probe = createRepositoryProbe(async () => result({ exitCode: 1, stderr: 'permission denied' }));
    await expect(probe.locate('/blocked')).rejects.toMatchObject({ code: 'PROBE_FAILED', details: { exitCode: 1 } });
  });

  it('returns the repository top level', async () => {
    const probe = createRepositoryProbe(async () => result({ stdout: '/repo\n' }));
    await expect(probe.locate('/repo/apps/web')).resolves.toBe('/repo');
  });
});

describe('default branch candidate order', () => {
  function runner(answers: Record<string, CommandResult>): ProbeRunner {
    return async argv => answers[argv.slice(3).join(' ')] ?? result({ exitCode: 1 });
  }

  it('prefers the origin/HEAD target', async () => {
    const probe = createDefaultBranchProbe(runner({
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': result({ stdout: 'origin/trunk\n' }),
      'show-ref --verify --quiet refs/heads/main': result({}),
    }));
    await expect(probe.resolve('/repo')).resolves.toBe('trunk');
  });

  it('falls back to local main when origin/HEAD is absent', async () => {
    const probe = createDefaultBranchProbe(runner({ 'show-ref --verify --quiet refs/heads/main': result({}) }));
    await expect(probe.resolve('/repo')).resolves.toBe('main');
  });

  it('falls back to master when main is absent', async () => {
    const probe = createDefaultBranchProbe(runner({ 'show-ref --verify --quiet refs/heads/master': result({}) }));
    await expect(probe.resolve('/repo')).resolves.toBe('master');
  });

  it('falls back to the current branch', async () => {
    const probe = createDefaultBranchProbe(runner({ 'branch --show-current': result({ stdout: 'feature/x\n' }) }));
    await expect(probe.resolve('/repo')).resolves.toBe('feature/x');
  });

  it('reports no suggestion when nothing resolves', async () => {
    const probe = createDefaultBranchProbe(runner({ 'branch --show-current': result({ stdout: '  \n' }) }));
    await expect(probe.resolve('/repo')).resolves.toBeUndefined();
  });
});
