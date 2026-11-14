import type { Column, Workflow } from '../shared/types.js';
import { authoredTransitions } from './transitions.js';
import { workflowGraph } from './workflow-graph.js';

/** Something a composed workflow admits that its author should look at. */
export type WorkflowWarning =
  | { readonly kind: 'unreachable-stage'; readonly stage: string }
  | { readonly kind: 'stage-without-route'; readonly stage: string }
  | { readonly kind: 'undrawn-connection'; readonly from: string; readonly to: string }
  | { readonly kind: 'stage-outside-group'; readonly stage: string }
  /** A cited stage identifier the workflow does not define. */
  | { readonly kind: 'instruction-names-unknown-stage'; readonly stage: string; readonly reference: string; readonly count?: number }
  /** A cited stage identifier that is not a permitted destination of the citing stage. */
  | { readonly kind: 'instruction-names-unpermitted-stage'; readonly stage: string; readonly reference: string; readonly count?: number }
  /** An ordinary word that equals a stage identifier, reported without claiming a routing defect. */
  | { readonly kind: 'instruction-mentions-stage'; readonly stage: string; readonly reference: string; readonly count?: number }
  /** A destination stage declares a parameter its origin stage's instruction never names. */
  | { readonly kind: 'destination-parameter-unmentioned'; readonly stage: string; readonly destination: string; readonly parameter: string }
  /** A card parked in a stage declares parameters it holds no value for. */
  | { readonly kind: 'card-missing-parameters'; readonly stage: string; readonly taskId: string; readonly parameters: readonly string[] };

/** The verb phrases an instruction uses to cite a destination stage. */
const ROUTE_CITATION = /\b(?:declare|route\s+to|transition\s+to|move\s+to|advance\s+to|go\s+to)\s+`?([a-z][a-z0-9_-]{1,63})`?/gi;
/** A stage identifier written between backticks is always a citation. */
const BACKTICK_CITATION = /`([a-z][a-z0-9_-]{1,63})`/g;
/** A token shaped like a stage identifier, used only to report a prose mention. */
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

/** One repeated observation per stage and reference, with how many times it occurred. */
class ObservationList {
  private readonly list: WorkflowWarning[] = [];
  private readonly counts = new Map<string, number>();
  push(warning: WorkflowWarning): void {
    const key = 'reference' in warning ? warning.kind + '\u0000' + warning.stage + '\u0000' + warning.reference : undefined;
    if (key === undefined) { this.list.push(warning); return; }
    const seen = this.counts.get(key);
    this.counts.set(key, (seen ?? 0) + 1);
    if (seen !== undefined) return;
    this.list.push(warning);
  }
  /** The grouped warnings, each carrying the number of occurrences behind it. */
  values(): WorkflowWarning[] {
    return this.list.map(warning => {
      if (!('reference' in warning)) return warning;
      const count = this.counts.get(warning.kind + '\u0000' + warning.stage + '\u0000' + warning.reference) ?? 1;
      return count > 1 ? { ...warning, count } : warning;
    });
  }
}

function instructionWarnings(workflow: Workflow, column: Column, known: Set<string>): WorkflowWarning[] {
  const instruction = column.onEnterPrompt;
  if (instruction === undefined || column.deterministic !== undefined) return [];
  const allowed = destinations(column);
  const observations = new ObservationList();
  const cited = new Set<string>();
  const backticked = new Set<string>();
  const cite = (reference: string): void => {
    if (reference === column.id) return;
    if (!known.has(reference)) observations.push({ kind: 'instruction-names-unknown-stage', stage: column.id, reference });
    else if (allowed !== null && !allowed.has(reference)) observations.push({ kind: 'instruction-names-unpermitted-stage', stage: column.id, reference });
  };
  // Every appearance is pushed, so the group carries how many times it occurred.
  for (const match of instruction.matchAll(BACKTICK_CITATION)) { cited.add(match[1]!); backticked.add(match[1]!); cite(match[1]!); }
  for (const match of instruction.matchAll(ROUTE_CITATION)) {
    const reference = match[1]!;
    // A backticked citation is never counted twice through the phrase it sits next to.
    if (backticked.has(reference)) continue;
    // A bare word after a citing phrase is a citation only when the workflow defines
    // it; otherwise it is the prose the phrase happened to precede.
    if (known.has(reference)) { cited.add(reference); cite(reference); }
    else if (reference !== column.id) observations.push({ kind: 'instruction-mentions-stage', stage: column.id, reference });
  }
  // A destination the stage cannot reach is worth naming even in prose, but as an
  // observation: the workflow format does not make prose a routing declaration.
  if (allowed !== null) {
    for (const match of instruction.matchAll(IDENTIFIER_TOKEN)) {
      const reference = match[0];
      if (reference === column.id || cited.has(reference) || !known.has(reference)) continue;
      if (!allowed.has(reference)) observations.push({ kind: 'instruction-mentions-stage', stage: column.id, reference });
    }
  }
  return observations.values();
}

