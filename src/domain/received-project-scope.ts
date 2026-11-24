import { isPublishedProject } from '../shared/project.js';
import type { Project } from '../shared/types.js';
import { publishedIdentityOf } from './board-project-scope.js';

/**
 * What a received scope asks of this Hub, decided before anything is written.
 *
 * A received board or document names published identities. This Hub may already answer
 * one with a registered project, may hold a placeholder for another, and may have
 * acknowledged a third without a project. The plan turns those cases into one answer
 * that the team-apply path and the import surface both read, so no surface decides for
 * itself what a received identity means.
 */
export interface ReceivedScopePlan {
  /** The scope to write, unchanged: every received identity keeps its place. */
  readonly identities: readonly string[] | null;
  /** Identities the Hub holds no project for, which the apply must materialize. */
  readonly placeholders: readonly string[];
  /** Identities awaiting adoption: held by a placeholder this installation has not ignored. */
  readonly awaiting: readonly string[];
  /** Identities this installation acknowledged without a project. */
  readonly ignored: readonly string[];
}

/**
 * Plan one received scope against the Hub's projects.
 *
 * An identity keeps its place in the scope in every case, because a placeholder or a
 * registered project answers it. An ignored identity is answered by its hidden
 * placeholder, so it stays out of the adoption list without leaving the scope.
 */
export function planReceivedScope(identities: readonly string[] | null, projects: readonly Project[]): ReceivedScopePlan {
  if (identities === null) return { identities: null, placeholders: [], awaiting: [], ignored: [] };
  const byIdentity = new Map(projects.map(project => [publishedIdentityOf(project), project]));
  const placeholders: string[] = [];
  const awaiting: string[] = [];
  const ignored: string[] = [];
  // A document may repeat an identity; the plan names each identity once, exactly as the
  // written scope and the registry do.
  for (const identity of [...new Set(identities)]) {
    const project = byIdentity.get(identity);
    if (project === undefined) {
      placeholders.push(identity);
      awaiting.push(identity);
      continue;
    }
    if (!isPublishedProject(project)) continue;
    if (project.dismissed === true) ignored.push(identity);
    else awaiting.push(identity);
  }
  return { identities: [...identities], placeholders, awaiting, ignored };
}
