import type { StagePosition, Workflow } from '../../shared/types.js';
import { workflowGraph } from '../../domain/workflow-graph.js';
import { placeStages, type StageLayout } from './layout.js';

export type StagePlacements = Readonly<Record<string, StagePosition>>;

/** The workflow structure that automatic placement depends on. */
export function graphKey(workflow: Workflow): string {
  const graph = workflowGraph(workflow);
  return JSON.stringify({
    nodes: graph.nodes.map(node => [node.id, node.index, node.groupId ?? '']),
    connections: graph.connections.map(connection => [connection.from, connection.to, connection.kind]),
  });
}

export interface FrozenAutoLayout { readonly key: string; readonly layout: StageLayout }

/** Recompute automatic placement only when the workflow structure changed. */
export function freezeAutoLayout(previous: FrozenAutoLayout | null, key: string, compute: () => StageLayout): FrozenAutoLayout {
  if (previous !== null && previous.key === key) return previous;
  return { key, layout: compute() };
}

export function computeAutoLayout(workflow: Workflow, sizes: ReadonlyMap<string, { width: number; height: number }>): StageLayout {
  const graph = workflowGraph(workflow);
  return placeStages({ nodes: graph.nodes, connections: graph.connections, sizes });
}

/** Manual overrides win over stored positions, which win over automatic placement. */
export function mergePlacements(automatic: StagePlacements, stored: StagePlacements, overrides: StagePlacements = {}): Map<string, StagePosition> {
  const merged = new Map<string, StagePosition>();
  for (const [id, position] of Object.entries(automatic)) merged.set(id, position);
  for (const [id, position] of Object.entries(stored)) merged.set(id, position);
  for (const [id, position] of Object.entries(overrides)) merged.set(id, position);
  return merged;
}

export function samePosition(left: StagePosition | undefined, right: StagePosition | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y;
}

export function samePlacements(left: StagePlacements, right: StagePlacements): boolean {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const id of ids) if (!samePosition(left[id], right[id])) return false;
  return true;
}
