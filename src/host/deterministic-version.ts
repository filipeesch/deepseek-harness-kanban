import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { canonicalDeterministic } from '../domain/deterministic-definition.js';
import type { Board, Column, HubState, Project, Workflow } from '../shared/types.js';
import type { DeterministicDefinition, DeterministicTarget } from '../shared/deterministic.js';
import { reconcileLocalStageIdentities } from '../domain/deterministic-state.js';
import { creatableProjects } from '../domain/board-project-scope.js';
import { requireProjectPath } from '../shared/project.js';
import { KanbanError } from '../shared/errors.js';

/**
 * The stable identity every stage carries for the next review. The reconciliation
 * runs on a copy so a read-only review never rewrites the board's local map.
 */
export function boardStageIdentities(board: Board, next: Workflow = board.workflow): Map<string, string | undefined> {
  const probe: Pick<Board, 'workflow' | 'localStageIdentities'> = {
    workflow: board.workflow,
    ...(board.localStageIdentities === undefined ? {} : { localStageIdentities: { ...board.localStageIdentities } }),
  };
  reconcileLocalStageIdentities(probe, next);
  const identities = new Map<string, string | undefined>();
  for (const column of next.columns) identities.set(column.id, probe.localStageIdentities?.[column.id] ?? column.key);
  return identities;
}

export function stageTargets(identities: ReadonlyMap<string, string | undefined>, column: Column): Record<string, DeterministicTarget> | null {
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

/** A relative primary file is read from the execution directory, so its bytes depend on it. */
export function directoryDependent(definition: Pick<DeterministicDefinition, 'file'>): boolean {
  return definition.file !== undefined && !isAbsolute(definition.file);
}

/** The first project the board allows supplies a directory for an authored review. */
export function representativeProject(board: Board, hub: HubState): Project {
  const [project] = creatableProjects(board, hub.projects);
  if (project === undefined) throw new KanbanError('PROJECT_DIRECTORY_REQUIRED', 'Add a project the board allows before reviewing or approving a script.');
  return project;
}

/**
 * A saved-stage generation for review TOCTOU checks. It covers the authored
 * definition and the stable identities of its destinations, but no file bytes:
 * a captured execution is reviewed from its own immutable bytes.
 */
export function stageGeneration(board: Board, column: Column): string {
  const definition = column.deterministic;
  if (definition === undefined) return '';
  const identities = boardStageIdentities(board);
  const stageIdentity = identities.get(column.id) ?? column.key ?? null;
  const exits = Object.fromEntries(Object.entries(definition.exits).map(([exit, columnId]) => [exit, { columnId, stageIdentity: identities.get(columnId) ?? board.workflow.columns.find(candidate => candidate.id === columnId)?.key ?? null }]));
  // Descriptions are authoring guidance, not reviewed authority; a description
  // edit must not invalidate an approval whose version did not change.
  const authority = { ...definition, params: (definition.params ?? []).map(parameter => ({ name: parameter.name })) };
  return createHash('sha256').update(JSON.stringify({ stageIdentity, definition: canonicalDeterministic(authority), exits })).digest('hex');
}

export function projectDirectory(project: Project): string {
  const directory = requireProjectPath(project);
  if (typeof directory !== 'string' || directory.length === 0) throw new KanbanError('PROJECT_DIRECTORY_REQUIRED', 'The project has no registered directory.');
  return directory;
}
