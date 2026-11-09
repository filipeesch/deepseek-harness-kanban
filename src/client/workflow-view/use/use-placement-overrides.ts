import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StagePosition, StageSize } from '../../../shared/types.js';
import { effectiveStageSize } from '../../../domain/stage-size.js';
import { samePosition } from '../../../domain/stage-position.js';
import type { StagePositions } from '../../../domain/workflow-positions.js';
import type { StageSizes } from '../../../domain/workflow-sizes.js';

export interface PlacementOverrides {
  /** The position overrides this session is showing, keyed by stage id. */
  readonly positions: Readonly<Record<string, StagePosition>>;
  /** The size overrides this session is showing, keyed by stage id. */
  readonly sizes: Readonly<Record<string, StageSize>>;
  /** Remember the acknowledged position the edit of one stage started from. */
  beginPosition(stageId: string): void;
  setPosition(stageId: string, position: StagePosition): void;
  /** Drop every position override; a restored layout replaces them. */
  clearPositions(): void;
  /** Remember the acknowledged size the resize of one stage started from. */
  beginSize(stageId: string): void;
  setSize(stageId: string, size: StageSize): void;
  cancelSize(stageId: string): void;
  /** Show the sizes of a restored layout right away, before its save lands. */
  previewSizes(target: StageSizes, intended: StageSizes): void;
  /** Return both fields to the acknowledged workflow. */
  reset(): void;
}

export interface PlacementOverridesInput {
  /** The acknowledged placements, so an override settles when the store agrees. */
  readonly stored: StagePositions;
  readonly storedSizes: StageSizes;
}

/**
 * The optimistic layout of one diagram session: the positions and sizes the
 * diagram shows before the coalesced workflow save lands, the acknowledged value
 * each edit started from, and the rule that settles an override when the store
 * catches up or an external change replaces it. The save queue and the history
 * stay in the view; this hook only decides what is shown.
 */
export function usePlacementOverrides(input: PlacementOverridesInput): PlacementOverrides {
  const storedRef = useRef(input.stored); storedRef.current = input.stored;
  const storedSizesRef = useRef(input.storedSizes); storedSizesRef.current = input.storedSizes;
  const [positions, setPositions] = useState<Record<string, StagePosition>>({});
  const [sizes, setSizes] = useState<Record<string, StageSize>>({});
  const positionBaselines = useRef<Record<string, StagePosition | undefined>>({});
  const sizeBaselines = useRef<Record<string, StageSize | undefined>>({});

  // An override lives only until the store settles it: the save landing at the
  // same position, an external change, or an external removal.
  useEffect(() => {
    setPositions(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, StagePosition> = {};
      for (const [id, position] of entries) {
        const saved = input.stored[id];
        const baseline = positionBaselines.current[id];
        const landed = saved !== undefined && samePosition(saved, position);
        const replaced = saved === undefined
          ? baseline !== undefined
          : !samePosition(saved, position) && !samePosition(saved, baseline);
        if (landed || replaced) { changed = true; continue; }
        next[id] = position;
      }
      return changed ? next : current;
    });
  }, [input.stored]);

  // A size override is settled by the same save that stores it, or yields to an
  // external change, exactly like a position override: an acknowledged size that
  // differs from the baseline the edit started from wins. A stage whose authored
  // size is gone renders at the minimum, so that also settles.
  useEffect(() => {
    setSizes(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, StageSize> = {};
      for (const [id, size] of entries) {
        const saved = effectiveStageSize(input.storedSizes[id]);
        const baseline = effectiveStageSize(sizeBaselines.current[id]);
        const landed = saved.width === size.width && saved.height === size.height;
        const replaced = saved.width !== baseline.width || saved.height !== baseline.height;
        if (landed || replaced) { changed = true; continue; }
        next[id] = size;
      }
      return changed ? next : current;
    });
  }, [input.storedSizes]);

  const beginPosition = useCallback((stageId: string) => {
    positionBaselines.current = Object.assign(
      Object.create(null) as Record<string, StagePosition | undefined>,
      positionBaselines.current,
      { [stageId]: storedRef.current[stageId] },
    );
  }, []);

  const setPosition = useCallback((stageId: string, position: StagePosition) => {
    setPositions(current => ({ ...current, [stageId]: position }));
  }, []);

  const clearPositions = useCallback(() => setPositions({}), []);

  const beginSize = useCallback((stageId: string) => {
    sizeBaselines.current = { ...sizeBaselines.current, [stageId]: storedSizesRef.current[stageId] };
  }, []);

  const setSize = useCallback((stageId: string, size: StageSize) => {
    setSizes(current => ({ ...current, [stageId]: size }));
  }, []);

  const cancelSize = useCallback((stageId: string) => {
    setSizes(current => {
      if (!Object.prototype.hasOwnProperty.call(current, stageId)) return current;
      const next = { ...current };
      delete next[stageId];
      return next;
    });
  }, []);

  /** Show the intended sizes right away, the way a layout snapshot restores positions. */
  const previewSizes = useCallback((target: StageSizes, intended: StageSizes) => {
    const ids = new Set([...Object.keys(intended), ...Object.keys(target)]);
    const next: Record<string, StageSize> = {};
    const nextBaselines: Record<string, StageSize | undefined> = { ...sizeBaselines.current };
    for (const id of ids) {
      const wanted = effectiveStageSize(target[id]);
      const current = effectiveStageSize(storedSizesRef.current[id]);
      // An override that changes nothing would outlive the edit and mask a later
      // acknowledged size, so it is only set when the rendition must change now.
      if (wanted.width === current.width && wanted.height === current.height) continue;
      next[id] = wanted;
      nextBaselines[id] = storedSizesRef.current[id];
    }
    sizeBaselines.current = nextBaselines;
    setSizes(next);
  }, []);

  const reset = useCallback(() => {
    setPositions({});
    setSizes({});
    sizeBaselines.current = {};
  }, []);

  return useMemo(() => ({
    positions, sizes, beginPosition, setPosition, clearPositions,
    beginSize, setSize, cancelSize, previewSizes, reset,
  }), [positions, sizes, beginPosition, setPosition, clearPositions, beginSize, setSize, cancelSize, previewSizes, reset]);
}
