import React, { useCallback, type ReactNode } from 'react';
import { NativeSlotHost, type NativeLocaleSource, type NativeSlotSource } from '../native-slot-host.js';

/** DSH's composer model seat and its optional label child slot. */
export const MODEL_SELECTION_SLOT = 'conversation.input.model';
export const MODEL_SELECTION_LABEL_SLOT = 'conversation.input.model.label';

/** The native slot registry and locale the preparation borrows from the client generation. */
export interface PreparationSeat {
  readonly slots: NativeSlotSource;
  readonly locale: NativeLocaleSource;
}

interface LabelFallbackOptions { fallback?: ReactNode }

/**
 * DSH's native model seat, mounted for a task conversation that is not rendered
 * inside the native conversation surface. The seat's own registration supplies
 * the catalog directory and its selection verbs; this adapter only supplies the
 * session identity, the locale, and the missing label-slot fallback. It never
 * calls `selectModel` itself, so an untouched seat submits nothing.
 */
export function NativeModelSeat({ seat, sessionId, onSelectingChange }: {
  seat: PreparationSeat;
  sessionId: string;
  onSelectingChange?: (selecting: boolean) => void;
}) {
  const renderSlot = useCallback((_key: string, _owner: unknown, options?: LabelFallbackOptions): ReactNode => options?.fallback ?? null, []);
  const override = useCallback((face: Record<string, unknown>): Record<string, unknown> => {
    const select = face.select;
    if (typeof select !== 'function') return face;
    const selectModel = select as (selection: unknown) => Promise<unknown>;
    return {
      ...face,
      select: async (selection: unknown) => {
        onSelectingChange?.(true);
        try { return await selectModel(selection); }
        finally { onSelectingChange?.(false); }
      },
    };
  }, [onSelectingChange]);
  return <div className="kb-preparation-model" data-native-model-seat="">
    <NativeSlotHost
      slot={MODEL_SELECTION_SLOT}
      kind="single"
      source={seat.slots}
      locale={seat.locale}
      standard={{ sessionId, locked: false, renderSlot }}
      override={override}
      fallback={<p className="kb-hint" role="status">The native model selector is unavailable. This conversation will use the default model.</p>}
    />
  </div>;
}
