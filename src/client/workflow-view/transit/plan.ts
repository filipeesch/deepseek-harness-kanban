import type { Task } from '../../../shared/types.js';
import { connectionKey } from '../../../domain/connection-anchor.js';
import type { DiagramPoint } from '../routing/orthogonal.js';
import type { WorkflowScene, WorkflowSceneEdge } from '../scene.js';
import { TRANSIT_POLICY, type TransitPolicy } from './policy.js';

/** One card moving along one connection the diagram draws. */
export interface Transit {
  /** Stable for the movement it presents, so a re-render neither remounts nor restarts it. */
  readonly key: string;
  readonly taskId: string;
  readonly fromStageId: string;
  readonly toStageId: string;
  /** The drawn path, in flow coordinates. */
  readonly path: string;
  /** The path's travel distance, which sets the transit's duration. */
  readonly length: number;
}

/** What one commit needs: the transits that fly, and the arrivals that land without a flight. */
export interface TransitPlan {
  readonly transits: readonly Transit[];
  /** Tasks that changed stage where the diagram draws no connection, so nothing flies. */
  readonly immediate: readonly string[];
  /** True when the batch is too large, so nothing flies and nothing pulses. */
  readonly oversize: boolean;
}

export interface TransitPlanInput {
  /** The stage each presented card had before the change. */
  readonly previousStageByTask: ReadonlyMap<string, string>;
  /** The cards the diagram presents, in their presenting order. */
  readonly tasks: readonly Task[];
  /** The committed diagram; only its drawn connections supply a transit. */
  readonly scene: WorkflowScene;
  /** True when the arrangement must settle without motion. */
  readonly settle?: boolean;
  readonly policy?: TransitPolicy;
}

/** The travel distance of a drawn path, measured on the samples its shape already carries. */
export function pathLength(points: readonly DiagramPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/**
 * What one commit needs: one transit per task whose stage changed and whose two
 * stages the diagram connects, and an immediate arrival for every task that changed
 * stage where the diagram draws no connection. A same-stage reorder, a stage the
 * diagram does not show, a settled arrangement, and a batch above the policy's cap
 * all produce neither.
 */
export function planTransit(input: TransitPlanInput): TransitPlan {
  const empty: TransitPlan = { transits: [], immediate: [], oversize: false };
  if (input.settle === true) return empty;
  const policy = input.policy ?? TRANSIT_POLICY;
  const nodes = new Set(input.scene.nodes.map(node => node.id));
  const edges = new Map<string, WorkflowSceneEdge>();
  for (const edge of input.scene.edges) {
    const key = connectionKey(edge.from, edge.to);
    if (!edges.has(key)) edges.set(key, edge);
  }
  const transits: Transit[] = [];
  const immediate: string[] = [];
  for (const task of input.tasks) {
    const from = input.previousStageByTask.get(task.id);
    if (from === undefined || from === task.columnId) continue;
    // A stage the diagram does not show is not a movement it can present.
    if (!nodes.has(from) || !nodes.has(task.columnId)) continue;
    const edge = edges.get(connectionKey(from, task.columnId));
    if (edge === undefined) { immediate.push(task.id); continue; }
    transits.push({
      key: task.id + ':' + connectionKey(from, task.columnId),
      taskId: task.id,
      fromStageId: from,
      toStageId: task.columnId,
      path: edge.shape.path,
      length: pathLength(edge.shape.points),
    });
  }
  if (transits.length + immediate.length > policy.batchLimit) return { transits: [], immediate: [], oversize: true };
  return { transits, immediate, oversize: false };
}
