import { useCallback, useSyncExternalStore } from 'react';
import type { ISessions, SessionReference, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

/**
 * The Session services a drawer lease needs: retain an exact Session, refresh a
 * catalog miss, and read the client catalog without opening anything.
 */
export type ConversationLeaseSessions = Pick<ISessions, 'retain' | 'refresh' | 'list'>;

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
  state: ConversationLeaseState;
  abort?: AbortController;
  released: boolean;
}

const PENDING: ConversationLeaseState = Object.freeze({ status: 'pending' as const });
const EMPTY: ConversationLeaseSnapshot = Object.freeze({});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the native Session references of one mounted task drawer. A root lease
 * survives conversation tab and drawer-section switches; it is released when
 * the conversation closes or the drawer leaves the open-session set. Nothing
 * here awaits history settling: a retained reference is published as soon as
 * it exists.
 */
export class ConversationLeaseRegistry {
  private readonly roots = new Map<string, LeaseEntry>();
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

  /** Retain one conversation root; idempotent, and a no-op after an error until retry. */
  acquireRoot(target: string): void {
    if (this.terminated) return;
    const existing = this.roots.get(target);
    if (existing !== undefined) return;
    const entry: LeaseEntry = { state: PENDING, released: false };
    this.roots.set(target, entry);
    if (this.catalogHas(target)) this.retain(target, entry);
    else {
      this.publish();
      this.refreshThenRetain(target, entry);
    }
  }

  /** Retry one failed acquisition. */
  retry(target: string): void {
    this.release(target);
    this.acquireRoot(target);
  }

  /** Release one root lease. */
  release(key: string): void {
    const entry = this.roots.get(key);
    if (entry === undefined) return;
    entry.released = true;
    entry.abort?.abort();
    entry.abort = undefined;
    this.roots.delete(key);
    const reference = entry.state.reference;
    entry.state = { status: 'pending' };
    if (reference !== undefined) {
      try { reference.release(); } catch { /* A released generation may already be gone. */ }
    }
    this.publish();
  }

  /** Release every root lease that no longer belongs to the task's open conversations. */
  retainOnly(openSessionIds: readonly string[]): void {
    const open = new Set(openSessionIds);
    for (const key of [...this.roots.keys()]) if (!open.has(key)) this.release(key);
  }

  /** Release every retained conversation. */
  releaseAll(): void {
    for (const key of [...this.roots.keys()]) this.release(key);
  }

  /** Release everything and stop observing the lifetime; the instance remains usable for a remount. */
  dispose(): void {
    this.releaseAll();
    this.listeners.clear();
    this.environment.lifetime.removeEventListener('abort', this.onLifetimeAbort);
  }

  /** A string Session id is catalogued when the client already lists it. */
  private catalogHas(target: string): boolean {
    try {
      return this.environment.sessions.list.getSnapshot().byId[target as SessionId] !== undefined;
    } catch {
      return false;
    }
  }

  private retain(key: string, entry: LeaseEntry): void {
    if (!this.current(key, entry)) return;
    const abort = new AbortController();
    entry.abort = abort;
    try {
      const reference = this.environment.sessions.retain(key as unknown as SessionTarget, {
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

  private refreshThenRetain(key: string, entry: LeaseEntry): void {
    void (async () => {
      try {
        await this.environment.sessions.refresh();
      } catch (error) {
        if (!this.current(key, entry)) return;
        entry.state = { status: 'error', error: messageOf(error) };
        this.publish();
        return;
      }
      if (!this.current(key, entry)) return;
      if (!this.catalogHas(key)) {
        entry.state = { status: 'error', error: 'The conversation is not available in the session catalog.' };
        this.publish();
        return;
      }
      this.retain(key, entry);
    })();
  }

  private current(key: string, entry: LeaseEntry): boolean {
    return !this.terminated && !entry.released && this.roots.get(key) === entry;
  }

  private publish(): void {
    const next: Record<string, ConversationLeaseState> = {};
    for (const [key, entry] of this.roots) next[key] = entry.state;
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
