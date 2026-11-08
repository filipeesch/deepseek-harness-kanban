import type { Workflow } from '../shared/types.js';
import { authoredTransitions } from './transitions.js';

/** How the diagram draws a connection: authored explicitly, or the default next stage. */
export type WorkflowConnectionKind = 'explicit' | 'implicit';

/** One stage as the diagram presents it. */
export interface WorkflowStageNode {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  /** The first group that claims this stage, when one does. */
  readonly groupId?: string;
}

/** One drawn connection between two stages. */
export interface WorkflowConnection {
  readonly from: string;
  readonly to: string;
  readonly kind: WorkflowConnectionKind;
  /** The target precedes the source in workflow order. */
  readonly returning: boolean;
  /** This connection's position among the source's outgoing connections. */
  readonly fanOut: number;
  /** How many outgoing connections the source stage has. */
  readonly fanOutCount: number;
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowStageNode[];
  readonly connections: readonly WorkflowConnection[];
}

function groupOf(workflow: Workflow, columnId: string): string | undefined {
  return workflow.groups.find(group => group.columnIds.includes(columnId))?.id;
}

/**
 * The diagram's model of a workflow: one node per stage and the connections the
 * authored configuration draws. A stage that omits transitions contributes the
 * default next-stage connection; an empty list contributes none; a target equal
 * to its own stage is a reorder, not a connection, and is skipped.
 */
export function workflowGraph(workflow: Workflow): WorkflowGraph {
  const indexOf = new Map(workflow.columns.map((column, index) => [column.id, index]));
  const nodes = workflow.columns.map((column, index): WorkflowStageNode => {
    const groupId = groupOf(workflow, column.id);
    return { id: column.id, name: column.name, index, ...(groupId === undefined ? {} : { groupId }) };
  });
  const connections: WorkflowConnection[] = [];
  for (const [index, column] of workflow.columns.entries()) {
    const authored = authoredTransitions(workflow, column.id);
    if (authored === null) continue;
    const candidates = authored.targets === null
      ? (authored.next === undefined ? [] : [authored.next.id])
      : authored.targets;
    const targets = candidates.filter(target => target !== column.id && indexOf.has(target));
    const kind: WorkflowConnectionKind = authored.targets === null ? 'implicit' : 'explicit';
    targets.forEach((target, fanOut) => {
      connections.push({ from: column.id, to: target, kind, returning: indexOf.get(target)! < index, fanOut, fanOutCount: targets.length });
    });
  }
  return { nodes, connections };
}
