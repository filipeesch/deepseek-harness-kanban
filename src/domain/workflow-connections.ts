import type { ConnectionLayout, Workflow } from '../shared/types.js';
import { connectionKey } from './connection-anchor.js';
import { writeConnections, type ConnectionLayouts } from './workflow-connections-text.js';

export type { ConnectionLayouts };

function cloneLayout(layout: ConnectionLayout): ConnectionLayout {
  const copy: ConnectionLayout = { from: layout.from, to: layout.to };
  if (layout.source !== undefined) copy.source = { side: layout.source.side, at: layout.source.at };
  if (layout.target !== undefined) copy.target = { side: layout.target.side, at: layout.target.at };
  if (layout.segments !== undefined) copy.segments = layout.segments.map(segment => ({ axis: segment.axis, offset: segment.offset }));
  return copy;
}

/** The authored connection layouts of a parsed workflow, keyed by source and target. */
export function readConnections(workflow: Workflow): Record<string, ConnectionLayout> {
  // A stage id can be any safe identifier, so the record carries no prototype.
  const result: Record<string, ConnectionLayout> = Object.create(null) as Record<string, ConnectionLayout>;
  for (const layout of workflow.connections ?? []) result[connectionKey(layout.from, layout.to)] = cloneLayout(layout);
  return result;
}

/**
 * Rewrite only the connection entries of an authored workflow document,
 * preserving every other character the author wrote. An entry with no requested
 * layout is removed; see writeConnections for the guarantees.
 */
export function setConnections(text: string, layouts: ConnectionLayouts): string {
  return writeConnections(text, layouts);
}
