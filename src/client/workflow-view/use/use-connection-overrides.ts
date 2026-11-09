import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionLayout } from '../../../shared/types.js';
import { sameConnectionLayout } from '../../../domain/connection-anchor.js';
import type { ConnectionLayouts } from '../../../domain/workflow-connections.js';

/** The connection layouts the diagram presents before the workflow acknowledges them. */
export type ConnectionOverrides = Readonly<Record<string, ConnectionLayout | undefined>>;

export interface ConnectionOverridePort {
  readonly overrides: ConnectionOverrides;
  /** Show one layout right away, until the store settles it. */
  intend(connectionId: string, layout: ConnectionLayout): void;
  /** Show a whole set of layouts right away, used to restore an undone change. */
  preview(values: ConnectionLayouts): void;
  reset(): void;
}

/**
 * A connection layout override lives only until the store settles it: the save
 * landing at the same layout, or an external change to the same connection.
 * Removal is an override too, so undoing the adjustment that created an entry
 * hides it before the save lands.
 */
export function useConnectionOverrides(stored: Readonly<Record<string, ConnectionLayout>>): ConnectionOverridePort {
  const [overrides, setOverrides] = useState<ConnectionOverrides>({});
  const baselines = useRef<Record<string, ConnectionLayout | undefined>>({});
  const storedRef = useRef(stored); storedRef.current = stored;

  useEffect(() => {
    setOverrides(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, ConnectionLayout | undefined> = {};
      for (const [id, layout] of entries) {
        const saved = storedRef.current[id];
        const baseline = baselines.current[id];
        const landed = layout === undefined ? saved === undefined : saved !== undefined && sameConnectionLayout(saved, layout);
        const replaced = layout === undefined
          ? saved !== undefined && !sameConnectionLayout(saved, baseline)
          : !sameConnectionLayout(saved, layout) && !sameConnectionLayout(saved, baseline);
        if (landed || replaced) { changed = true; continue; }
        next[id] = layout;
      }
      return changed ? next : current;
    });
  }, [stored]);

  const intend = useCallback((connectionId: string, layout: ConnectionLayout) => {
    baselines.current = { ...baselines.current, [connectionId]: storedRef.current[connectionId] };
    setOverrides(current => ({ ...current, [connectionId]: layout }));
  }, []);

  const preview = useCallback((values: ConnectionLayouts) => {
    // The baseline is the layout the store holds now, so the restore survives
    // until the save that carries it lands.
    const nextBaselines = { ...baselines.current };
    const next: Record<string, ConnectionLayout | undefined> = {};
    for (const id of new Set([...Object.keys(storedRef.current), ...Object.keys(values)])) {
      const wanted = values[id];
      if (sameConnectionLayout(storedRef.current[id], wanted)) continue;
      nextBaselines[id] = storedRef.current[id];
      next[id] = wanted;
    }
    baselines.current = nextBaselines;
    setOverrides(next);
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  return { overrides, intend, preview, reset };
}

/** The layouts the diagram presents: an override wins, and an override of nothing hides the entry. */
export function mergeConnectionOverrides(stored: Readonly<Record<string, ConnectionLayout>>, overrides: ConnectionOverrides): Record<string, ConnectionLayout | undefined> {
  const merged: Record<string, ConnectionLayout | undefined> = { ...stored };
  for (const [id, layout] of Object.entries(overrides)) {
    if (layout === undefined) delete merged[id];
    else merged[id] = layout;
  }
  return merged;
}
