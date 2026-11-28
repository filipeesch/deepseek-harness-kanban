import type { Column, Workflow } from '../shared/types.js';
import { MAIN_AGENT_ID } from '../shared/types.js';
import { diffWorkflow } from './workflow-difference.js';
import type { WorkflowCardReference } from './workflow-report.js';
import { pendingPermitted, routeImpact } from './workflow-route-impact.js';
import type { TransitionStaleReason } from './transition-route.js';

/** How many card impacts and changed names one report itemizes before it counts the rest. */
export const IMPACT_ITEM_LIMIT = 100;

/**
 * Why one card is affected by a composed candidate.
 *
 * `route-stale` is an ordinary declaration the candidate makes stop resolving, under
 * the engine's own resolution rule. `admitted-advance` is an advance the engine already
 * admitted: its destination was captured, so the candidate governs later routing
 * instead of retargeting it, and the placement permission still holds. `placement-blocked`
 * is an admitted advance whose placement the candidate would make the engine refuse,
 * because the route permission is checked again when the card is placed.
 */
export type CardImpactKind = 'stage-removed' | 'stage-changed' | 'agent-changed' | 'route-stale' | 'admitted-advance' | 'placement-blocked';

/** One card a candidate affects, named by identity and reason only. */
export interface CardImpact {
  readonly taskId: string;
  readonly stage: string;
  readonly kind: CardImpactKind;
  /** The destination a route impact names. */
  readonly destination?: string;
  /** For a route impact, the advance the card holds: declared intent or an admitted turn advance. */
  readonly advance?: 'declared' | 'pending';
  /** The engine's reason when a declaration stops resolving. */
  readonly reason?: TransitionStaleReason;
}

/** What a composed candidate would change for the cards of its board. */
export interface WorkflowImpactReport {
  /** Whether a previous document was compared; a board without one reports no impacts. */
  readonly compared: boolean;
  /** The stages whose definition the candidate changes, added ones included. */
  readonly changedStages: readonly string[];
  readonly changedStagesOmitted: number;
  /** The agent identities whose definition the candidate adds, changes, or removes. */
  readonly changedAgents: readonly string[];
  readonly changedAgentsOmitted: number;
  readonly cards: readonly CardImpact[];
  readonly cardsOmitted: number;
  /** How many impacts of each kind the candidate has, whether or not the list carries them all. */
  readonly counts: Readonly<Record<CardImpactKind, number>>;
}

const KINDS: readonly CardImpactKind[] = ['stage-removed', 'stage-changed', 'agent-changed', 'route-stale', 'admitted-advance', 'placement-blocked'];

function emptyCounts(): Record<CardImpactKind, number> {
  return { 'stage-removed': 0, 'stage-changed': 0, 'agent-changed': 0, 'route-stale': 0, 'admitted-advance': 0, 'placement-blocked': 0 };
}

