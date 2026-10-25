import React, { Component, useMemo, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';

/** Translation seat for one native action namespace. */
export type NativeActionTranslate = (key: string, params?: Record<string, unknown>) => string;

/** A native snapshot source exposed by an entry's inject face. */
interface SnapshotSource { getSnapshot(): unknown; subscribe(listener: () => void): () => void }

export type NativeActionOverride = (entry: StoredEntry, face: Record<string, unknown>) => Record<string, unknown>;

export interface NativeSessionActionsProps {
  entries: readonly StoredEntry[];
  translate: (namespace: string) => NativeActionTranslate;
  /** Session standard props forwarded to every native action component. */
  standard: Record<string, unknown>;
  /** Redirect native callbacks (for example, keep subagent navigation in the drawer). */
  overrideFace?: NativeActionOverride;
}

const NATIVE_STATUS_IDS = new Set(['agent-preset', 'subagent-catalog', 'job-list']);
const absentSource: SnapshotSource = { getSnapshot: () => undefined, subscribe: () => () => {} };
const actionIdentities = new WeakMap<object, number>();
let nextActionIdentity = 0;

/** Stable per-entry identity; a replaced (HMR) entry gets a fresh boundary. */
function actionIdentity(entry: StoredEntry): number {
  let identity = actionIdentities.get(entry);
  if (identity === undefined) { identity = ++nextActionIdentity; actionIdentities.set(entry, identity); }
  return identity;
}

/** Keep only the three status actions, in their native order. */
export function nativeStatusActions(entries: readonly StoredEntry[]): readonly StoredEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.component !== undefined && entry.options.id !== undefined && NATIVE_STATUS_IDS.has(entry.options.id))
    .sort((left, right) => (left.entry.options.order ?? 0) - (right.entry.options.order ?? 0) || left.index - right.index)
    .map(({ entry }) => entry);
}

function hookName(source: string): string {
  return 'use' + source.charAt(0).toUpperCase() + source.slice(1);
}

function selectorHook(source: SnapshotSource | undefined) {
  const resolved = source ?? absentSource;
  // The host contract permits method-based sources; capture stable closures so `this` stays bound.
  const subscribe = (listener: () => void) => resolved.subscribe(listener);
  const getSnapshot = () => resolved.getSnapshot();
  // The three pinned actions pass no equality callback; their source snapshots are stable.
  return function useSelector(selector?: (snapshot: unknown) => unknown, _equal?: (left: unknown, right: unknown) => boolean): unknown {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return selector === undefined ? snapshot : selector(snapshot);
  };
}

class NativeActionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

interface NativeActionProps {
  entry: StoredEntry;
  standard: Record<string, unknown>;
  translate: NativeSessionActionsProps['translate'];
  overrideFace?: NativeActionOverride;
}

function NativeActionBody({ entry, standard, translate, overrideFace }: NativeActionProps) {
  const sessionId = standard.sessionId;
  const face = useMemo(() => {
    let injected: Record<string, unknown> = {};
    try {
      const inject = entry.inject as ((...args: unknown[]) => Record<string, unknown>) | undefined;
      injected = inject?.(sessionId) ?? {};
    } catch { injected = {}; }
    if (overrideFace === undefined) return injected;
    try { return overrideFace(entry, injected); } catch { return injected; }
  }, [entry, sessionId, overrideFace]);
  const { hooks: rawHooks, ...actions } = face;
  const hookProps = useMemo(() => {
    const hooks = (rawHooks ?? {}) as Record<string, SnapshotSource>;
    return Object.fromEntries(Object.entries(hooks).map(([name, source]) => [hookName(name), selectorHook(source)]));
  }, [face]);
  const t = useMemo(() => entry.locale === undefined ? (key: string) => key : translate(entry.locale), [entry.locale, translate]);
  const Action = entry.component as ComponentType<Record<string, unknown>>;
  return <Action {...standard} {...actions} {...hookProps} t={t} />;
}

function NativeAction(props: NativeActionProps) {
  return <NativeActionBoundary><NativeActionBody {...props} /></NativeActionBoundary>;
}

/**
 * Render the pinned host's native header actions without the slot renderer.
 * The entry component, inject face, and locale are private host contracts; this is intentionally
 * contained to the pinned DSH release and must hide, not fake, an unavailable action.
 */
export function NativeSessionActions({ entries, translate, standard, overrideFace }: NativeSessionActionsProps) {
  const actions = nativeStatusActions(entries);
  if (actions.length === 0) return null;
  return <>{actions.map((entry, index) => <NativeAction key={String(entry.options.id ?? index) + ':' + actionIdentity(entry) + ':' + String(standard.sessionId)} entry={entry} standard={standard} translate={translate} {...(overrideFace === undefined ? {} : { overrideFace })} />)}</>;
}
