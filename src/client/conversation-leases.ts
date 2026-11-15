import { useCallback, useSyncExternalStore } from 'react';
import type { ISessions, SessionReference, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client';

/**
 * The Session services a drawer lease needs: retain an exact Session, refresh a
 * catalog miss, and read the client catalog without opening anything.
 */
export type ConversationLeaseSessions = Pick<ISessions, 'retain' | 'refresh' | 'list'>;

/**
 * A durable direct-parent subagent address. It is the native shape the client
 * catalog records for a descendant, kept structural so this module and its
 * tests do not depend on branded host identities.
 */
export interface ConversationLeaseAddress {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode: 'one-shot' | 'continuable' | 'unknown';
}

/** One native Session to retain: a task conversation id, or an addressed descendant. */
export type ConversationLeaseTarget = string | ConversationLeaseAddress;

/** The services a mounted task drawer injects into its lease scope. */
export interface ConversationLeaseEnvironment {
  readonly sessions: ConversationLeaseSessions;
  readonly lifetime: AbortSignal;
}

/** One conversation's retained state, as the drawer consumes it. */
export interface ConversationLeaseState {
  readonly status: 'pending' | 'ready' | 'error';
  readonly reference?: SessionReference;
  readonly error?: string;
}

export type ConversationLeaseSnapshot = Readonly<Record<string, ConversationLeaseState>>;

interface LeaseEntry {
  readonly target: ConversationLeaseTarget;
  state: ConversationLeaseState;
  abort?: AbortController;
  released: boolean;
}

const PENDING: ConversationLeaseState = Object.freeze({ status: 'pending' as const });
const EMPTY: ConversationLeaseSnapshot = Object.freeze({});

/** The snapshot key of one lease: always the child Session id. */
export function conversationLeaseKey(target: ConversationLeaseTarget): string {
  return typeof target === 'string' ? target : target.childSessionId;
}

/**
 * The native acquisition target. Branded identities are the host's concern, so
 * the structural address is asserted once here instead of at every call site.
 */
function sessionTargetOf(target: ConversationLeaseTarget): SessionTarget {
  if (typeof target === 'string') return target as SessionId;
  return {
    parentSessionId: target.parentSessionId as SessionId,
    childSessionId: target.childSessionId as SessionId,
    mode: target.mode,
  } satisfies SubagentAddress;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the native Session references of one mounted task drawer.
 *
 * A root lease survives conversation tab and drawer-section switches and is
 * released when the conversation closes or the drawer leaves the open-session
 * set. A transient lease exists only while the surface that asked for it is
 * mounted, which is how a peeked descendant is retained. Nothing here awaits
 * history settling: a retained reference is published as soon as it exists.
 */
export class ConversationLeaseRegistry {
  private readonly roots = new Map<string, LeaseEntry>();
  private readonly transients = new Map<string, LeaseEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly onLifetimeAbort = (): void => { this.terminated = true; this.releaseAll(); };
  private snapshot: ConversationLeaseSnapshot = EMPTY;
  /** Set only by the plugin lifetime abort; a StrictMode unmount must leave the registry reusable. */
  private terminated = false;

  constructor(private readonly environment: ConversationLeaseEnvironment) {
    if (environment.lifetime.aborted) { this.terminated = true; return; }
    environment.lifetime.addEventListener('abort', this.onLifetimeAbort, { once: true });
  }

  getSnapshot = (): ConversationLeaseSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Retain one conversation of the task; idempotent, and a no-op after an error until retry. */
  acquireRoot(target: ConversationLeaseTarget): void {
    this.acquire(this.roots, target);
  }

  /**
   * Retain one transient descendant for the surface showing it.
   * @param target - addressed descendant, or a Session id when the catalog has no address.
   * @returns the idempotent release for that lease.
   */
  acquireTransient(target: ConversationLeaseTarget): () => void {
    const key = conversationLeaseKey(target);
    this.acquire(this.transients, target);
    return () => this.releaseFrom(this.transients, key);
  }

  /** Retry one failed acquisition, keeping a transient lease transient. */
  retry(sessionId: string): void {
    for (const map of [this.roots, this.transients]) {
      const entry = map.get(sessionId);
      if (entry === undefined) continue;
      const target = entry.target;
      this.releaseFrom(map, sessionId);
      this.acquire(map, target);
      return;
    }
  }

  /** Release one conversation of the task. */
  release(sessionId: string): void {
    this.releaseFrom(this.roots, sessionId);
  }

  /** Release every root lease that no longer belongs to the task's open conversations. */
  retainOnly(openSessionIds: readonly string[]): void {
    const open = new Set(openSessionIds);
    for (const key of [...this.roots.keys()]) if (!open.has(key)) this.releaseFrom(this.roots, key);
  }

  /** Release every retained conversation. */
  releaseAll(): void {
    for (const key of [...this.roots.keys()]) this.releaseFrom(this.roots, key);
    for (const key of [...this.transients.keys()]) this.releaseFrom(this.transients, key);
  }

  /** Release everything and stop observing the lifetime; the instance remains usable for a remount. */
  dispose(): void {
    this.releaseAll();
    this.listeners.clear();
    this.environment.lifetime.removeEventListener('abort', this.onLifetimeAbort);
  }

  private acquire(map: Map<string, LeaseEntry>, target: ConversationLeaseTarget): void {
    if (this.terminated) return;
    const key = conversationLeaseKey(target);
    if (map.has(key)) return;
    const entry: LeaseEntry = { target, state: PENDING, released: false };
    map.set(key, entry);
    if (this.catalogHas(key)) this.retain(map, key, entry);
    else {
      this.publish();
      this.refreshThenRetain(map, key, entry);
    }
  }

  /** A Session is catalogued when the client already lists it. */
  private catalogHas(sessionId: string): boolean {
    try {
      return this.environment.sessions.list.getSnapshot().byId[sessionId as SessionId] !== undefined;
    } catch {
      return false;
    }
  }

  private retain(map: Map<string, LeaseEntry>, key: string, entry: LeaseEntry): void {
    if (!this.current(map, key, entry)) return;
    const abort = new AbortController();
    entry.abort = abort;
    try {
      const reference = this.environment.sessions.retain(sessionTargetOf(entry.target), {
        source: 'kanbanTaskDrawer',
        signal: AbortSignal.any([abort.signal, this.environment.lifetime]),
      });
      entry.abort = undefined;
      // The native content owns open-failure presentation; this only retires a late rejection.
      void reference.ready.catch(() => {});
      entry.state = { status: 'ready', reference };
    } catch (error) {
      entry.abort = undefined;
      entry.state = { status: 'error', error: messageOf(error) };
    }
    this.publish();
  }

  private refreshThenRetain(map: Map<string, LeaseEntry>, key: string, entry: LeaseEntry): void {
    void (async () => {
      try {
        await this.environment.sessions.refresh();
      } catch (error) {
        if (!this.current(map, key, entry)) return;
        entry.state = { status: 'error', error: messageOf(error) };
        this.publish();
        return;
      }
      if (!this.current(map, key, entry)) return;
      if (!this.catalogHas(key)) {
        entry.state = { status: 'error', error: 'The conversation is not available in the session catalog.' };
        this.publish();
        return;
      }
      this.retain(map, key, entry);
    })();
  }

  private releaseFrom(map: Map<string, LeaseEntry>, key: string): void {
    const entry = map.get(key);
    if (entry === undefined) return;
    entry.released = true;
    entry.abort?.abort();
    entry.abort = undefined;
    map.delete(key);
    const reference = entry.state.reference;
    entry.state = { status: 'pending' };
    if (reference !== undefined) {
      try { reference.release(); } catch { /* A released generation may already be gone. */ }
    }
    this.publish();
  }

  private current(map: Map<string, LeaseEntry>, key: string, entry: LeaseEntry): boolean {
    return !this.terminated && !entry.released && map.get(key) === entry;
  }

  private publish(): void {
    const next: Record<string, ConversationLeaseState> = {};
    for (const [key, entry] of this.roots) next[key] = entry.state;
    for (const [key, entry] of this.transients) next[key] = entry.state;
    this.snapshot = next;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* One consumer cannot take down the drawer. */ }
    }
  }
}

/** Subscribe one conversation to a registry snapshot. */
export function useConversationLeaseState(registry: ConversationLeaseRegistry, key: string): ConversationLeaseState | undefined {
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry]);
  const getSnapshot = useCallback(() => registry.getSnapshot()[key], [registry, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
