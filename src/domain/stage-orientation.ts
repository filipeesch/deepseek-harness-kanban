import type { Column, Workflow } from '../shared/types.js';
import { routingPolicy, stageKind, type RoutingPolicy, type StageKind } from './stage-kind.js';
import { transitionTargets } from './transitions.js';

/** A stage as the surfaces name it, and as another stage's exit names its destination. */
export interface StageReference {
  readonly id: string;
  readonly name: string;
  readonly kind: StageKind;
  /** The stage's authored description; absent when none is authored. */
  readonly responsibility?: string;
}

/**
 * One way out of a stage. A configured exit may carry its authored condition, a
 * scripted exit carries its name, and a decision option carries its identity and
 * title. The option's description and the gate's answer are never part of it.
 */
export interface OrientationExit {
  readonly to: StageReference;
  readonly condition?: string;
  readonly exit?: string;
  readonly option?: { readonly id: string; readonly title: string };
}

/** The neutral facts about one stage of a workflow: what it is, what it owns, and where it leads. */
export interface StageOrientation {
  readonly stage: StageReference;
  readonly routing: RoutingPolicy;
  readonly exits: readonly OrientationExit[];
}

/** The stage as a reference. A blank description is absent; no text is invented for it. */
export function stageReference(column: Column): StageReference {
  return {
    id: column.id,
    name: column.name,
    kind: stageKind(column),
    ...(column.description?.trim() ? { responsibility: column.description } : {}),
  };
}

/**
 * Orient one stage against the workflow that is active now. It reads no entry
 * instruction, script code, parameter value, or option description, so nothing a
 * surface renders from it can leak them. An unknown stage has no orientation.
 */
export function orientStage(workflow: Workflow, columnId: string): StageOrientation | undefined {
  const column = workflow.columns.find(value => value.id === columnId);
  if (column === undefined) return undefined;
  const reference = (id: string): StageReference | undefined => {
    const target = workflow.columns.find(value => value.id === id);
    return target === undefined ? undefined : stageReference(target);
  };
  const routing = routingPolicy(column);
  const exits: OrientationExit[] = [];
  if (column.decision !== undefined) {
    for (const option of column.decision.options) {
      const to = reference(option.to);
      if (to !== undefined) exits.push({ to, option: { id: option.id, title: option.title } });
    }
  } else if (column.scripted !== undefined) {
    for (const [exit, destination] of Object.entries(column.scripted.exits)) {
      const to = reference(destination);
      if (to !== undefined) exits.push({ to, exit });
    }
  } else if (routing === 'unrestricted') {
    for (const other of workflow.columns) if (other.id !== column.id) exits.push({ to: stageReference(other) });
  } else {
    for (const target of transitionTargets(workflow, column.id)) {
      exits.push({ to: stageReference(target.column), ...(target.rule.when === undefined ? {} : { condition: target.rule.when }) });
    }
  }
  return { stage: stageReference(column), routing, exits };
}
