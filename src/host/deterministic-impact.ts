import type { Board, Column, HubState, Project, Workflow } from '../shared/types.js';
import type { DeterministicTarget } from '../shared/deterministic.js';
import type { DeterministicRuntime } from './deterministic/ports.js';
import type { ScriptImpact, ScriptImpactReason } from '../domain/workflow-report.js';
import { canonicalDeterministic } from '../domain/deterministic-definition.js';
import { reconcileLocalStageIdentities } from '../domain/deterministic-state.js';
import { creatableProjects } from '../domain/board-project-scope.js';
import { requireProjectPath } from '../shared/project.js';

/** What one composed document may do to the reviewed authorizations of its scripts. */
export interface DeterministicImpactInput {
  readonly hub: HubState;
  readonly board: Board;
  readonly before: Workflow | null;
  readonly after: Workflow;
}

/**
 * The port a board write asks about its executable stages. A host without the
 * native deterministic runtime resolves nothing, which is why the port is
 * optional on the board writer.
 */
export interface DeterministicImpactPort {
  describe(input: DeterministicImpactInput): Promise<ScriptImpact[]>;
}

/**
 * The identity every stage will carry once the composed document is saved.
 *
 * The save reconciles local identities against the new document, so a report
 * that read the previous map directly would judge an authored key change with
 * the identity the board is about to drop. The same reconciliation is applied
 * to a copy of the board, and an identity the reconciliation leaves unset falls
 * back to the authored key the first execution would use.
 */
function reconciledIdentities(board: Board, after: Workflow): Map<string, string | undefined> {
  const probe: Pick<Board, 'workflow' | 'localStageIdentities'> = {
    workflow: board.workflow,
    ...(board.localStageIdentities === undefined ? {} : { localStageIdentities: { ...board.localStageIdentities } }),
  };
  reconcileLocalStageIdentities(probe, after);
  const identities = new Map<string, string | undefined>();
  for (const column of after.columns) identities.set(column.id, probe.localStageIdentities?.[column.id] ?? column.key);
  return identities;
}

function targetsOf(identities: ReadonlyMap<string, string | undefined>, column: Column): Record<string, DeterministicTarget> | null {
  const definition = column.deterministic;
  if (definition === undefined) return null;
  const targets: Record<string, DeterministicTarget> = Object.create(null) as Record<string, DeterministicTarget>;
  for (const [exit, columnId] of Object.entries(definition.exits)) {
    const identity = identities.get(columnId);
    if (identity === undefined) return null;
    targets[exit] = { columnId, stageIdentity: identity };
  }
  return targets;
}

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());
}

/** Why one stage's resolved inputs change between two workflows. */
function changedReasons(before: Column | undefined, after: Column, beforeTargets: Record<string, DeterministicTarget> | null, afterTargets: Record<string, DeterministicTarget> | null): ScriptImpactReason[] {
  const previous = before?.deterministic;
  const next = after.deterministic;
  if (previous === undefined || next === undefined) return ['source'];
  const reasons: ScriptImpactReason[] = [];
  if (previous.language !== next.language || previous.code !== next.code || previous.file !== next.file) reasons.push('source');
  if (JSON.stringify(previous.exits) !== JSON.stringify(next.exits) || JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets)) reasons.push('exits');
  if (!sameList(previous.env, next.env)) reasons.push('environment');
  if ((previous.directory ?? 'task') !== (next.directory ?? 'task')) reasons.push('directory');
  return reasons;
}

function unchanged(before: Column | undefined, after: Column): boolean {
  return JSON.stringify(canonicalDeterministic(before?.deterministic)) === JSON.stringify(canonicalDeterministic(after.deterministic));
}

/**
 * Resolve, per deterministic stage and per project the board allows, whether the
 * reviewed authorization still holds for the document being written.
 *
 * The fingerprint comes from the same planning the capturing path runs, so the
 * verdict names what an approval would have to cover. A stage scoped to the task
 * directory depends on the card's worktree, and an unreadable directory or source
 * is reported as unverifiable instead of being guessed.
 */
export function createDeterministicImpact(runtime: () => DeterministicRuntime | undefined): DeterministicImpactPort {
  return {
    async describe(input) {
      const native = runtime();
      if (native === undefined) return [];
      const projects = creatableProjects(input.board, input.hub.projects);
      const identities = reconciledIdentities(input.board, input.after);
      const result: ScriptImpact[] = [];
      for (const column of input.after.columns) {
        if (column.deterministic === undefined) continue;
        const identity = identities.get(column.id);
        const previous = input.before?.columns.find(value => value.id === column.id);
        for (const project of projects) {
          result.push(await describeOne(native, input, column, previous, project, identity, identities));
        }
      }
      return result;
    },
  };
}

async function describeOne(native: DeterministicRuntime, input: DeterministicImpactInput, column: Column, previous: Column | undefined, project: Project, identity: string | undefined, identities: ReadonlyMap<string, string | undefined>): Promise<ScriptImpact> {
  const stage = column.id;
  const projectId = project.id;
  const definition = column.deterministic!;
  if (identity === undefined) {
    return { stage, projectId, verdict: 'unverifiable', reasons: ['unresolvable'], detail: 'This stage has no stable identity yet; review it when it first runs.' };
  }
  if (definition.directory === 'task') {
    return { stage, projectId, verdict: 'unverifiable', reasons: ['execution-directory'], detail: "The execution directory depends on the card's worktree; approve it for each card." };
  }
  const targets = targetsOf(identities, column);
  if (targets === null) {
    return { stage, projectId, verdict: 'unverifiable', reasons: ['exits'], detail: 'A named exit does not resolve to a stage with a stable identity.' };
  }
  let projectDirectory: string;
  try {
    projectDirectory = requireProjectPath(project);
    if (typeof projectDirectory !== 'string' || projectDirectory.length === 0) throw new Error('The project has no registered directory.');
  } catch (error) { return { stage, projectId, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) }; }
  let fingerprint: string;
  try {
    fingerprint = (await native.plan({ definition, projectDirectory, exits: targets })).fingerprint;
  } catch (error) {
    return { stage, projectId, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) };
  }
  let approved: boolean;
  try { approved = await native.trust.isApproved({ hubId: input.hub.id, boardId: input.board.id, projectId, stageIdentity: identity }, fingerprint); }
  catch (error) { return { stage, projectId, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) }; }
  if (approved) return { stage, projectId, verdict: 'holds', reasons: [] };
  if (unchanged(previous, column)) return { stage, projectId, verdict: 'changed', reasons: ['unapproved'], detail: 'This version was never approved in this project.' };
  const beforeTargets = previous === undefined ? null : targetsOf(identities, previous);
  const reasons = changedReasons(previous, column, beforeTargets, targets);
  return { stage, projectId, verdict: 'changed', reasons: reasons.length > 0 ? reasons : ['execution-directory'] };
}