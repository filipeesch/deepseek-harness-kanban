/** Lowercase ASCII slug derived from a task title, used as the default branch name. */
export function taskTitleSlug(title: string): string {
  const ascii = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return slug || 'task';
}

/** Join a configured worktree base path with a branch name without Node path semantics. */
export function worktreePathForBranch(basePath: string | undefined, branchName: string): string {
  const base = (basePath ?? '').trim();
  const branch = (branchName ?? '').trim();
  if (!base || !branch || /[\0\r\n\\]/.test(branch)) return '';
  const segments = branch.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return '';
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const root = base.replace(/[\\/]+$/, '');
  return root + separator + segments.join(separator);
}

/** The repository directory name of a Git root, using the path's own separators. */
export function repositoryName(gitRootPath: string): string {
  const value = (gitRootPath ?? '').trim().replace(/[\\/]+$/, '');
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return index < 0 ? value : value.slice(index + 1);
}

/**
 * The parent directory of a Git root, with the separator that
 * `worktreePathForBranch` needs to keep the path's own style.
 */
export function repositoryParent(gitRootPath: string): string {
  const value = (gitRootPath ?? '').trim().replace(/[\\/]+$/, '');
  const separator = value.includes('\\') && !value.includes('/') ? '\\' : '/';
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (index < 0) return '';
  const parent = value.slice(0, index);
  if (parent === '') return separator;
  return /[\\/]$/.test(parent) ? parent : parent + separator;
}

/**
 * The default destination for a new worktree: the configured base path joined
 * with the branch, or, without a base path, a sibling of the repository named
 * `<repository>-<branch>`. Returns an empty path when no safe destination can
 * be derived, so callers keep an explicit unavailable state instead of guessing.
 */
export function defaultWorktreeDestination(input: { gitRootPath?: string; basePath?: string; branchName: string }): string {
  const branch = (input.branchName ?? '').trim();
  if (!branch) return '';
  const base = (input.basePath ?? '').trim();
  if (base) return worktreePathForBranch(base, branch);
  // Validate the branch on its own before prefixing it with the repository name.
  if (!worktreePathForBranch('branch', branch)) return '';
  const repository = repositoryName(input.gitRootPath ?? '');
  const parent = repositoryParent(input.gitRootPath ?? '');
  if (!repository || !parent) return '';
  return worktreePathForBranch(parent, repository + '-' + branch);
}