function signature(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** The agent a stage runs with: its own binding, or the main conversation. */
function resolvedAgent(workflow: Workflow, column: Column | undefined): string | undefined {
  if (column === undefined) return undefined;
  if (column.agent === undefined || column.agent === MAIN_AGENT_ID) return MAIN_AGENT_ID;
  return column.agent;
}

/** Every agent identity whose definition differs between two documents. */
function changedAgentIds(before: Workflow, after: Workflow): string[] {
  const previous = new Map((before.agents ?? []).map(agent => [agent.id, signature(agent)]));
  const next = new Map((after.agents ?? []).map(agent => [agent.id, signature(agent)]));
  return [...new Set([...previous.keys(), ...next.keys()])].filter(id => previous.get(id) !== next.get(id)).sort();
}

/**
 * Report the cards a composed candidate affects, against one review snapshot.
 *
 * Identities and reasons only: a card's title, description, conversation, and
 * parameter values never appear. Route effects come from the engine's own analysis,
 * the same basis the writer's affected-card report uses. The list is bounded and the
 * counts are not, so a caller learns the true size of an impact it cannot see in full.
 */
export function workflowImpact(before: Workflow | null, after: Workflow, cards: readonly WorkflowCardReference[]): WorkflowImpactReport {
  if (before === null) {
    return {
      compared: false, changedStages: [], changedStagesOmitted: 0, changedAgents: [], changedAgentsOmitted: 0,
      cards: [], cardsOmitted: 0, counts: emptyCounts(),
    };
  }
  const difference = diffWorkflow(before, after);
  const changedStages = difference.stages.filter(stage => stage.change !== 'removed').map(stage => stage.stage);
  const removedStages = new Set(difference.stages.filter(stage => stage.change === 'removed').map(stage => stage.stage));
  const changedStageIds = new Set(changedStages);
  const changedAgents = changedAgentIds(before, after);
  const changedAgentIdsSet = new Set(changedAgents);
  const beforeColumns = new Map(before.columns.map(column => [column.id, column]));
  const afterColumns = new Map(after.columns.map(column => [column.id, column]));

  const impacts: CardImpact[] = [];
  const counts = emptyCounts();
  const seen = new Set<string>();
  const push = (impact: CardImpact): void => {
    const key = impact.taskId + '\u0000' + impact.kind + '\u0000' + (impact.destination ?? '');
    if (seen.has(key)) return;
    seen.add(key);
    counts[impact.kind] += 1;
    impacts.push(impact);
  };

  for (const card of cards) {
    const beforeColumn = beforeColumns.get(card.columnId);
    const afterColumn = afterColumns.get(card.columnId);
    if (removedStages.has(card.columnId)) {
      push({ taskId: card.id, stage: card.columnId, kind: 'stage-removed' });
      // A card in a removed stage has no destination-stage definition to compare.
    } else if (changedStageIds.has(card.columnId)) {
      push({ taskId: card.id, stage: card.columnId, kind: 'stage-changed' });
    }
    if (afterColumn !== undefined) {
      const bindingChanged = beforeColumn === undefined || beforeColumn.agent !== afterColumn.agent;
      const agent = resolvedAgent(after, afterColumn);
      const definitionChanged = agent !== undefined && changedAgentIdsSet.has(agent);
      if (bindingChanged || definitionChanged) push({ taskId: card.id, stage: card.columnId, kind: 'agent-changed' });
    }

    // The route facts, from the engine's own analysis: a newly stale declaration or a
    // newly blocked placement is actionable; otherwise an admitted advance whose
    // destination the candidate changes is still deliverable and is reported as such.
    const route = routeImpact(before, after, card);
    if (route !== undefined) {
      push({
        taskId: card.id, stage: card.columnId, kind: route.kind, destination: route.destination, advance: route.advance,
        ...(route.reason === undefined ? {} : { reason: route.reason }),
      });
    } else {
      const pending = card.pendingTransition;
      if (pending !== undefined) {
        const destinationAffected = changedStageIds.has(pending.columnId) || removedStages.has(pending.columnId)
          || pendingPermitted(before, card) !== pendingPermitted(after, card);
        if (destinationAffected && pendingPermitted(after, card)) {
          push({ taskId: card.id, stage: card.columnId, kind: 'admitted-advance', destination: pending.columnId, advance: 'pending' });
        }
      }
    }
  }
  impacts.sort((left, right) => {
    const kind = KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind);
    if (kind !== 0) return kind;
    return left.taskId.localeCompare(right.taskId) || left.stage.localeCompare(right.stage);
  });
  return {
    compared: true,
    changedStages: changedStages.slice(0, IMPACT_ITEM_LIMIT),
    changedStagesOmitted: Math.max(0, changedStages.length - IMPACT_ITEM_LIMIT),
    changedAgents: changedAgents.slice(0, IMPACT_ITEM_LIMIT),
    changedAgentsOmitted: Math.max(0, changedAgents.length - IMPACT_ITEM_LIMIT),
    cards: impacts.slice(0, IMPACT_ITEM_LIMIT),
    cardsOmitted: Math.max(0, impacts.length - IMPACT_ITEM_LIMIT),
    counts,
  };
}
