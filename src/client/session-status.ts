/**
 * The native Session status facts the Kanban client reads: each Session's running
 * flag and its effective pending interaction. Hosts publish them under the
 * `uiSession.sessionStatus` service key; releases that predate that sub-service
 * keep the same table as a plain member of `uiSession`, and a host may publish the
 * service only after this plugin activates. The port accepts every vintage, stays
 * empty until one arrives, and never makes activation depend on the newer shape.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';

/** One Session's native facts; every other status field stays unread. */
export interface NativeSessionStatus {
  /** Latest known running state; absent until the host establishes it. */
  readonly running: boolean | undefined;
  /** Highest-precedence request currently awaiting user interaction. */
  readonly pendingInteraction: unknown;
}

/** Native status by Session identity. */
export type NativeSessionStatusSnapshot = ReadonlyMap<string, NativeSessionStatus>;

/** The observable a host vintage's status table satisfies. */
export type NativeSessionStatusSource = HostObservable<NativeSessionStatusSnapshot>;

/** The client-context surfaces the port reads; an older test context may omit some. */
export interface SessionStatusHost {
  /** Service lookup without an inject requirement. */
  readonly get?: (name: string) => unknown;
  /** Host Session service; older releases expose the table as its member. */
  readonly uiSession?: { readonly sessionStatus?: unknown };
  /** Fiber gate that waits for the sub-service without requiring it. */
  readonly inject?: (dependencies: readonly string[], initialize: (scoped: SessionStatusHost) => unknown) => unknown;
}

/** The status source the bridge observes and the release of everything it bound. */
export interface SessionStatusPort {
  /** Native status; empty until a host vintage provides its table. */
  readonly status: NativeSessionStatusSource;
  /** Release the bound table and any pending activation gate. */
  readonly dispose: () => void;
}

const EMPTY: NativeSessionStatusSnapshot = new Map();

/** The Session status table published as a service, when `value` is one. */
function asSource(value: unknown): NativeSessionStatusSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as { getSnapshot?: unknown; subscribe?: unknown };
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined;
  return value as NativeSessionStatusSource;
}

/**
 * Compose the native status port over the host surfaces this context exposes.
 * @param ctx - client context, current or an older vintage.
 * @returns the observed status source and its disposal.
 */
export function createSessionStatusPort(ctx: SessionStatusHost): SessionStatusPort {
  let source: NativeSessionStatusSource | undefined;
  let stopSource: (() => void) | undefined;
  let gate: { dispose?: () => unknown } | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* One consumer cannot take down the other surfaces. */ }
    }
  };
  const status: NativeSessionStatusSource = {
    getSnapshot: () => source?.getSnapshot() ?? EMPTY,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const bind = (next: NativeSessionStatusSource | undefined): void => {
    if (disposed || next === source) return;
    stopSource?.();
    stopSource = next?.subscribe(notify);
    source = next;
    notify();
  };
  // The sub-service, then the member an older release keeps on its Session
  // service. A newer host refuses the member read until the service is injected,
  // so that attempt stays a guarded probe rather than a dependency.
  const service = (scoped: SessionStatusHost): NativeSessionStatusSource | undefined => {
    try { return asSource(scoped.get?.('uiSession.sessionStatus')); } catch { return undefined; }
  };
  const member = (scoped: SessionStatusHost): NativeSessionStatusSource | undefined => {
    try { return asSource(scoped.uiSession?.sessionStatus); } catch { return undefined; }
  };
  bind(service(ctx) ?? member(ctx));
  if (source === undefined) {
    // Wait for the sub-service without requiring it: on a release that never
    // provides it the gate stays pending and the port keeps its empty table.
    try {
      gate = ctx.inject?.(['uiSession.sessionStatus'], (scoped) => {
        bind(service(scoped));
        return () => { bind(undefined); };
      }) as { dispose?: () => unknown } | undefined;
    } catch { gate = undefined; }
  }
  return {
    status,
    dispose: () => {
      disposed = true;
      stopSource?.();
      stopSource = undefined;
      source = undefined;
      const pending = gate;
      gate = undefined;
      try { void pending?.dispose?.(); } catch { /* The gate may already be released with its plugin. */ }
      listeners.clear();
    },
  };
}
