/** Native navigation targets and the classification the task drawer applies to them. */
import type { Task } from '../shared/types.js';

/** One Session row the client catalog exposes, reduced to the navigation facts. */
export interface DrawerSessionRow {
  readonly parentId?: string;
  readonly origin?: 'subagent';
  /** Reference counts by consumer source; `mainView` identifies the host's current Session. */
  readonly retainedBy?: Readonly<Partial<Record<string, number>>>;
}

/** The client Session catalog, reduced to what navigation classification reads. */
export interface DrawerSessionList {
  readonly byId: Readonly<Record<string, DrawerSessionRow | undefined>>;
}

/** A durable direct-parent subagent address, as the native catalog records it. */
export interface SubagentTarget {
  readonly parentSessionId: string;
  readonly sessionId: string;
  readonly mode: 'one-shot' | 'continuable' | 'unknown';
}

/** The conversation facts navigation resolves against; closed conversations are not navigable. */
export interface TaskConversationScope {
  readonly sessionIds: readonly string[];
  readonly closedSessionIds: readonly string[];
}

/** What one native navigation means to the open task drawer. */
export type NavigationTarget =
  | { readonly kind: 'conversation'; readonly sessionId: string }
  | { readonly kind: 'descendant'; readonly target: SubagentTarget }
  | { readonly kind: 'fork'; readonly parentSessionId: string; readonly sessionId: string }
  /** The catalog has no lineage for this Session yet; one refresh may resolve it. */
  | { readonly kind: 'unclassified' }
  | { readonly kind: 'foreign' };

/**
 * The Session the host currently shows in its main pane, if the catalog reports one.
 *
 * A retain-before-release window can leave both the outgoing and the incoming Session
 * retained; the outgoing one is the previously observed selection, so it is skipped
 * while another row is retained. That matches the host's own disambiguation.
 */
export function mainViewSession(list: DrawerSessionList, previous?: string): string | undefined {
  let fallback: string | undefined;
  for (const [sessionId, row] of Object.entries(list.byId)) {
    if ((row?.retainedBy?.mainView ?? 0) <= 0) continue;
    if (sessionId === previous) { fallback = sessionId; continue; }
    return sessionId;
  }
  return fallback;
}

/** The open conversations of one task; a closed conversation is not a navigation target. */
export function openConversationIds(scope: TaskConversationScope): string[] {
  const closed = new Set(scope.closedSessionIds);
  return scope.sessionIds.filter(sessionId => !closed.has(sessionId));
}

/** A task's conversation scope from the board snapshot shape. */
export function taskConversationScope(task: Pick<Task, 'sessionIds' | 'closedSessionIds'>): TaskConversationScope {
  return { sessionIds: task.sessionIds, closedSessionIds: task.closedSessionIds ?? [] };
}

/**
 * Whether a Session is a direct or nested native subagent descendant of one of
 * the given conversation roots. Only explicit `origin: 'subagent'` edges are
 * followed, so a fork (which records a parent without that origin) is never
 * mistaken for a descendant, and a cycle or a missing row fails closed.
 */
export function isOwnedDescendant(list: DrawerSessionList, rootSessionIds: readonly string[], sessionId: string): boolean {
  if (rootSessionIds.includes(sessionId)) return false;
  const roots = new Set(rootSessionIds);
  const seen = new Set<string>();
  let cursor: string | undefined = sessionId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const row: DrawerSessionRow | undefined = list.byId[cursor];
    if (row === undefined || row.origin !== 'subagent' || row.parentId === undefined) return false;
    if (roots.has(row.parentId)) return true;
    cursor = row.parentId;
  }
  return false;
}

/** Resolve the address of an owned descendant from the catalog, or undefined when it has none. */
export function subagentTarget(list: DrawerSessionList, sessionId: string): SubagentTarget | undefined {
  const row = list.byId[sessionId];
  if (row?.origin !== 'subagent' || row.parentId === undefined) return undefined;
  return { parentSessionId: row.parentId, sessionId, mode: 'unknown' };
}

/**
 * Classify one navigated Session against the open task.
 *
 * A conversation of the task is selected in the drawer, an owned subagent
 * descendant is peeked, a fork of an open conversation is claimed, and
 * everything else — a closed conversation, another task's Session, an
 * ordinary chat, a descendant of another task — keeps the host's native
 * navigation. A Session the catalog has no lineage for is unclassified: a
 * freshly forked child is listed before its authoritative parent arrives, so
 * only a refresh can tell it apart from a brand-new Session.
 */
export function classifyNavigation(list: DrawerSessionList, scope: TaskConversationScope, sessionId: string): NavigationTarget {
  const open = openConversationIds(scope);
  if (open.includes(sessionId)) return { kind: 'conversation', sessionId };
  // A closed conversation of the task stays with the host's navigation.
  if (scope.sessionIds.includes(sessionId)) return { kind: 'foreign' };
  if (isOwnedDescendant(list, open, sessionId)) {
    const target = subagentTarget(list, sessionId);
    return target === undefined ? { kind: 'foreign' } : { kind: 'descendant', target };
  }
  const row = list.byId[sessionId];
  if (row === undefined) return { kind: 'unclassified' };
  if (row.origin === 'subagent') return { kind: 'foreign' };
  if (row.parentId === undefined) return { kind: 'unclassified' };
  if (!open.includes(row.parentId)) return { kind: 'foreign' };
  return { kind: 'fork', parentSessionId: row.parentId, sessionId };
}
