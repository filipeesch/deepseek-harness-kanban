import type { Workflow } from '../shared/types.js';
import { parseWorkflow } from './workflow.js';
import { workflowProblems, type WorkflowProblem } from './workflow-diagnostics.js';
import { diffWorkflow, type WorkflowDifference } from './workflow-difference.js';
import { workflowWarnings, type WorkflowWarning } from './workflow-warnings.js';
import { transitionAccess } from './transitions.js';

/** How many warnings and cards one report itemizes before it counts the rest. */
export const REPORT_ITEM_LIMIT = 100;

/** Why a reviewed script authorization no longer holds. */
export type ScriptImpactReason = 'source' | 'exits' | 'environment' | 'directory' | 'execution-directory' | 'unapproved' | 'unresolvable';

/**
 * The state of one deterministic stage's reviewed authorization in one project.
 * `unverifiable` is a real answer: the project directory or the source file
 * could not be read, so the report never claims the approval still holds.
 */
export interface ScriptImpact {
  readonly stage: string;
  readonly projectId: string;
  readonly verdict: 'holds' | 'changed' | 'unverifiable';
  readonly reasons: readonly ScriptImpactReason[];
  readonly detail?: string;
}

/** The task references a report needs; never a title, description, or message. */
export interface WorkflowCardReference {
  readonly id: string;
  readonly columnId: string;
  readonly recordedTransition?: { readonly columnId: string };
  readonly pendingTransition?: { readonly fromColumnId: string; readonly columnId: string };
}

/** One task a composed workflow affects, named by its identity only. */
export interface AffectedCard {
  readonly taskId: string;
  readonly stage: string;
  readonly reason: 'stage-removed' | 'route-removed';
}

/** What one composed document means, before it is saved. */
export interface WorkflowReview {
  readonly valid: boolean;
  readonly problems: readonly WorkflowProblem[];
  readonly difference: WorkflowDifference | null;
  readonly warnings: readonly WorkflowWarning[];
  readonly affectedCards: readonly AffectedCard[];
  readonly workflow: Workflow | null;
  readonly previous: Workflow | null;
}

/** The complete report a workflow write returns on refusal and on success. */
export interface WorkflowWriteReport {
  readonly valid: boolean;
  readonly problems: readonly WorkflowProblem[];
  readonly difference: WorkflowDifference | null;
  /** How many stage differences the itemized difference leaves out. */
  readonly differenceOmitted: number;
  readonly warnings: readonly WorkflowWarning[];
  readonly warningsOmitted: number;
  readonly scripts: readonly ScriptImpact[];
  readonly scriptsOmitted: number;
  readonly affectedCards: readonly AffectedCard[];
  readonly affectedCardsOmitted: number;
}

export interface WorkflowReviewInput {
  readonly text: string;
  /** The document the board holds now; null when the board has no workflow yet. */
  readonly previousText: string | null;
  readonly cards?: readonly WorkflowCardReference[];
}

function parseOrNull(text: string | null): Workflow | null {
  if (text === null || text.trim().length === 0) return null;
  try { return parseWorkflow(text); } catch { return null; }
}

/**
 * The tasks a composed document leaves behind: those in a stage the document
 * removes, and those whose recorded or pending route it no longer permits.
 * Identities only — a report never carries card text.
 */
export function affectedCards(before: Workflow | null, after: Workflow, cards: readonly WorkflowCardReference[]): AffectedCard[] {
  if (before === null) return [];
  const defined = new Set(after.columns.map(column => column.id));
  const removed = new Set(before.columns.filter(column => !defined.has(column.id)).map(column => column.id));
  if (removed.size === 0 && cards.length === 0) return [];
  const result: AffectedCard[] = [];
  for (const card of cards) {
    const stage = removed.has(card.columnId) ? card.columnId : undefined;
    if (stage !== undefined) { result.push({ taskId: card.id, stage, reason: 'stage-removed' }); continue; }
    const pending = card.pendingTransition;
    if (pending !== undefined && removed.has(pending.columnId)) { result.push({ taskId: card.id, stage: pending.columnId, reason: 'stage-removed' }); continue; }
    // A destination the composed document no longer defines is a removed route
    // too: the card's declared move would be stale the moment it saved.
    const removedRoute = (destination: string): boolean => {
      const access = transitionAccess(after, card.columnId, destination);
      return access === 'restricted' || access === null;
    };
    const recorded = card.recordedTransition;
    if (recorded !== undefined && removedRoute(recorded.columnId)) {
      result.push({ taskId: card.id, stage: card.columnId, reason: 'route-removed' });
      continue;
    }
    if (pending !== undefined && !removed.has(pending.columnId) && removedRoute(pending.columnId)) {
      result.push({ taskId: card.id, stage: card.columnId, reason: 'route-removed' });
    }
  }
  return result;
}

/**
 * Review a composed workflow document without saving anything.
 *
 * A document that does not parse is reported with its positions and nothing
 * else: a difference and a graph warning list would describe a document the
 * board cannot hold. A document that parses always yields the difference, the
 * warnings, and the affected cards, so a refusal and a success report the same
 * facts about the same text.
 */
export function reviewWorkflowText(input: WorkflowReviewInput): WorkflowReview {
  const problems = workflowProblems(input.text);
  if (problems.length > 0) {
    return { valid: false, problems, difference: null, warnings: [], affectedCards: [], workflow: null, previous: null };
  }
  const previous = parseOrNull(input.previousText);
  const workflow = parseWorkflow(input.text);
  return {
    valid: true,
    problems: [],
    difference: diffWorkflow(previous, workflow),
    warnings: workflowWarnings(workflow),
    affectedCards: affectedCards(previous, workflow, input.cards ?? []),
    workflow,
    previous,
  };
}

/** Add the script impact the host resolved to an existing report, bounded. */
export function withScripts(report: WorkflowWriteReport, scripts: readonly ScriptImpact[]): WorkflowWriteReport {
  return { ...report, scripts: scripts.slice(0, REPORT_ITEM_LIMIT), scriptsOmitted: Math.max(0, scripts.length - REPORT_ITEM_LIMIT) };
}

/** The report one review produces, with the script impact the host resolved. */
export function composeWorkflowReport(review: WorkflowReview, scripts: readonly ScriptImpact[] = []): WorkflowWriteReport {
  const difference = review.difference === null ? null : { ...review.difference, stages: review.difference.stages.slice(0, REPORT_ITEM_LIMIT) };
  return {
    ...withScripts({
      valid: review.valid,
      problems: review.problems,
      difference,
      differenceOmitted: review.difference === null ? 0 : Math.max(0, review.difference.stages.length - REPORT_ITEM_LIMIT),
      warnings: review.warnings.slice(0, REPORT_ITEM_LIMIT),
      warningsOmitted: Math.max(0, review.warnings.length - REPORT_ITEM_LIMIT),
      scripts: [],
      scriptsOmitted: 0,
      affectedCards: review.affectedCards.slice(0, REPORT_ITEM_LIMIT),
      affectedCardsOmitted: Math.max(0, review.affectedCards.length - REPORT_ITEM_LIMIT),
    }, scripts),
  };
}