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
