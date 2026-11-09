import { useCallback, useEffect, useRef, useState } from 'react';
import type { Column, StageSize } from '../../../shared/types.js';

export interface StageMeasurements {
  readonly measured: Map<string, StageSize>;
  readonly measuredRef: React.MutableRefObject<Map<string, StageSize>>;
  /** True once every stage has been measured, so the first paint never jumps. */
  readonly revealed: boolean;
  onMeasure(stageId: string, size: StageSize): void;
  /** Hide the diagram again while a structural workflow change is measured. */
  hide(): void;
}

/**
 * The rendered size of every stage, reported by the stage regions. The diagram
 * stays hidden until every stage has one, then places the layout once.
 */
export function useStageMeasurements(columns: readonly Column[]): StageMeasurements {
  const [measured, setMeasured] = useState<Map<string, StageSize>>(() => new Map());
  const measuredRef = useRef(measured);
  measuredRef.current = measured;
  const [revealed, setRevealed] = useState(false);

  const onMeasure = useCallback((stageId: string, size: StageSize) => {
    setMeasured(current => {
      const existing = current.get(stageId);
      if (existing !== undefined && existing.width === size.width && existing.height === size.height) return current;
      const next = new Map(current);
      next.set(stageId, { width: size.width, height: size.height });
      return next;
    });
  }, []);

  useEffect(() => {
    if (revealed) return;
    if (columns.every(column => measured.has(column.id))) setRevealed(true);
  }, [measured, revealed, columns]);

  const hide = useCallback(() => setRevealed(false), []);
  return { measured, measuredRef, revealed, onMeasure, hide };
}
