import type { SessionLineage } from '../shared/ports.js';

/**
 * Resolve the sessions owned by a task's conversations.
 *
 * Only explicit subagent edges are followed. Fork lineage and unrelated
 * sessions remain foreign, and an unknown parent is treated as unknown rather
 * than assumed owned.
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
