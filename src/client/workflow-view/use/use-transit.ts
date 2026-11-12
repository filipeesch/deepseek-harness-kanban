import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../../../shared/types.js';
import type { WorkflowScene } from '../../../domain/diagram/scene.js';
import { planTransit, type Transit } from '../transit/plan.js';
import type { TransitPolicy } from '../transit/policy.js';

export interface TransitState {
  readonly transits: readonly Transit[];
  /** Removes one transit once its particles have arrived. */
  arrive(transit: Transit): void;
}

export interface TransitInput {
  /** The cards the diagram presents, its optimistic placement included. */
  readonly tasks: readonly Task[];
  /** The committed diagram, whose drawn connections supply the paths. */
  readonly scene: WorkflowScene;
  /** Changes when the presented view is replaced, so a replacement settles. */
  readonly resetKey: string;
  /** True when the host asks for reduced motion. */
  readonly reducedMotion: boolean;
  /** False when the host cannot animate an element along a path. */
  readonly supported: boolean;
  /** Starts the arrival pulse of a task that reached a stage, flown or not. */
  readonly onArrive?: (taskId: string) => void;
  readonly policy?: TransitPolicy;
}

/** Whether two transit lists present the same flights, in the same order. */
function sameFlights(previous: readonly Transit[], next: readonly Transit[]): boolean {
  return previous.length === next.length && next.every((transit, index) => transit.key === previous[index]?.key);
}

/**
 * The transit that plays after a stage change. The stage each presented card had is
 * kept between commits, so one movement yields one transit; an optimistic
 * presentation and its authoritative confirmation are the same movement, and an
 * unrelated change to the presented cards clears nothing.
 *
 * A card that moves again before its flight lands invalidates that flight, so the
 * superseded arrival can never pulse twice, and the hook reports every arrival,
 * flown or immediate, through one callback; the view decides how a card presents it.
 */
export function useTransit(input: TransitInput): TransitState {
  const [transits, setTransits] = useState<readonly Transit[]>([]);
  /** The flights that are live right now; the single source of truth for an arrival. */
  const live = useRef<readonly Transit[]>([]);
  const previousStages = useRef<Map<string, string> | null>(null);
  const shownView = useRef(input.resetKey);
  const latest = useRef(input);
  latest.current = input;

  const stagesKey = useMemo(() => input.tasks.map(task => task.id + ':' + task.columnId).join('|'), [input.tasks]);
  const settled = input.reducedMotion || !input.supported;

  const show = useCallback((next: readonly Transit[]) => {
    const unchanged = sameFlights(live.current, next);
    live.current = next;
    if (!unchanged) setTransits(next);
  }, []);

  // A host that starts asking for reduced motion, or loses the capability, settles
  // immediately: a flight hidden by CSS would never report its arrival and would leak.
  useEffect(() => {
    if (!settled) return;
    show([]);
  }, [settled, show]);

  useEffect(() => {
    const current = latest.current;
    const stageByTask = new Map(current.tasks.map(task => [task.id, task.columnId]));
    const before = previousStages.current;
    const replaced = shownView.current !== current.resetKey;
    shownView.current = current.resetKey;
    previousStages.current = stageByTask;
    if (before === null || replaced) { show([]); return; }
    const moved = new Set<string>();
    for (const [taskId, stage] of stageByTask) {
      const previous = before.get(taskId);
      if (previous !== undefined && previous !== stage) moved.add(taskId);
    }
    // Nothing moved: a change to the presented cards clears nothing.
    if (moved.size === 0) return;
    if (!current.reducedMotion && current.supported) {
      const plan = planTransit({
        previousStageByTask: before,
        tasks: current.tasks,
        scene: current.scene,
        ...(current.policy === undefined ? {} : { policy: current.policy }),
      });
      // A task that moved again replaces its own flight, whether or not the new
      // movement has a drawn connection to fly along.
      show(live.current.filter(flight => !moved.has(flight.taskId)));
      if (plan.oversize) return;
      // A stage change the diagram draws no connection for presents no flight, but the
      // card still arrives: the pulse is the only signal it moved.
      for (const taskId of plan.immediate) current.onArrive?.(taskId);
      const next = [...live.current];
      for (const transit of plan.transits) {
        // The same movement is never presented twice.
        if (next.some(flight => flight.key === transit.key)) continue;
        next.push(transit);
      }
      show(next);
      return;
    }
    show([]);
  }, [stagesKey, input.resetKey, settled, show]);

  const arrive = useCallback((transit: Transit) => {
    const current = latest.current;
    // A superseded flight never arrives, so it can never pulse twice.
    if (!live.current.some(flight => flight.key === transit.key)) return;
    show(live.current.filter(flight => flight.key !== transit.key));
    // A card the diagram no longer presents has nowhere to present a pulse.
    if (!current.tasks.some(task => task.id === transit.taskId)) return;
    current.onArrive?.(transit.taskId);
  }, [show]);

  return { transits, arrive };
}
