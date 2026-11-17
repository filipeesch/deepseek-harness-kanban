import { parseWorkflow } from '../../../domain/workflow.js';
import type { JournalEvent } from '../../../domain/journal/event.js';
import type { BoardLog } from '../../../domain/journal/log.js';
import type { BoardMirrorView } from '../../../domain/sharing/board-plan.js';
import type { HubSharingRecord, StoredBoard } from '../state.js';

/** One board's board-level metadata, as its events state it. */
export interface BoardIdentity {
  readonly name: string | null;
  readonly projectKeys: string[] | null;
  readonly rank: string | null;
  /** The recorded default preset choice; null means the board records none. */
  readonly presetMode: 'operator' | 'host' | null;
}

/** The identity a fresh installation reads from a whole log. */
export const NO_IDENTITY: BoardIdentity = { name: null, projectKeys: null, rank: null, presetMode: null };

/** Fold the identity events of a batch onto the applied identity. */
export function foldIdentity(base: BoardIdentity, events: readonly JournalEvent[]): BoardIdentity {
  let name = base.name;
  let projectKeys = base.projectKeys;
  let rank = base.rank;
  let presetMode = base.presetMode;
  for (const event of events) {
    if (event.kind === 'board.renamed') name = event.name;
    else if (event.kind === 'board.scope-changed') projectKeys = event.projectKeys === null ? null : [...event.projectKeys];
    else if (event.kind === 'board.rank-changed') rank = event.rank;
    else if (event.kind === 'board.preset-changed') presetMode = event.mode;
  }
  return { name, projectKeys, rank, presetMode };
}

/** One stored board as the board rules read it: what was applied, and what was seen. */
export function mirrorView(stored: StoredBoard): BoardMirrorView {
  return { cursor: stored.seq, present: stored.present, workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, presetMode: stored.presetMode ?? null, updates: stored.updates, removal: stored.removal, incoming: stored.incoming, conflict: stored.conflict, problem: stored.problem };
}

/** The identity one stored mirror states, before any pending event. */
export function mirrorIdentity(stored: StoredBoard): BoardIdentity {
  return { name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, presetMode: stored.presetMode ?? null };
}

export function identityName(log: BoardLog): string | null {
  return foldIdentity(NO_IDENTITY, log).name;
}

/** The project scope one whole log states, or undefined when the board allows every project. */
export function appliedScope(log: BoardLog): string[] | undefined {
  const scope = foldIdentity(NO_IDENTITY, log).projectKeys;
  return scope === null ? undefined : scope;
}

/** The default preset choice one whole log states, or null when it records none. */
export function appliedPreset(log: BoardLog): 'operator' | 'host' | null {
  return foldIdentity(NO_IDENTITY, log).presetMode;
}

/** A replacement after a removal republishes that board under the same key. */
export function isTombstoned(log: BoardLog): boolean {
  for (let index = log.length - 1; index >= 0; index--) {
    const event = log[index]!;
    if (event.kind === 'board.removed') return true;
    if (event.kind === 'workflow.replaced') return false;
  }
  return false;
}

export function nameOf(record: HubSharingRecord, key: string, fallback: string): string {
  return record.published[key]?.name ?? fallback;
}

/** Whether the installed workflow names a stage the team is renaming differently. */
export function identityDiverged(workflowText: string, events: readonly JournalEvent[]): boolean {
  let workflow;
  try { workflow = parseWorkflow(workflowText); }
  catch { return false; }
  for (const event of events) {
    if (event.kind !== 'stage.id-changed') continue;
    const column = workflow.columns.find(candidate => candidate.key === event.key);
    if (column === undefined) continue;
    if (column.id !== event.from && column.id !== event.id) return true;
  }
  return false;
}
