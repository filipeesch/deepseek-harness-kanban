/**
 * Finishes an open the host could not target.
 *
 * The native chat opens files, tool line references, page shortcuts, and
 * deliverable previews through the Sidebar service, which acts on the Session
 * that service currently targets: the embedded panel occurrence while it is
 * mounted and expanded, otherwise the Session the main column shows. A task
 * drawer presents a conversation while a board fills the main column, so with
 * its right Sidebar collapsed there is no target at all and the host throws
 * `sidebarRight: no session surface is mounted`; the chat reports "Couldn't
 * open file" with a Retry that fails the same way.
 *
 * The drawer does know which conversation it presents, and the host already
 * exposes the per-Session open its own packages call. This module wraps the two
 * open methods for as long as a drawer conversation is on screen: the host keeps
 * the call, and only a call it could not settle is re-issued for the drawer's
 * Session. That open reveals the column as the host defines, so the drawer's
 * panel opens and the tab lands in it.
 *
 * The shim is structural and removable: it installs only on a host that reports
 * the embedded-panel capability and provides both per-Session methods, writes
 * the wrappers as own properties, and restores the service as received when the
 * seat unmounts. Remove it once the host publishes a session-addressed open.
 */
import { useEffect } from 'react';
import { conversationOf } from './drawer-view.js';
import type { BoardPageState } from './page-state.js';

/**
 * The host members this module narrows. Each per-Session open is optional
 * because a host may predate it; a service without either one installs nothing.
 */
export interface SidebarOpenService {
  /** Capabilities the Sidebar service reports to hosts that render it themselves. */
  readonly capabilities?: { readonly embeddedPanel?: unknown } | undefined;
  /** Open a resource for the Session the service currently targets. */
  openResource(address: string, options?: unknown): void;
  /** Open a page type for the Session the service currently targets. */
  openTab(kind: string, options?: unknown): void;
  /** Open a resource for one named Session. */
  openResourceIn?(sessionId: string, address: string, options?: unknown): void;
  /** Open a page type for one named Session. */
  openTabIn?(sessionId: string, kind: string, options?: unknown): void;
}

/** The Session an open without a surface belongs to. */
export type DrawerSessionSource = () => string | undefined;

/** How to install the fallback for one host service value. */
export interface HostOpenFallbackOptions {
  /** The optional `sidebarRight` service value, untyped because the pinned SDK does not declare it. */
  readonly service: unknown;
  /** The Session the drawer currently presents, read at each open. */
  readonly drawerSession: DrawerSessionSource;
  /** Report a fallback attempt that failed; the original error is rethrown regardless. */
  readonly report?: ((error: unknown) => void) | undefined;
}

/** What an installation holds; disposing restores the service. */
export interface HostOpenFallbackInstallation {
  /** Whether this service was wrapped, by this call or by an earlier one. */
  readonly installed: boolean;
  /** Stop holding the wrappers; the last release restores the service. */
  readonly dispose: () => void;
}

/** What the wrappers read at each open; a later holder replaces it. */
interface FallbackHolders {
  sessionOf: DrawerSessionSource;
  report: ((error: unknown) => void) | undefined;
}

/** One service's live installation: how many holders keep it, whose facts apply, and how to undo it. */
interface Installation {
  count: number;
  readonly holders: FallbackHolders;
  readonly restore: () => void;
}

/** Installations keyed by service value; the service outlives every hold. */
const installations = new WeakMap<object, Installation>();

