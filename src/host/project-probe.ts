import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { KanbanError } from '../shared/errors.js';
import type { CommandResult, ProjectProbe } from '../shared/ports.js';
import type { ProjectLocation } from '../shared/types.js';
import { containsPath } from './git.js';
import { runHostCommand } from './host-command.js';

/** One plugin-owned command invocation; injectable so probes run without a subprocess in tests. */
export type ProbeRunner = (argv: string[], cwd: string) => Promise<CommandResult>;

/** Canonical, existing directory resolution for a picked path. */
export interface DirectoryProbe {
  resolve(value: string): Promise<string>;
}

/** Repository top-level discovery for a directory. */
export interface RepositoryProbe {
  locate(projectPath: string): Promise<string | null>;
}

/** Suggested default branch for a repository. */
export interface DefaultBranchProbe {
  resolve(gitRootPath: string): Promise<string | undefined>;
}

export function createDirectoryProbe(): DirectoryProbe {
  return {
    async resolve(value: string): Promise<string> {
      if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
        throw new KanbanError('INVALID_PATH', 'An absolute path without control characters is required.', { path: value });
      }
      let canonical: string;
      try { canonical = await realpath(path.resolve(value)); }
      catch (error) {
        throw new KanbanError('PATH_UNAVAILABLE', 'The selected folder cannot be resolved.', { path: value, cause: (error as NodeJS.ErrnoException).code });
      }
      let info: Awaited<ReturnType<typeof stat>>;
      try { info = await stat(canonical); }
      catch (error) {
        throw new KanbanError('PATH_UNAVAILABLE', 'The selected folder cannot be resolved.', { path: canonical, cause: (error as NodeJS.ErrnoException).code });
      }
      if (!info.isDirectory()) throw new KanbanError('PATH_UNAVAILABLE', 'The selected path is not a directory.', { path: canonical });
      return canonical;
    },
  };
}

function notARepository(result: CommandResult): boolean {
  return result.exitCode !== 0 && /not a git repository/i.test(result.stderr);
}

export function createRepositoryProbe(run: ProbeRunner): RepositoryProbe {
  return {
    async locate(projectPath: string): Promise<string | null> {
      const result = await run(['git', '-C', projectPath, 'rev-parse', '--show-toplevel'], projectPath);
      const output = result.stdout.trim();
      if (result.exitCode === 0 && output) return output;
      if (notARepository(result)) return null;
      throw new KanbanError('PROBE_FAILED', 'The Git repository could not be inspected.', {
        path: projectPath, exitCode: result.exitCode, stderr: result.stderr.trim(),
      });
    },
  };
}

/** Ordered candidate resolution: origin/HEAD, local main, local master, current branch, none. */
export function createDefaultBranchProbe(run: ProbeRunner): DefaultBranchProbe {
  return {
    async resolve(gitRootPath: string): Promise<string | undefined> {
      const runGit = (args: string[]) => run(['git', '-C', gitRootPath, ...args], gitRootPath);
      const head = await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
      if (head.exitCode === 0) {
        const branch = head.stdout.trim().replace(/^origin\//, '');
        if (branch) return branch;
      }
      for (const branch of ['main', 'master']) {
        const found = await runGit(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch]);
        if (found.exitCode === 0) return branch;
      }
      const current = await runGit(['branch', '--show-current']);
      if (current.exitCode === 0) {
        const branch = current.stdout.trim();
        if (branch) return branch;
      }
      return undefined;
    },
  };
}

/** Composes the three probes into the single detection contract used by the app and the save path. */
export class HostProjectProbe implements ProjectProbe {
  constructor(
    private readonly directory: DirectoryProbe,
    private readonly repository: RepositoryProbe,
    private readonly branches: DefaultBranchProbe,
  ) {}

  async inspect(value: string): Promise<ProjectLocation> {
    const projectPath = await this.directory.resolve(value);
    const located = await this.repository.locate(projectPath);
    if (located === null) return { kind: 'folder', projectPath };
    const gitRootPath = await this.directory.resolve(located);
    if (!containsPath(gitRootPath, projectPath)) {
      throw new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'The selected project must be inside its Git root.', { projectPath, gitRootPath });
    }
    // A branch suggestion is optional: failing to read it must not reject a valid repository.
    let defaultBranch: string | undefined;
    try { defaultBranch = await this.branches.resolve(gitRootPath); }
    catch { defaultBranch = undefined; }
    return { kind: 'git', projectPath, gitRootPath, ...(defaultBranch === undefined ? {} : { defaultBranch }) };
  }
}

/** Production probe: host-level, read-only, outside any session sandbox. */
export function createHostProjectProbe(run: ProbeRunner = (argv, cwd) => runHostCommand(argv, cwd)): ProjectProbe {
  return new HostProjectProbe(createDirectoryProbe(), createRepositoryProbe(run), createDefaultBranchProbe(run));
}
