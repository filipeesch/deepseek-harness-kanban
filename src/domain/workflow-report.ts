import type { Workflow } from '../shared/types.js';
import { parseWorkflow } from './workflow.js';
import { workflowProblems, type WorkflowProblem } from './workflow-diagnostics.js';
import { diffWorkflow, type WorkflowDifference } from './workflow-difference.js';
import { workflowWarnings, type AgentAvailability, type WorkflowWarning } from './workflow-warnings.js';
import { routeImpact } from './workflow-route-impact.js';
import { stageSize, type StageSizeFact } from './workflow-size.js';

/** How many warnings and cards one report itemizes before it counts the rest. */
export const REPORT_ITEM_LIMIT = 100;

/** Why a reviewed script authorization no longer holds. */
export type ScriptImpactReason = 'source' | 'exits' | 'environment' | 'directory' | 'parameters' | 'unapproved' | 'directory-dependent' | 'unresolvable';

/**
 * The state of one scripted stage's reviewed authorization for the board.
 * `unverifiable` is a real answer: the stage or the source could not be
 * resolved, so the report never claims the approval still holds.
 */
export interface ScriptImpact {
  readonly stage: string;
  readonly verdict: 'holds' | 'changed' | 'unverifiable';
  readonly reasons: readonly ScriptImpactReason[];
  /** The executable version the report resolved, when one was resolvable. */
  readonly version?: string;
  readonly detail?: string;
}

/** The task references a report needs; never a title, description, or message. */
export interface WorkflowCardReference {
  readonly id: string;
  readonly columnId: string;
  readonly recordedTransition?: {
    readonly fromColumnId: string;
    readonly columnId: string;
    /** The recording is an exceptional declaration, which is never a durable route. */
    readonly exception?: true;
    readonly parameters?: Readonly<Record<string, string>>;
  };
  readonly pendingTransition?: {
    readonly fromColumnId: string;
    readonly columnId: string;
    /** The stored override that bypasses the route permission at placement. */
    readonly transitionOverride?: true;
    readonly parameters?: Readonly<Record<string, string>>;
  };
  /** The card holds a scripted entry, which owns its routing instead of a declaration. */
  readonly scriptedEntry?: true;
  /** The parameter names this card holds a value for; never a value. */
  readonly parameters?: readonly string[];
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
  /** The complete report; the summary carries `summary` and never the field values. */
  readonly mode: 'full';
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
  /** What the running host reports, for the authoring availability warnings. */
  readonly availability?: AgentAvailability;
}

function parseOrNull(text: string | null): Workflow | null {
  if (text === null || text.trim().length === 0) return null;
  try { return parseWorkflow(text); } catch { return null; }
}

/**
 * The tasks a composed document leaves behind: those in a stage the document
 * removes, and those whose route the candidate itself makes stale or blocked.
 * Identities only — a report never carries card text.
 *
 * The route basis is the engine's own before/after analysis ({@link routeImpact}),
 * so this field and a batch preview's impact report cannot answer differently about
 * the same card. Intent that was already stale, an exceptional recording, a scripted
 * entry, an override, and a card already placed at its destination are not reported.
 */
export function affectedCards(before: Workflow | null, after: Workflow, cards: readonly WorkflowCardReference[]): AffectedCard[] {
  if (before === null) return [];
  const defined = new Set(after.columns.map(column => column.id));
  const removed = new Set(before.columns.filter(column => !defined.has(column.id)).map(column => column.id));
  if (removed.size === 0 && cards.length === 0) return [];
  const result: AffectedCard[] = [];
  for (const card of cards) {
    if (removed.has(card.columnId)) { result.push({ taskId: card.id, stage: card.columnId, reason: 'stage-removed' }); continue; }
    if (routeImpact(before, after, card) !== undefined) result.push({ taskId: card.id, stage: card.columnId, reason: 'route-removed' });
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
    warnings: workflowWarnings(workflow, input.cards ?? [], input.availability),
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
      mode: 'full' as const,
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
/** One changed field in the summary: its name only, never its text. */
export interface WorkflowFieldSummary {
  readonly field: string;
}

/** One stage in the summary: what happened and which fields changed. */
export interface WorkflowStageSummary {
  readonly stage: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields?: readonly string[];
}

/** One group or connection in the summary. */
export interface WorkflowGroupSummary {
  readonly group: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields?: readonly string[];
}

/** The bounded report a write returns by default: what changed, never the field text. */
export interface WorkflowReportSummary {
  readonly mode: 'summary';
  readonly valid: boolean;
  readonly problems: readonly WorkflowProblem[];
  /** The root fields that changed, by name. */
  readonly workflow: readonly string[];
  readonly stages: readonly WorkflowStageSummary[];
  readonly differenceOmitted: number;
  readonly groups: readonly WorkflowGroupSummary[];
  readonly connections: WorkflowDifference['connections'];
  readonly warnings: readonly WorkflowWarning[];
  readonly warningsOmitted: number;
  readonly scripts: readonly ScriptImpact[];
  readonly scriptsOmitted: number;
  readonly affectedCards: readonly AffectedCard[];
  readonly affectedCardsOmitted: number;
  /** The authored size of every stage the difference names, so a long instruction is visible before it is saved. */
  readonly sizes: readonly StageSizeFact[];
}

function fieldNames(fields: ReadonlyArray<{ readonly field: string }> | undefined): readonly string[] | undefined {
  return fields === undefined ? undefined : fields.map(field => field.field);
}

/**
 * The summary of a write report: the same facts, with every field value reduced to
 * its name. A caller that needs the text asks for the full report or reads the
 * document back, which is what keeps a large document out of the model's context.
 */
export function summarizeWorkflowReport(report: WorkflowWriteReport, workflow: Workflow | null): WorkflowReportSummary {
  const difference = report.difference;
  const changed = new Set<string>();
  for (const stage of difference?.stages ?? []) if (stage.change !== 'removed') changed.add(stage.stage);
  const sizes = workflow === null ? [] : workflow.columns.flatMap(column => {
    if (!changed.has(column.id)) return [];
    const fact = stageSize(column);
    return fact === undefined ? [] : [fact];
  });
  return {
    mode: 'summary',
    valid: report.valid,
    problems: report.problems,
    workflow: (difference?.workflow ?? []).map(field => field.field),
    stages: (difference?.stages ?? []).map(stage => ({
      stage: stage.stage,
      change: stage.change,
      ...(stage.fields === undefined ? {} : { fields: fieldNames(stage.fields) }),
    })),
    differenceOmitted: report.differenceOmitted,
    groups: (difference?.groups ?? []).map(group => ({
      group: group.group,
      change: group.change,
      ...(group.fields === undefined ? {} : { fields: fieldNames(group.fields) }),
    })),
    connections: difference?.connections ?? [],
    warnings: report.warnings,
    warningsOmitted: report.warningsOmitted,
    scripts: report.scripts,
    scriptsOmitted: report.scriptsOmitted,
    affectedCards: report.affectedCards,
    affectedCardsOmitted: report.affectedCardsOmitted,
    sizes,
  };
}
