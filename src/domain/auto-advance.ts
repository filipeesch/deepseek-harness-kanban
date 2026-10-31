import type { Column, Workflow } from '../shared/types.js';
import { entryInstruction } from './stage-entry.js';

/** One automatic advance's resolved path: every stage crossed, ending at the destination. */
export interface AutoAdvancePlan {
  /** The stage the resolution started from; admission requires the task to still be there. */
  fromColumnId: string;
  path: Column[];
  destination?: Column;
  /** The destination's entry instruction, or undefined when the destination has none. */
  instruction?: string;
}

/**
 * The configured destination for one stage: the first configured allowed
 * transition when the stage configures transitions, otherwise the following
 * column in workflow order. A self or unknown target has no destination.
 */
export function nextConfiguredColumn(workflow: Workflow, fromColumnId: string): Column | undefined {
  const index = workflow.columns.findIndex(column => column.id === fromColumnId);
  if (index < 0) return undefined;
  const source = workflow.columns[index]!;
  if (source.allowedTransitions !== undefined) {
    const first = source.allowedTransitions[0];
    if (first === undefined) return undefined;
    const target = workflow.columns.find(column => column.id === first);
    return target && target.id !== fromColumnId ? target : undefined;
  }
  const next = workflow.columns[index + 1];
  return next && next.id !== fromColumnId ? next : undefined;
}

/**
 * Resolve the automatic advance path. Stages without an entry instruction are
 * crossed toward the first reachable instructed stage; when no reachable stage
 * has one, the path ends at the last reachable stage. A stage already visited in
 * the same resolution is never revisited, so a configured cycle cannot loop.
 */
export function resolveAutoAdvance(workflow: Workflow, fromColumnId: string): AutoAdvancePlan {
  const path: Column[] = [];
  const visited = new Set<string>([fromColumnId]);
  let cursor = fromColumnId;
  for (;;) {
    const next = nextConfiguredColumn(workflow, cursor);
    if (!next || visited.has(next.id)) break;
    path.push(next);
    visited.add(next.id);
    cursor = next.id;
    const instruction = entryInstruction(next);
    if (instruction !== undefined) return { fromColumnId, path, destination: next, instruction };
  }
  const destination = path[path.length - 1];
  return destination === undefined ? { fromColumnId, path } : { fromColumnId, path, destination };
}
