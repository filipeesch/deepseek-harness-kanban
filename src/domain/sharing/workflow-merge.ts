import type { StagePosition, Workflow } from '../../shared/types.js';
import { parseWorkflow } from '../workflow.js';
import { workflowMeaning } from '../schema-parts.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../workflow-positions.js';

/** One board version as publishing sees it: its name and its authored workflow text. */
export interface WorkflowVersion { readonly name: string; readonly workflow: string }

/** The workflow text and board name a placement merge resolves to. */
export interface WorkflowMergeResult { readonly name: string; readonly workflow: string }

function samePosition(left: StagePosition | undefined, right: StagePosition | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y;
}

/**
 * Merge stage placements across the last received version, the local board, and
 * the published board.
 *
 * The workflow's meaning (everything except placement) decides the winner: a
 * meaning changed on exactly one side wins, a meaning changed identically on
 * both wins locally, and a meaning changed differently on both is not
 * mergeable. The board name follows the same rule. The resulting workflow text
 * starts from the winning side's authored text and rewrites only the placement
 * of the stages the other side moved; a stage both sides moved keeps the local
 * placement.
 *
 * Returns null when the versions cannot be merged, so the caller keeps the
 * existing per-board review path.
 */
export function mergeWorkflowPlacements(input: { base: WorkflowVersion; local: WorkflowVersion; published: WorkflowVersion }): WorkflowMergeResult | null {
  let base: Workflow;
  let local: Workflow;
  let published: Workflow;
  try {
    base = parseWorkflow(input.base.workflow);
    local = parseWorkflow(input.local.workflow);
    published = parseWorkflow(input.published.workflow);
  } catch {
    return null;
  }
  const baseMeaning = workflowMeaning(base);
  const localMeaning = workflowMeaning(local);
  const publishedMeaning = workflowMeaning(published);
  const localChanged = localMeaning !== baseMeaning;
  const publishedChanged = publishedMeaning !== baseMeaning;
  if (localChanged && publishedChanged && localMeaning !== publishedMeaning) return null;
  const localRenamed = input.local.name !== input.base.name;
  const publishedRenamed = input.published.name !== input.base.name;
  if (localRenamed && publishedRenamed && input.local.name !== input.published.name) return null;
  const winner: 'local' | 'published' = publishedChanged && !localChanged ? 'published' : 'local';
  const winnerWorkflow = winner === 'published' ? published : local;
  const basePositions = readStagePositions(base);
  const localPositions = readStagePositions(local);
  const publishedPositions = readStagePositions(published);
  const merged: Record<string, StagePosition | undefined> = { ...(winner === 'published' ? publishedPositions : localPositions) };
  for (const column of winnerWorkflow.columns) {
    const id = column.id;
    const basePosition = basePositions[id];
    const localPosition = localPositions[id];
    const publishedPosition = publishedPositions[id];
    const localMoved = !samePosition(localPosition, basePosition);
    const publishedMoved = !samePosition(publishedPosition, basePosition);
    if (winner === 'published' && localMoved) merged[id] = localPosition;
    else if (winner === 'local' && publishedMoved && !localMoved) merged[id] = publishedPosition;
  }
  const winnerText = winner === 'published' ? input.published.workflow : input.local.workflow;
  const name = localRenamed ? input.local.name : input.published.name;
  return { name, workflow: setStagePositions(winnerText, merged as StagePositions) };
}