/** One destination parameter the origin stage's instruction never names. */
function destinationParameterWarnings(workflow: Workflow): WorkflowWarning[] {
  const byId = new Map(workflow.columns.map(column => [column.id, column]));
  const warnings: WorkflowWarning[] = [];
  for (const column of workflow.columns) {
    const instruction = column.onEnterPrompt;
    if (instruction === undefined) continue;
    const targets = destinations(column);
    if (targets === null) continue;
    for (const destinationId of targets) {
      const destination = byId.get(destinationId);
      for (const parameter of destination?.deterministic?.params ?? []) {
        if (new RegExp('\\b' + parameter.name + '\\b', 'i').test(instruction)) continue;
        warnings.push({ kind: 'destination-parameter-unmentioned', stage: column.id, destination: destinationId, parameter: parameter.name });
      }
    }
  }
  return warnings;
}

/** One card parked in a stage that declares parameters it holds no value for. */
function cardParameterWarnings(workflow: Workflow, cards: readonly { readonly id: string; readonly columnId: string; readonly parameters?: readonly string[] }[]): WorkflowWarning[] {
  const byId = new Map(workflow.columns.map(column => [column.id, column]));
  const warnings: WorkflowWarning[] = [];
  for (const card of cards) {
    const declared = byId.get(card.columnId)?.deterministic?.params ?? [];
    if (declared.length === 0) continue;
    const held = new Set(card.parameters ?? []);
    const missing = declared.map(parameter => parameter.name).filter(name => !held.has(name));
    if (missing.length > 0) warnings.push({ kind: 'card-missing-parameters', stage: card.columnId, taskId: card.id, parameters: missing });
  }
  return warnings;
}

/**
 * The graph warnings a composed workflow carries.
 *
 * They describe authored intent that the diagram or the board will ignore, or a
 * journey that cannot be completed: a stage the initial stage never reaches, a
 * stage that is not the last one and leaves nowhere to go, a connection layout
 * for a pair the diagram does not draw, a stage no group claims, an instruction
 * that cites a stage the workflow does not define or that the stage does not
 * permit, a destination parameter the origin instruction never names, and a card
 * without the values its stage declares.
 *
 * A citation is an identifier written between backticks, or an identifier the
 * workflow defines that follows one of the authored citing phrases. A plain word
 * that merely equals a stage identifier is reported as an observation, never as a
 * routing defect. Repeated observations are grouped with their occurrence count.
 * Warnings never block a write; the write report presents them.
 */
export function workflowWarnings(
  workflow: Workflow,
  cards: readonly { readonly id: string; readonly columnId: string; readonly parameters?: readonly string[] }[] = [],
): WorkflowWarning[] {
  const warnings: WorkflowWarning[] = [];
  const graph = workflowGraph(workflow);
  const reached = reachableStages(workflow, workflow.initialColumnId);
  const drawn = new Set(graph.connections.map(connection => connection.from + '\u0000' + connection.to));
  const last = workflow.columns[workflow.columns.length - 1];
  const known = new Set(workflow.columns.map(column => column.id));
  for (const column of workflow.columns) {
    if (!reached.has(column.id)) warnings.push({ kind: 'unreachable-stage', stage: column.id });
    const authored = authoredTransitions(workflow, column.id);
    const hasRoute = graph.connections.some(connection => connection.from === column.id);
    const terminal = column.id === last?.id || (authored?.next === undefined && authored?.targets?.length === 0);
    if (!hasRoute && !terminal) warnings.push({ kind: 'stage-without-route', stage: column.id });
    if (workflow.groups.length > 0 && !workflow.groups.some(group => group.columnIds.includes(column.id))) {
      warnings.push({ kind: 'stage-outside-group', stage: column.id });
    }
    warnings.push(...instructionWarnings(workflow, column, known));
  }
  for (const layout of workflow.connections ?? []) {
    if (!drawn.has(layout.from + '\u0000' + layout.to)) warnings.push({ kind: 'undrawn-connection', from: layout.from, to: layout.to });
  }
  warnings.push(...destinationParameterWarnings(workflow));
  warnings.push(...cardParameterWarnings(workflow, cards));
  return warnings;
}
