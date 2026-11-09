import type { StagePosition, Task, Workflow } from '../../shared/types.js';
import { workflowGraph, type WorkflowConnectionKind } from '../../domain/workflow-graph.js';
import { effectiveStageSize } from '../../domain/stage-size.js';
import { connectionShape, type ConnectionShape, type DiagramRect } from './connections.js';
import { placementBounds, type PlacementBounds, type StageSize } from './layout.js';

export interface WorkflowSceneNode {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly groupId?: string;
  readonly tasks: readonly Task[];
  readonly position: StagePosition;
  readonly size: StageSize;
}

export interface WorkflowSceneEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: WorkflowConnectionKind;
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
  readonly shape: ConnectionShape;
}

export interface WorkflowScene {
  readonly nodes: readonly WorkflowSceneNode[];
  readonly edges: readonly WorkflowSceneEdge[];
  readonly bounds: PlacementBounds;
}

export function nodeRect(node: { position: StagePosition; size: StageSize }): DiagramRect {
  return { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height };
}

/**
 * The diagram's committed model: one node per stage with the cards in it, one
 * edge with the shape to draw, and the extent that fit-to-view frames. The
 * caller filters the tasks, so both presentations can show the same cards.
 */
export function buildWorkflowScene(input: {
  readonly workflow: Workflow;
  readonly tasks: readonly Task[];
  readonly placements: ReadonlyMap<string, StagePosition>;
  readonly sizes?: ReadonlyMap<string, StageSize>;
}): WorkflowScene {
  const graph = workflowGraph(input.workflow);
  const cards = new Map<string, Task[]>();
  for (const task of input.tasks) {
    const list = cards.get(task.columnId);
    if (list === undefined) cards.set(task.columnId, [task]); else list.push(task);
  }
  const sizes = new Map<string, StageSize>();
  const columns = new Map(input.workflow.columns.map(column => [column.id, column]));
  const nodes = graph.nodes.map(node => {
    const size = input.sizes?.get(node.id) ?? effectiveStageSize(columns.get(node.id)?.size);
    sizes.set(node.id, size);
    return {
      id: node.id,
      name: node.name,
      index: node.index,
      ...(node.groupId === undefined ? {} : { groupId: node.groupId }),
      tasks: cards.get(node.id) ?? [],
      position: input.placements.get(node.id) ?? { x: 0, y: 0 },
      size,
    };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const lowest = nodes.reduce((bottom, node) => Math.max(bottom, node.position.y + node.size.height), 0);
  const edges = graph.connections.flatMap(connection => {
    const from = byId.get(connection.from);
    const to = byId.get(connection.to);
    if (from === undefined || to === undefined) return [];
    return [{
      id: connection.from + '->' + connection.to + ':' + connection.fanOut,
      from: connection.from,
      to: connection.to,
      kind: connection.kind,
      returning: connection.returning,
      fanOut: connection.fanOut,
      fanOutCount: connection.fanOutCount,
      shape: connectionShape(nodeRect(from), nodeRect(to), { ...connection, clearance: lowest }),
    }];
  });
  return { nodes, edges, bounds: placementBounds(input.placements, sizes) };
}
