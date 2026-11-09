import type { Task } from '../../shared/types.js';
import { directShape, type DiagramPoint } from './connections.js';
import { nodeRect, type WorkflowScene } from './scene.js';

/** How the card travel reads: a glide along the drawn curve with short fades. */
export const TRAVEL = { durationMs: 450, fadeMs: 120, easing: 'ease-out', batchLimit: 8 } as const;

export interface TravelMove {
  readonly taskId: string;
  readonly fromStageId: string;
  readonly toStageId: string;
  readonly points: readonly DiagramPoint[];
}

/**
 * The cards that must travel after a commit: one per task whose stage changed.
 * A drawn connection between the two stages supplies the curve; otherwise the
 * card takes the direct path. A same-stage reorder, a missing stage, or a batch
 * above the limit produces no travel.
 */
export function planTravel(input: {
  readonly previousStageByTask: ReadonlyMap<string, string>;
  readonly tasks: readonly Task[];
  readonly scene: WorkflowScene;
  readonly batchLimit?: number;
}): TravelMove[] {
  const nodes = new Map(input.scene.nodes.map(node => [node.id, node]));
  const moves: TravelMove[] = [];
  for (const task of input.tasks) {
    const from = input.previousStageByTask.get(task.id);
    if (from === undefined || from === task.columnId) continue;
    const source = nodes.get(from);
    const target = nodes.get(task.columnId);
    if (source === undefined || target === undefined) continue;
    const edge = input.scene.edges.find(candidate => candidate.from === from && candidate.to === task.columnId);
    const points = edge === undefined ? directShape(nodeRect(source), nodeRect(target)).points : edge.shape.points;
    moves.push({ taskId: task.id, fromStageId: from, toStageId: task.columnId, points });
  }
  if (moves.length > (input.batchLimit ?? TRAVEL.batchLimit)) return [];
  return moves;
}
