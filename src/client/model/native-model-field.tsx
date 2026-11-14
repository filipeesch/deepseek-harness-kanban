import React, { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ModelCatalog, ModelSelection, Problem } from '../../shared/types.js';
import { MODEL_SELECTION_SLOT, NativeSlotHost, useSlotEntries, type NativeSeat } from '../native-slot-host.js';

/** One route as one line, for the read-only states. */
function routeName(value: ModelSelection): string {
  return value.provider + ' · ' + value.model;
}

interface DirectoryState {
  current: ModelSelection | null;
  retainedEffort?: string;
  routable: boolean | null;
  groups: readonly unknown[];
  failures: readonly unknown[];
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
  pending: ModelSelection | null;
  error: string | null;
}

interface DirectoryStore {
  getSnapshot(): DirectoryState;
  subscribe(listener: () => void): () => void;
  set(next: DirectoryState): void;
}

/** The observable store the native selector reads; only its snapshot and subscription are used. */
function createDirectoryStore(initial: DirectoryState): DirectoryStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { state = next; for (const listener of [...listeners]) listener(); },
  };
}

/** Project the catalog, the draft, and the read failure into the native component's state shape. */
function project(value: ModelSelection | undefined, catalog: ModelCatalog | null, error: Problem | null, loading: boolean): DirectoryState {
  const retainedEffort = value?.reasoningEffort === undefined ? {} : { retainedEffort: value.reasoningEffort };
  if (error !== null) {
    return { current: value ?? null, ...retainedEffort, routable: value === undefined ? null : false, groups: [], failures: [], status: 'error', pending: null, error: error.message };
  }
  if (catalog === null) {
    return { current: value ?? null, ...retainedEffort, routable: null, groups: [], failures: [], status: loading ? 'loading' : 'idle', pending: null, error: null };
  }
  const routable = value !== undefined && catalog.providers.some(provider => provider.id === value.provider
    && provider.models.some(model => model.id === value.model));
  return { current: value ?? null, ...retainedEffort, routable, groups: catalog.providers, failures: catalog.failures, status: 'ready', pending: null, error: null };
}

/** The read-only state a host without the native selector leaves: the stored route, never a fallback picker. */
function UnavailableModel({ value, subject }: { value: ModelSelection | undefined; subject: string }): React.ReactElement {
  return <div className="kb-native-model-unavailable" role="status">
    <p className="kb-hint">The native model selector is unavailable on this host. {value === undefined
      ? 'No specific model is selected for this ' + subject + '.'
      : 'This ' + subject + ' keeps ' + routeName(value) + '.'}</p>
  </div>;
}

export interface NativeModelFieldProps {
  /** The native slot registry and locale; absent in isolated render harnesses and hosts without the selector. */
  seat?: NativeSeat | undefined;
  /** The route the form holds, or undefined for none yet. */
  value: ModelSelection | undefined;
  catalog: ModelCatalog | null;
  /** The catalog read failure, forwarded into the selector's own error surface. */
  catalogError?: Problem | null;
  catalogLoading?: boolean;
  onChange: (selection: ModelSelection) => void;
  /** Re-read the catalog; the selector's retry action calls it. */
  onRetry: () => void;
  disabled?: boolean;
  /** What the read-only state talks about, e.g. "board" or "schedule". */
  subject?: string;
}

/**
 * DSH's native model selector for a board default or a schedule model.
 *
 * The selector's own injection is per-session, so this adapter supplies the whole
 * face: a small observable directory projected from the host catalog, a select
 * that writes the form value instead of a session, and the catalog retry. The
 * host locale, the native menu, and the error/retry surface stay the host's. When
 * the host composes no entry, the stored route is presented read-only — there is
 * deliberately no second picker.
 */
export function NativeModelField(props: NativeModelFieldProps): React.ReactElement {
  if (props.seat === undefined) return <UnavailableModel value={props.value} subject={props.subject ?? 'board'} />;
  return <BoundNativeModelField {...props} seat={props.seat} />;
}

function BoundNativeModelField({ seat, value, catalog, catalogError = null, catalogLoading = false, onChange, onRetry, disabled = false, subject = 'board' }: NativeModelFieldProps & { seat: NativeSeat }): React.ReactElement {
  const entries = useSlotEntries(seat.slots, MODEL_SELECTION_SLOT);
  const store = useRef<DirectoryStore | null>(null);
  if (store.current === null) store.current = createDirectoryStore(project(value, catalog, catalogError, catalogLoading));
  const projected = useMemo(() => project(value, catalog, catalogError, catalogLoading), [value, catalog, catalogError, catalogLoading]);
  useEffect(() => { store.current?.set(projected); }, [projected]);

  const select = useCallback(async (selection: unknown): Promise<{ ok: true; value: undefined }> => {
    // The selection is a plain native object; the adapter turns it into the form's value.
    const next = selection as ModelSelection;
    onChange(next);
    const directory = store.current;
    if (directory !== null) directory.set({ ...directory.getSnapshot(), current: next, routable: true, status: 'ready', pending: null, error: null });
    return { ok: true, value: undefined };
  }, [onChange]);
  const face = useMemo(() => ({
    available: true,
    directory: store.current,
    load: onRetry,
    select,
    resolveText: (text: unknown): string => (typeof text === 'string' ? text : ''),
  }), [onRetry, select]);
  const override = useCallback((previous: Record<string, unknown>): Record<string, unknown> => ({ ...previous, ...face }), [face]);
  const renderSlot = useCallback((_key: string, _owner: unknown, options?: { fallback?: ReactNode }): ReactNode => options?.fallback ?? null, []);

  if (entries.length === 0) return <UnavailableModel value={value} subject={subject} />;
  return <div className="kb-native-model" data-native-model-field="">
    <NativeSlotHost
      slot={MODEL_SELECTION_SLOT}
      kind="single"
      source={seat.slots}
      locale={seat.locale}
      standard={{ locked: disabled, renderSlot }}
      override={override}
      fallback={<UnavailableModel value={value} subject={subject} />}
    />
  </div>;
}
