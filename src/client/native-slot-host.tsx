import React, { Component, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { nativeHookPropName, renderableNativeEntries, type NativeSlotKind } from './native-slot-descriptors.js';

/** The subset of the native slot registry a manual host reads. */
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

/** Lets a host adjust native action callbacks without reimplementing the action. */
export type NativeFaceOverride = (face: Record<string, unknown>) => Record<string, unknown>;

export interface NativeSlotHostProps {
  slot: string;
  kind: NativeSlotKind;
  source: NativeSlotSource;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  fallback?: ReactNode;
  override?: NativeFaceOverride;
}

/** Re-render a manual host when native entries register or unregister. */
export function useSlotEntries(source: NativeSlotSource, slot: string): readonly StoredEntry[] {
  const [, force] = useState(0);
  useEffect(() => source.subscribe(slot, () => force(value => value + 1)), [source, slot]);
  return source.entriesOfSlot(slot);
}

/** Re-render labels when the active locale or dictionary revision changes. */
function useLocaleRevision(locale: NativeLocaleSource): number {
  const subscribe = useCallback((listener: () => void) => locale.subscribe(listener), [locale]);
  const getSnapshot = useCallback(() => locale.getSnapshot().revision, [locale]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useNativeFace(
  entry: StoredEntry,
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
      return override(face);
    } catch {
      return face;
    }
  }, [entry, sessionId, override]);
}

class NativeBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}

interface NativeEntryHostProps {
  entry: StoredEntry;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  override?: NativeFaceOverride;
}

function NativeEntryHost({ entry, locale, standard, override }: NativeEntryHostProps) {
  const sessionId = typeof standard.sessionId === 'string' ? standard.sessionId : undefined;
  const face = useNativeFace(entry, sessionId, override);
  const { hooks, ...actions } = face;
  const hookProps = useMemo(() => {
    const sources = (hooks ?? {}) as Record<string, { getSnapshot(): unknown; subscribe(listener: () => void): () => void }>;
    return Object.fromEntries(Object.entries(sources).map(([name, source]) => [nativeHookPropName(name), nativeSelectorHook(source)]));
  }, [face]);
  const t = entry.locale === undefined ? undefined : locale.bind(entry.locale);
  const Component = entry.component as ComponentType<Record<string, unknown>>;
  return <Component
    {...standard}
    {...actions}
    {...hookProps}
    {...(t === undefined ? {} : { t })}
  />;
}

/**
 * Factory for one native `use<Name>` selector hook. The returned function is
 * called by the native component during its own render; this factory itself
 * does not call a Hook.
 */
function nativeSelectorHook(source: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } | undefined): (selector?: (value: unknown) => unknown, equal?: unknown) => unknown {
  const resolved = source ?? { getSnapshot: () => undefined, subscribe: () => () => {} };
  const subscribe = (listener: () => void) => resolved.subscribe(listener);
  const getSnapshot = () => resolved.getSnapshot();
  return function useSnapshotSelector(selector?: (value: unknown) => unknown, _equal?: unknown): unknown {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return selector === undefined ? snapshot : selector(snapshot);
  };
}

/**
 * Render a native slot's entries through the pinned host assembly, without the
 * slot renderer's ownership check. This is the same deliberate bypass used by
 * the execution-preparation model seat.
 */
export function NativeSlotHost({
  slot, kind, source, locale, standard, fallback = null, override,
}: NativeSlotHostProps) {
  useLocaleRevision(locale);
  const entries = renderableNativeEntries(useSlotEntries(source, slot), kind);
  return entries.length === 0 ? fallback : <>{entries.map(entry => (
    <NativeBoundary key={String(entry.options.id ?? entry.options.key ?? '') + ':' + String(entry.component)}>
      <NativeEntryHost
        entry={entry}
        locale={locale}
        standard={standard}
        {...(override === undefined ? {} : { override })}
      />
    </NativeBoundary>
  ))}</>;
}
