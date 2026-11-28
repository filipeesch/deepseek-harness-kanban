import type { Board, HubState } from '../shared/types.js';
import type { ScriptedRuntime } from './scripted/ports.js';
import type { ScriptImpact, ScriptImpactReason } from '../domain/workflow-report.js';
import { canonicalScripted } from '../domain/scripted-definition.js';
import { declaredParameterNames } from '../domain/scripted-parameters.js';
import type { Workflow } from '../shared/types.js';
import { boardStageIdentities, directoryDependent, projectDirectory, representativeProject, stageTargets } from './scripted-version.js';

/** What one composed document may do to the reviewed authorizations of its scripts. */
export interface ScriptedImpactInput {
  readonly hub: HubState;
  readonly board: Board;
  readonly before: Workflow | null;
  readonly after: Workflow;
}

/**
 * The port a board write asks about its executable stages. A host without the
 * native scripted runtime resolves nothing, which is why the port is
 * optional on the board writer.
 */
export interface ScriptedImpactPort {
  describe(input: ScriptedImpactInput): Promise<ScriptImpact[]>;
  /**
   * Whether this host can resolve authorization at all. A port that is installed but
   * has no runtime answers `false`, so a caller never reads an empty or unverifiable
   * report as a checked one. Absent leaves the answer unknown.
   */
  available?(): boolean;
}

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());
}

/** Why one stage's resolved inputs change between two workflows. */
function changedReasons(before: Board['workflow']['columns'][number] | undefined, after: Board['workflow']['columns'][number]): ScriptImpactReason[] {
  const previous = before?.scripted;
  const next = after.scripted;
  if (previous === undefined || next === undefined) return ['source'];
  const reasons: ScriptImpactReason[] = [];
  if (previous.language !== next.language || previous.code !== next.code || previous.file !== next.file) reasons.push('source');
  if (JSON.stringify(previous.exits) !== JSON.stringify(next.exits)) reasons.push('exits');
  if (!sameList(previous.env, next.env)) reasons.push('environment');
  if ((previous.directory ?? 'task') !== (next.directory ?? 'task')) reasons.push('directory');
  if (!sameList(declaredParameterNames(previous.params), declaredParameterNames(next.params))) reasons.push('parameters');
  return reasons;
}

function unchanged(before: Board['workflow']['columns'][number] | undefined, after: Board['workflow']['columns'][number]): boolean {
  return JSON.stringify(canonicalScripted(before?.scripted)) === JSON.stringify(canonicalScripted(after.scripted));
}

/**
 * Resolve, per scripted stage, whether the board's reviewed authorization
 * still holds for the document being written. Approval is board-and-stage scoped,
 * so the report answers once per stage instead of once per project.
 */
export function createScriptedImpact(runtime: () => ScriptedRuntime | undefined): ScriptedImpactPort {
  return {
    available: () => runtime() !== undefined,
    async describe(input) {
      const native = runtime();
      // No runtime is a fact about this host, not a statement that every approval
      // holds: each scripted stage is reported as unverifiable instead of omitted.
      if (native === undefined) {
        return input.after.columns.flatMap(column => column.scripted === undefined ? [] : [{
          stage: column.id,
          verdict: 'unverifiable' as const,
          reasons: ['unresolvable' as const],
          detail: 'The scripted runtime is not available on this host, so this stage authorization cannot be inspected.',
        }]);
      }
      const identities = boardStageIdentities(input.board, input.after);
      const result: ScriptImpact[] = [];
      for (const column of input.after.columns) {
        if (column.scripted === undefined) continue;
        const stage = column.id;
        const identity = identities.get(column.id) ?? column.key;
        if (identity === undefined) {
          result.push({ stage, verdict: 'unverifiable', reasons: ['unresolvable'], detail: 'This stage has no stable identity yet; review it when it first runs.' });
          continue;
        }
        if (directoryDependent(column.scripted)) {
          result.push({ stage, verdict: 'unverifiable', reasons: ['directory-dependent'], detail: 'The primary source is read from each execution directory, so each resolved version needs its own approval.' });
          continue;
        }
        const targets = stageTargets(identities, column);
        if (targets === null) {
          result.push({ stage, verdict: 'unverifiable', reasons: ['exits'], detail: 'A named exit does not resolve to a stage with a stable identity.' });
          continue;
        }
        let directory: string;
        try { directory = projectDirectory(representativeProject(input.board, input.hub)); }
        catch (error) { result.push({ stage, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) }); continue; }
        let fingerprint: string;
        try { fingerprint = (await native.plan({ definition: column.scripted, projectDirectory: directory, taskDirectory: directory, exits: targets })).fingerprint; }
        catch (error) { result.push({ stage, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) }); continue; }
        let approved: boolean;
        try { approved = await native.trust.isApproved({ hubId: input.hub.id, boardId: input.board.id, stageIdentity: identity }, fingerprint); }
        catch (error) { result.push({ stage, verdict: 'unverifiable', reasons: ['unresolvable'], detail: error instanceof Error ? error.message : String(error) }); continue; }
        if (approved) { result.push({ stage, verdict: 'holds', reasons: [], version: fingerprint }); continue; }
        const previous = input.before?.columns.find(value => value.id === column.id);
        if (unchanged(previous, column)) { result.push({ stage, verdict: 'changed', reasons: ['unapproved'], version: fingerprint, detail: 'This executable version was never approved in this board.' }); continue; }
        const reasons = changedReasons(previous, column);
        result.push({ stage, verdict: 'changed', reasons: reasons.length === 0 ? ['unapproved'] : reasons, version: fingerprint });
      }
      return result;
    },
  };
}