const NOT_INSTALLED: HostOpenFallbackInstallation = { installed: false, dispose: () => {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow the optional service value.
 * A value that is not an object, lacks the two target-less opens, does not
 * report the embedded panel, or lacks either per-Session open installs nothing:
 * the drawer keeps the host's behavior rather than inventing an open path.
 * @param value - whatever the client reads for `sidebarRight`.
 * @returns the service shape this module can wrap, or undefined.
 */
export function openServiceOf(value: unknown): SidebarOpenService | undefined {
  if (!isRecord(value)) return undefined;
  const capability = isRecord(value.capabilities) ? value.capabilities.embeddedPanel : undefined;
  if (capability !== true) return undefined;
  if (typeof value.openResource !== 'function' || typeof value.openTab !== 'function') return undefined;
  if (typeof value.openResourceIn !== 'function' || typeof value.openTabIn !== 'function') return undefined;
  return value as unknown as SidebarOpenService;
}

/**
 * Wrap one target-less open: the host runs first, and only a call it could not
 * settle is re-issued for the drawer's Session.
 *
 * The Session source and the reporter are read from the holders on every call,
 * so a later mounted seat refreshes them instead of leaving the first seat's
 * Session behind.
 * @param original - the host's own open method.
 * @param perSession - the host's open for a named Session, when it has one.
 * @param holders - what the wrappers read at each open.
 * @returns the replacement method.
 */
function wrapOpen(
  original: (...args: never[]) => unknown,
  perSession: (...args: never[]) => unknown,
  holders: FallbackHolders,
): (...args: unknown[]) => void {
  return function wrappedOpen(this: unknown, ...args: unknown[]): void {
    try {
      Reflect.apply(original, this, args);
      return;
    } catch (failure) {
      const sessionId = safely(() => holders.sessionOf());
      if (sessionId === undefined) throw failure;
      try {
        Reflect.apply(perSession, this, [sessionId, ...args]);
      } catch (error) {
        // The fallback could not help: keep the host's own failure and message.
        try { holders.report?.(error); } catch { /* A failing reporter cannot change the outcome. */ }
        throw failure;
      }
    }
  };
}

/** Read the Session the drawer presents without letting a broken provider break an open. */
function safely(sessionOf: DrawerSessionSource): string | undefined {
  try {
    const sessionId = sessionOf();
    return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined;
  } catch {
    return undefined;
  }
}

/** Put one open method back the way the service had it. */
function restoreMethod(target: SidebarOpenService, key: 'openResource' | 'openTab', original: unknown, owned: boolean): void {
  try {
    if (owned) (target as unknown as Record<string, unknown>)[key] = original;
    else delete (target as unknown as Record<string, unknown>)[key];
  } catch { /* A service that refuses the restore keeps the wrapper; the app is reloading or unloading. */ }
}

/**
 * Write both wrappers and report how to undo them.
 * A service that refuses the write installs nothing, so a host that freezes its
 * service or exposes the opens as read-only members keeps today's behavior.
 * @param service - the narrowed service.
 * @param holders - what the wrappers read at each open.
 * @returns the restore action, or undefined when nothing was written.
 */
function writeWrappers(service: SidebarOpenService, holders: FallbackHolders): (() => void) | undefined {
  const target = service as unknown as Record<string, unknown>;
  const originalResource = target.openResource;
  const originalPage = target.openTab;
  const perSessionResource = target.openResourceIn as (...args: never[]) => unknown;
  const perSessionPage = target.openTabIn as (...args: never[]) => unknown;
  const ownedResource = Object.prototype.hasOwnProperty.call(service, 'openResource');
  const ownedPage = Object.prototype.hasOwnProperty.call(service, 'openTab');
  try { target.openResource = wrapOpen(originalResource as (...args: never[]) => unknown, perSessionResource, holders); }
  catch { return undefined; }
  try { target.openTab = wrapOpen(originalPage as (...args: never[]) => unknown, perSessionPage, holders); }
  catch {
    restoreMethod(service, 'openResource', originalResource, ownedResource);
    return undefined;
  }
  return () => {
    restoreMethod(service, 'openResource', originalResource, ownedResource);
    restoreMethod(service, 'openTab', originalPage, ownedPage);
  };
}

/** Release one hold; the last release restores the service. */
function release(target: object): void {
  const installation = installations.get(target);
  if (installation === undefined) return;
  installation.count -= 1;
  if (installation.count > 0) return;
  installations.delete(target);
  installation.restore();
}

/**
 * Install the fallback for one host service value.
 *
 * A supported service is wrapped once no matter how many seats hold it. A
 * second call shares that installation and makes its holder the authoritative
 * source: that holder's Session and reporter stay in force until the last
 * release restores the service, because the newest mounted seat is the one the
 * person is looking at. A host without the capability or without a per-Session
 * open is left exactly as received.
 * @param options - the service value, the drawer Session source, and the reporter.
 * @returns whether the service is wrapped, and the release that restores it.
 */
export function installHostOpenFallback({ service, drawerSession, report }: HostOpenFallbackOptions): HostOpenFallbackInstallation {
  const target = openServiceOf(service);
  if (target === undefined) return NOT_INSTALLED;
  const existing = installations.get(target);
  if (existing !== undefined) {
    existing.count += 1;
    // A later seat owns the destination: its Session and reporter replace the
    // first holder's rather than being silently ignored.
    existing.holders.sessionOf = drawerSession;
    existing.holders.report = report;
    return { installed: true, dispose: once(target) };
  }
  const holders: FallbackHolders = { sessionOf: drawerSession, report };
  const restore = writeWrappers(target, holders);
  if (restore === undefined) return NOT_INSTALLED;
  installations.set(target, { count: 1, holders, restore });
  return { installed: true, dispose: once(target) };
}

/** Make one holder's release idempotent, so a double dispose cannot release someone else's hold. */
function once(target: object): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release(target);
  };
}

/**
 * Read the Session the drawer presents: the conversation of the open task, or
 * nothing when no drawer is open or the task page state was never created.
 *
 * A presented subagent peek leaves the task conversation in the view, so an
 * open inside the peek targets that conversation's panel — which the peek does
 * not draw; the open is not visible until the peek ends. The read never creates
 * page state.
 * @param pageState - the board page state the drawer writes.
 * @returns the presented conversation Session, or undefined.
 */
export function drawerConversationSession(pageState: BoardPageState): string | undefined {
  const taskId = pageState.selectedTaskId;
  if (taskId === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(pageState.drawers, taskId)) return undefined;
  const page = pageState.drawers[taskId];
  if (page === undefined) return undefined;
  return conversationOf(page.view) ?? undefined;
}

/**
 * Install the open fallback for as long as the conversation seat is mounted.
 *
 * The panel's service may arrive after this client generation applies, so this
 * seat installs from the resolved value and re-installs when that value changes.
 * @param props - the optional service value and the drawer Session source.
 * @returns nothing; the seat renders no markup.
 */
export function HostOpenFallback({ service, drawerSession }: {
  readonly service: unknown;
  readonly drawerSession: DrawerSessionSource;
}): null {
  useEffect(() => {
    const installation = installHostOpenFallback({
      service,
      drawerSession,
      report: error => { console.warn('kanban: host open fallback', error); },
    });
    return installation.dispose;
  }, [service, drawerSession]);
  return null;
}