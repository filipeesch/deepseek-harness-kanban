import type { Column, Workflow } from '../shared/types.js';
import { authoredTransitions } from './transitions.js';
import { workflowGraph } from './workflow-graph.js';

/** Something a composed workflow admits that its author should look at. */
export type WorkflowWarning =
  | { readonly kind: 'unreachable-stage'; readonly stage: string }
  | { readonly kind: 'stage-without-route'; readonly stage: string }
  | { readonly kind: 'undrawn-connection'; readonly from: string; readonly to: string }
  | { readonly kind: 'stage-outside-group'; readonly stage: string }
  | { readonly kind: 'instruction-names-unknown-stage'; readonly stage: string; readonly reference: string }
  | { readonly kind: 'instruction-names-unpermitted-stage'; readonly stage: string; readonly reference: string };

/** The verb phrases an instruction uses to cite a destination stage. */
const ROUTE_CITATION = /\b(?:declare|route\s+to|transition\s+to|move\s+to|advance\s+to|go\s+to)\s+`?([a-z][a-z0-9_-]{1,63})`?/gi;
/** A token shaped like a stage identifier; prose words are filtered by the known-stage set. */
const IDENTIFIER_TOKEN = /\b[a-z][a-z0-9_-]{2,63}\b/g;

function destinations(column: Column): Set<string> | null {
  // A stage that authors no restriction permits any other stage, so nothing it
  // names can be a disallowed destination.
  if (column.deterministic !== undefined) return new Set(Object.values(column.deterministic.exits));
  if (column.allowedTransitions === undefined) return null;
  return new Set(column.allowedTransitions.map(rule => rule.to));
}

/** Every stage reachable from the initial stage along drawn connections. */
function reachableStages(workflow: Workflow, initial: string): Set<string> {
  const graph = workflowGraph(workflow);
  const outgoing = new Map<string, string[]>();
  for (const connection of graph.connections) {
    const list = outgoing.get(connection.from);
    if (list === undefined) outgoing.set(connection.from, [connection.to]); else list.push(connection.to);
  }
  const reached = new Set<string>([initial]);
  const pending = [initial];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const next of outgoing.get(current) ?? []) if (!reached.has(next)) { reached.add(next); pending.push(next); }
  }
  return reached;
}

function instructionWarnings(workflow: Workflow, column: Column): WorkflowWarning[] {
  const instruction = column.onEnterPrompt;
  if (instruction === undefined || column.deterministic !== undefined) return [];
  const known = new Set(workflow.columns.map(value => value.id));
  const allowed = destinations(column);
  const warnings: WorkflowWarning[] = [];
  const cited = new Set<string>();
  for (const match of instruction.matchAll(ROUTE_CITATION)) {
    const reference = match[1]!;
    if (reference === column.id) continue;
    cited.add(reference);
    if (!known.has(reference)) warnings.push({ kind: 'instruction-names-unknown-stage', stage: column.id, reference });
    else if (allowed !== null && !allowed.has(reference)) warnings.push({ kind: 'instruction-names-unpermitted-stage', stage: column.id, reference });
  }
  // A destination the stage cannot reach is worth naming even when the prose
  // does not use one of the citing phrases; a stage that permits any other
  // stage has nothing to violate, so it is checked only when it restricts.
  if (allowed !== null) {
    for (const match of instruction.matchAll(IDENTIFIER_TOKEN)) {
      const reference = match[0];
      if (reference === column.id || cited.has(reference) || !known.has(reference)) continue;
      if (!allowed.has(reference)) warnings.push({ kind: 'instruction-names-unpermitted-stage', stage: column.id, reference });
    }
  }
  return warnings;
}

/**
 * The graph warnings a composed workflow carries.
 *
 * They describe authored intent that the diagram or the board will ignore, or a
 * journey that cannot be completed: a stage the initial stage never reaches, a
 * stage that is not the last one and leaves nowhere to go, a connection layout
 * for a pair the diagram does not draw, a stage no group claims, and an
 * instruction that cites a stage the workflow does not define or that the stage
 * does not permit. Warnings never block a write; the write report presents them.
 */
export function workflowWarnings(workflow: Workflow): WorkflowWarning[] {
  const warnings: WorkflowWarning[] = [];
  const graph = workflowGraph(workflow);
  const reached = reachableStages(workflow, workflow.initialColumnId);
  const drawn = new Set(graph.connections.map(connection => connection.from + '\u0000' + connection.to));
  const last = workflow.columns[workflow.columns.length - 1];
  for (const column of workflow.columns) {
    if (!reached.has(column.id)) warnings.push({ kind: 'unreachable-stage', stage: column.id });
    const authored = authoredTransitions(workflow, column.id);
    const hasRoute = graph.connections.some(connection => connection.from === column.id);
    const terminal = column.id === last?.id || (authored?.next === undefined && authored?.targets?.length === 0);
    if (!hasRoute && !terminal) warnings.push({ kind: 'stage-without-route', stage: column.id });
    if (workflow.groups.length > 0 && !workflow.groups.some(group => group.columnIds.includes(column.id))) {
      warnings.push({ kind: 'stage-outside-group', stage: column.id });
    }
    warnings.push(...instructionWarnings(workflow, column));
  }
  for (const layout of workflow.connections ?? []) {
    if (!drawn.has(layout.from + '\u0000' + layout.to)) warnings.push({ kind: 'undrawn-connection', from: layout.from, to: layout.to });
  }
  return warnings;
}
