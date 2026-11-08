import type { SessionLineage } from '../shared/ports.js';

/** Session header facts that distinguish a fork from a subagent delegation. */
export interface ForkLineageFacts {
  readonly parentSessionId?: string;
  readonly origin?: 'subagent';
}

/**
 * Whether a session is a fork of another session.
 *
 * Native DSH stores seed lineage in the header's parent session and reserves
 * the subagent origin for delegated children, so a direct parent without a
 * subagent origin is a fork. A session without a parent is a root.
 */
export function isForkLineage(
  entry: ForkLineageFacts,
): entry is ForkLineageFacts & { readonly parentSessionId: string } {
  return entry.parentSessionId !== undefined && entry.origin !== 'subagent';
}

/**
 * Resolve the sessions owned by a task's conversations.
 *
 * Only explicit subagent edges are followed. A fork is owned by becoming a task
 * conversation root through adoption, never by traversal, so unadopted fork
 * lineage and unrelated sessions remain foreign; an unknown parent is treated
 * as unknown rather than assumed owned.
 */
export function ownedSessionIds(
  roots: readonly string[],
  lineage: readonly SessionLineage[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const entry of lineage) {
    if (entry.origin !== 'subagent' || entry.parentSessionId === undefined) continue;
    const siblings = children.get(entry.parentSessionId);
    if (siblings) siblings.push(entry.sessionId);
    else children.set(entry.parentSessionId, [entry.sessionId]);
  }

  const owned = new Set(roots);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index]!;
    for (const child of children.get(parent) ?? []) {
      if (owned.has(child)) continue;
      owned.add(child);
      queue.push(child);
    }
  }
  return owned;
}
