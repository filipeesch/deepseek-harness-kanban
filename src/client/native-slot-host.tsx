import React, { Component, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { nativeHookPropName, renderableNativeEntries, type NativeSlotKind } from './native-slot-descriptors.js';

/** Snapshot source exposed by a native inject face hook. */
export interface NativeSnapshotSource {
  getSnapshot(): unknown;
  subscribe(listener: () => void): () => void;
}

/** The subset of the native slot registry the manual host reads. */
export interface NativeSlotSource {
  entriesOfSlot(key: string): readonly StoredEntry[];
  subscribe(key: string, listener: () => void): () => void;
}

/** The locale service face the host binds to native entry namespaces. */
export interface NativeLocaleSource {
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string;
  getSnapshot(): { revision: number };
  subscribe(listener: () => void): () => void;
}

export interface NativeSlotOverrideContext {
  slot: string;
  entry: StoredEntry;
  sessionId?: string;
}

/** Lets a host redirect native action callbacks without reimplementing the action. */
export type NativeFaceOverride = (face: Record<string, unknown>, context: NativeSlotOverrideContext) => Record<string, unknown>;

export interface NativeSlotHostProps {
  slot: string;
  kind: NativeSlotKind;
  source: NativeSlotSource;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  owner?: object;
  fallback?: ReactNode;
  /** Rendered before the native entries; used by the mode-seat action band. */
  before?: ReactNode;
  exclude?: (entry: StoredEntry) => boolean;
  override?: NativeFaceOverride;
  renderFactorySlot?: unknown;
}

/** Re-render a manual host when native entries register or unregister. */
export function useSlotEntries(source: NativeSlotSource, slot: string): readonly StoredEntry[] {
  const [, force] = useState(0);
  useEffect(() => source.subscribe(slot, () => force(value => value + 1)), [source, slot]);
  return source.entriesOfSlot(slot);
}

/** Re-render labels when the active locale or dictionary revision changes. */
export function useLocaleRevision(locale: NativeLocaleSource): number {
  const subscribe = useCallback((listener: () => void) => locale.subscribe(listener), [locale]);
  const getSnapshot = useCallback(() => locale.getSnapshot().revision, [locale]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useNativeFace(
  entry: StoredEntry,
  slot: string,
  sessionId: string | undefined,
  override: NativeFaceOverride | undefined,
): Record<string, unknown> {
  return useMemo(() => {
    let face: Record<string, unknown> = {};
    try {
      const inject = entry.inject as ((...args: unknown[]) => Record<string, unknown>) | undefined;
      face = inject?.(sessionId) ?? {};
    } catch {
      face = {};
    }
    if (override === undefined) return face;
    try {
      return override(face, { slot, entry, ...(sessionId === undefined ? {} : { sessionId }) });
    } catch {
      return face;
    }
  }, [entry, slot, sessionId, override]);
}

/**
 * Factory for one native `use<Name>` selector hook. The returned function is
 * called by the native component during its own render; this factory itself
 * does not call a Hook.
 */
export function nativeSnapshotSelectorHook(source: NativeSnapshotSource | undefined): (selector?: (value: unknown) => unknown, equal?: unknown) => unknown {
  const resolved = source ?? { getSnapshot: () => undefined, subscribe: () => () => {} };
  const subscribe = (listener: () => void) => resolved.subscribe(listener);
  const getSnapshot = () => resolved.getSnapshot();
  return function useSnapshotSelector(selector?: (value: unknown) => unknown, _equal?: unknown): unknown {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return selector === undefined ? snapshot : selector(snapshot);
  };
}

function NativeEntryBoundary({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <NativeBoundary fallback={fallback}>{children}</NativeBoundary>;
}

class NativeBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}

interface NativeEntryHostProps {
  entry: StoredEntry;
  slot: string;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  owner?: object;
  override?: NativeFaceOverride;
  renderFactorySlot?: unknown;
}

function NativeEntryHost({ entry, slot, locale, standard, owner, override, renderFactorySlot }: NativeEntryHostProps) {
  const sessionId = typeof standard.sessionId === 'string' ? standard.sessionId : undefined;
  const face = useNativeFace(entry, slot, sessionId, override);
  const { hooks, ...actions } = face;
  const hookProps = useMemo(() => {
    const sources = (hooks ?? {}) as Record<string, NativeSnapshotSource>;
    return Object.fromEntries(Object.entries(sources).map(([name, source]) => [nativeHookPropName(name), nativeSnapshotSelectorHook(source)]));
  }, [face]);
  const t = entry.locale === undefined ? undefined : locale.bind(entry.locale);
  const Component = entry.component as ComponentType<Record<string, unknown>>;
  return <Component
    {...standard}
    {...(owner ?? {})}
    {...actions}
    {...hookProps}
    {...(t === undefined ? {} : { t })}
    {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })}
  />;
}

/**
 * Render a native slot's entries through the pinned host assembly, without the
 * slot renderer's ownership check. This is the same deliberate bypass used by
 * the compact fallback row, generalized for the session header's child slots.
 */
export function NativeSlotHost({
  slot, kind, source, locale, standard, owner, fallback = null, before = null, exclude, override, renderFactorySlot,
}: NativeSlotHostProps) {
  useLocaleRevision(locale);
  const entries = renderableNativeEntries(useSlotEntries(source, slot), kind, {
    ...(exclude === undefined ? {} : { exclude }),
  });
  return <>
    {before}
    {entries.length === 0 ? fallback : entries.map(entry => (
      <NativeEntryBoundary key={String(entry.options.id ?? entry.options.key ?? '') + ':' + String(entry.component)}>
        <NativeEntryHost
          entry={entry}
          slot={slot}
          locale={locale}
          standard={standard}
          {...(owner === undefined ? {} : { owner })}
          {...(override === undefined ? {} : { override })}
          {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })}
        />
      </NativeEntryBoundary>
    ))}
  </>;
}
