import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionLayout, StagePosition, StageSize, Task, Workflow } from '../../../shared/types.js';
import { prefersReducedMotion } from '../../card-motion/preference.js';
import { buildWorkflowScene } from '../scene.js';
import { planTravel } from '../travel.js';
import type { TravelMoveView } from '../travel-layer.js';

export interface TravelState {
  readonly travel: readonly TravelMoveView[];
  finish(): void;
}

export interface TravelInput {
  readonly workflow: Workflow;
  /** Every task of the board, used to detect a stage change. */
  readonly stateTasks: readonly Task[];
  /** The tasks the active search and project filter present. */
  readonly tasks: readonly Task[];
  readonly placements: ReadonlyMap<string, StagePosition>;
  readonly measured: ReadonlyMap<string, StageSize>;
  /** The connection layouts the diagram presents, so a card follows the drawn arrow. */
  readonly connections?: Readonly<Record<string, ConnectionLayout | undefined>>;
}

/** The card travel that plays after a committed stage change. */
export function useTravel(input: TravelInput): TravelState {
  const [travel, setTravel] = useState<readonly TravelMoveView[]>([]);
  const serial = useRef(0);
  const previousStages = useRef<Map<string, string> | null>(null);
  const latest = useRef(input);
  latest.current = input;

  const stagesKey = useMemo(() => input.stateTasks.map(task => task.id + ':' + task.columnId).join('|'), [input.stateTasks]);
  const visibleKey = useMemo(() => input.tasks.map(task => task.id).join('|'), [input.tasks]);

  useEffect(() => {
    const current = latest.current;
    const stageByTask = new Map(current.stateTasks.map(task => [task.id, task.columnId]));
    const before = previousStages.current;
    previousStages.current = stageByTask;
    if (before === null || prefersReducedMotion()) return;
    // Only cards the active search and project filter present may travel.
    const committed = buildWorkflowScene({
      workflow: current.workflow, tasks: current.tasks, placements: current.placements, sizes: current.measured,
      ...(current.connections === undefined ? {} : { connections: current.connections }),
    });
    const moves = planTravel({ previousStageByTask: before, tasks: current.tasks, scene: committed });
    if (moves.length === 0) {
      setTravel(currentTravel => currentTravel.length === 0 ? currentTravel : []);
      return;
    }
    const titles = new Map(current.tasks.map(task => [task.id, task.title]));
    setTravel(moves.map(move => ({
      id: move.taskId + ':' + (serial.current += 1),
      title: titles.get(move.taskId) ?? move.taskId,
      points: move.points,
    })));
  }, [stagesKey, visibleKey]);

  const finish = useCallback(() => setTravel([]), []);
  return { travel, finish };
}
