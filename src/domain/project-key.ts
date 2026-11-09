import { KanbanError, invariant } from '../shared/errors.js';

/** A project key is file- and URL-safe, and stable across a rename, a relocation, and a publication. */
export const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The key a project name suggests: lowercase, hyphen-separated, bounded. */
export function projectKeyFromName(name: string): string {
  const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug.length > 0 ? slug : 'project';
}

/**
 * A deterministic key that no project of the Hub uses yet. Two installations that
 * register the same repository name derive the same key without configuration.
 */
export function allocateProjectKey(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = projectKeyFromName(name);
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const suffix = '-' + index;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  throw new KanbanError('PROJECT_KEY_EXHAUSTED', 'Could not allocate a unique project key.');
}

/**
 * Assign a deterministic key to every record that predates project keys. Existing keys
 * are kept and seed the taken set, so a backfill never produces a duplicate.
 */
export function withProjectKeys<T extends { name: string; projectKey?: string }>(projects: readonly T[]): T[] {
  const present = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const taken = new Set(projects.flatMap(project => present(project.projectKey) ? [project.projectKey] : []));
  return projects.map(project => {
    if (present(project.projectKey)) return project;
    const assigned = allocateProjectKey(project.name, taken);
    taken.add(assigned);
    return { ...project, projectKey: assigned };
  });
}

/**
 * The canonical scope: de-duplicated and ordered, so two equal sets always compare
 * equal no matter which order the keys were chosen in.
 */
export function canonicalProjectKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort();
}

/** Validate an edited key, normalizing its case; the pattern keeps it safe in a published document. */
export function requireProjectKey(value: unknown): string {
  invariant(typeof value === 'string', 'INVALID_PROJECT_KEY', 'A project key must be text.');
  const key = value.trim().toLocaleLowerCase();
  invariant(PROJECT_KEY_PATTERN.test(key), 'INVALID_PROJECT_KEY', 'A project key must start with a letter or digit and contain only lowercase letters, digits, and hyphens.');
  return key;
}
