import type { Workflow } from '../../shared/types.js';
import { workflowGraph } from '../workflow-graph.js';
import { placeStages, type StageLayout } from './layout.js';

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
