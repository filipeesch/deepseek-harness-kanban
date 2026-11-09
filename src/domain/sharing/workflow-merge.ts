import type { ConnectionLayout, StagePosition, StageSize, Workflow } from '../../shared/types.js';
import { parseWorkflow } from '../workflow.js';
import { workflowMeaning } from '../schema-parts.js';
import { sameStageSize } from '../stage-size.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from '../workflow-sizes.js';
import { readConnections, setConnections, type ConnectionLayouts } from '../workflow-connections.js';
import { sameConnectionLayout } from '../connection-anchor.js';

/** One board version as publishing sees it: its name and its authored workflow text. */
export interface WorkflowVersion { readonly name: string; readonly workflow: string }

/** The workflow text and board name a placement merge resolves to. */
export interface WorkflowMergeResult { readonly name: string; readonly workflow: string }

function samePosition(left: StagePosition | undefined, right: StagePosition | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y;
}

/**
 * Merge one layout field across the three versions. The winner's values are the
 * starting point; a value only the other side changed still applies, so a local
 * move and a published resize both survive. Every key either side defines is
 * considered, so a value the winner no longer defines is not invented.
 */
function mergeLayoutField<T>(input: {
  readonly winner: 'local' | 'published';
  readonly keys: readonly string[];
  readonly base: Readonly<Record<string, T>>;
  readonly local: Readonly<Record<string, T>>;
  readonly published: Readonly<Record<string, T>>;
  readonly same: (left: T | undefined, right: T | undefined) => boolean;
}): Record<string, T | undefined> {
  const merged: Record<string, T | undefined> = { ...(input.winner === 'published' ? input.published : input.local) };
  for (const id of input.keys) {
    const base = input.base[id];
    const local = input.local[id];
    const published = input.published[id];
    const localChanged = !input.same(local, base);
    const publishedChanged = !input.same(published, base);
    if (input.winner === 'published' && localChanged) merged[id] = local;
    else if (input.winner === 'local' && publishedChanged && !localChanged) merged[id] = published;
  }
  return merged;
}

function columnIds(workflow: Workflow): string[] {
  return workflow.columns.map(column => column.id);
}

function connectionIds(...workflows: readonly Workflow[]): string[] {
  const keys = new Set<string>();
  for (const workflow of workflows) for (const key of Object.keys(readConnections(workflow))) keys.add(key);
  return [...keys];
}

/**
 * Merge stage layouts across the last received version, the local board, and the
 * published board.
 *
 * The workflow's meaning (everything except layout) decides the winner: a
 * meaning changed on exactly one side wins, a meaning changed identically on
 * both wins locally, and a meaning changed differently on both is not
 * mergeable. The board name follows the same rule. The resulting workflow text
 * starts from the winning side's authored text and rewrites only the layout of
 * the stages the other side changed; a stage both sides changed keeps the local
 * value.
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
  const positions = mergeLayoutField<StagePosition>({
    winner, keys: columnIds(winnerWorkflow),
    base: readStagePositions(base), local: readStagePositions(local), published: readStagePositions(published),
    same: samePosition,
  });
  const sizes = mergeLayoutField<StageSize>({
    winner, keys: columnIds(winnerWorkflow),
    base: readStageSizes(base), local: readStageSizes(local), published: readStageSizes(published),
    same: sameStageSize,
  });
  const connections = mergeLayoutField<ConnectionLayout>({
    winner, keys: connectionIds(base, local, published),
    base: readConnections(base), local: readConnections(local), published: readConnections(published),
    same: sameConnectionLayout,
  });
  const winnerText = winner === 'published' ? input.published.workflow : input.local.workflow;
  const name = localRenamed ? input.local.name : input.published.name;
  return { name, workflow: setConnections(setStageSizes(setStagePositions(winnerText, positions as StagePositions), sizes as StageSizes), connections as ConnectionLayouts) };
}
