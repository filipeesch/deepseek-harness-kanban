import { KanbanError } from '../../shared/errors.js';
import { parseWorkflow } from '../workflow.js';
import { SHARED_DOCUMENT_VERSION, boardContentKey, sameSharedDocument, type SharedBoardEntry, type SharedHubDocument } from './document.js';
import { canonicalProjectKeys } from '../project-key.js';
import { boardKeyFromName, normalizeBoardName, type BoardBindings, type OrphanMap } from './identity.js';
import type { LocalSharedBoard } from './projection.js';
import { mergeWorkflowPlacements } from './workflow-merge.js';

/** Display states shared with the client. */
export type BoardSharingState = 'in-sync' | 'draft' | 'updates-available' | 'needs-review' | 'orphan';
export type BoardDecision = BoardSharingState | 'create' | 'adopt' | 'reconnect' | 'remove';

export interface SharingBlocker {
  code: 'SHARING_ORPHAN_COLUMNS' | 'SHARING_NAME_COLLISION' | 'SHARING_NAME_CONFLICT';
  message: string;
  boardId?: string;
  boardName?: string;
  columnId?: string;
  tasks?: number;
}

export interface SharingContent {
  name: string;
  workflow: string;
  /** Absent means the board allows every project; an empty list closes it to creation. */
  projectKeys?: readonly string[];
}

export interface BoardComparison {
  decision: BoardDecision;
  /** True while this decision still requires Get updates to become local state. */
  pending: boolean;
  boardId?: string;
  key?: string;
  name: string;
  local?: SharingContent;
  published?: SharingContent;
  base?: SharingContent;
  /** The content applying should store instead of the published content. */
  resolved?: SharingContent;
  tasks: number;
}

export interface RemovedBoardComparison { boardId: string; key: string; name: string }

export interface SharingComparison {
  boards: BoardComparison[];
  removed: RemovedBoardComparison[];
  blockers: SharingBlocker[];
  drafts: number;
  updates: number;
  conflicts: number;
  /** The team changed the relative order of boards that exist in both documents. */
  orderChanged: boolean;
}

export interface SharingInput {
  /** Last received document; null before the first receive, which enables first-connection adoption. */
  base: SharedHubDocument | null;
  published: SharedHubDocument;
  local: LocalSharedBoard[];
  bindings: Readonly<BoardBindings>;
  orphans: Readonly<OrphanMap>;
  /** Keys the user removed only from this installation. */
  removed: Readonly<Record<string, { boardId: string; name: string }>>;
  /** Keys this installation is about to remove for the team. */
  pendingRemovals: readonly string[];
}

export type ApplyDecision = 'updates-available' | 'create' | 'adopt' | 'reconnect';

export interface SharingPlan {
  comparison: SharingComparison;
  apply: Array<{ boardId?: string; key: string; name: string; workflow: string; projectKeys?: readonly string[] }>;
  removals: string[];
  orphans: Array<{ boardId: string; lastKey: string; lastPublishedName: string }>;
  reconnections: Array<{ boardId: string; key: string }>;
  conflicts: Array<{ boardId: string; key: string; name: string }>;
  /** Published order to apply; present only when the team reordered shared boards. */
  order?: Array<{ key: string; boardId?: string }>;
  nextBase: SharedHubDocument;
}

function content(value: { name: string; workflow: string; projectKeys?: readonly string[] }): SharingContent {
  return { name: value.name, workflow: value.workflow, ...(value.projectKeys === undefined ? {} : { projectKeys: [...value.projectKeys] }) };
}

/** Two scopes are the same when both are absent, or both name the same keys in order. */
function sameProjectKeys(left: SharingContent, right: SharingContent): boolean {
  if (left.projectKeys === undefined || right.projectKeys === undefined) return left.projectKeys === right.projectKeys;
  const canonical = (keys: readonly string[]): string => canonicalProjectKeys(keys).join('\u0000');
  return canonical(left.projectKeys) === canonical(right.projectKeys);
}

function sameContent(left: SharingContent, right: SharingContent): boolean {
  return boardContentKey(left) === boardContentKey(right);
}

export function isApplyDecision(decision: BoardDecision): decision is ApplyDecision {
  return decision === 'updates-available' || decision === 'create' || decision === 'adopt' || decision === 'reconnect';
}

export function displayState(decision: BoardDecision): BoardSharingState {
  if (decision === 'create') return 'updates-available';
  if (decision === 'adopt' || decision === 'reconnect') return 'updates-available';
  if (decision === 'remove') return 'updates-available';
  return decision;
}

interface OrphanMatch { boardId: string; lastKey: string; lastPublishedName: string }

function matchOrphan(entry: SharedBoardEntry, local: LocalSharedBoard[], orphans: Readonly<OrphanMap>, claimed: ReadonlySet<string>): OrphanMatch | undefined {
  const present = new Set(local.map(board => board.boardId));
  const candidates = Object.entries(orphans).filter(([boardId]) => !claimed.has(boardId) && present.has(boardId));
  const byKey = candidates.find(([, value]) => value.lastKey === entry.key);
  if (byKey) return { boardId: byKey[0], ...byKey[1] };
  const wanted = normalizeBoardName(entry.name);
  const byName = candidates.find(([, value]) => normalizeBoardName(value.lastPublishedName) === wanted);
  return byName ? { boardId: byName[0], ...byName[1] } : undefined;
}

/**
 * Compare the last received document, the current local Hub, and the published
 * document. Pure: no clock, no I/O, no mutation.
 */
export function compareSharing(input: SharingInput): SharingComparison {
  const baseByKey = new Map((input.base?.boards ?? []).map(entry => [entry.key, entry]));
  const publishedByKey = new Map(input.published.boards.map(entry => [entry.key, entry]));
  const localById = new Map(input.local.map(board => [board.boardId, board]));
  const boundByKey = new Map(input.local.filter(board => board.key !== undefined).map(board => [board.key!, board]));
  const removedKeys = new Set(Object.keys(input.removed));
  const pending = new Set(input.pendingRemovals);
  const localIds = new Set(input.local.map(board => board.boardId));
  // A binding whose board no longer exists is a deletion in flight: never recreate
  // the published board before the removal scope is recorded.
  const vanished = new Set(Object.entries(input.bindings).filter(([boardId]) => !localIds.has(boardId)).map(([, key]) => key));
  const claimedOrphans = new Set<string>();
  const claimedBoards = new Set<string>();
  const boards: BoardComparison[] = [];
  const blockers: SharingBlocker[] = [];

  for (const entry of input.published.boards) {
    if (removedKeys.has(entry.key) || pending.has(entry.key) || vanished.has(entry.key)) continue;
    const local = boundByKey.get(entry.key);
    if (local) {
      claimedBoards.add(local.boardId);
      const baseEntry = baseByKey.get(entry.key);
      const localContent = content(local);
      const publishedContent = content(entry);
      const baseContent = baseEntry ? content(baseEntry) : undefined;
      let decision: BoardDecision;
      let resolved: SharingContent | undefined;
      if (sameContent(localContent, publishedContent)) decision = 'in-sync';
      else if (baseContent === undefined) decision = 'updates-available';
      else {
        // A difference limited to stage placement merges instead of asking for a
        // choice; only a meaning changed differently on both sides still does. A
        // project scope difference is a meaning change, so it never merges this way.
        const merge = sameProjectKeys(localContent, publishedContent)
          ? mergeWorkflowPlacements({ base: baseContent, local: localContent, published: publishedContent })
          : null;
        if (merge !== null) {
          const merged: SharingContent = { name: merge.name, workflow: merge.workflow, ...(localContent.projectKeys === undefined ? {} : { projectKeys: [...localContent.projectKeys] }) };
          decision = sameContent(merged, localContent) ? 'draft' : 'updates-available';
          if (!sameContent(merged, publishedContent)) resolved = merged;
        } else if (sameContent(localContent, baseContent)) decision = 'updates-available';
        else if (sameContent(publishedContent, baseContent)) decision = 'draft';
        else decision = 'needs-review';
      }
      boards.push({ decision, pending: decision === 'updates-available', boardId: local.boardId, key: entry.key, name: local.name, local: localContent, published: publishedContent, ...(baseContent ? { base: baseContent } : {}), ...(resolved === undefined ? {} : { resolved }), tasks: local.tasks });
      continue;
    }
    const orphan = matchOrphan(entry, input.local, input.orphans, claimedOrphans);
    if (orphan) {
      claimedOrphans.add(orphan.boardId);
      claimedBoards.add(orphan.boardId);
      const board = localById.get(orphan.boardId)!;
      boards.push({ decision: 'reconnect', pending: true, boardId: orphan.boardId, key: entry.key, name: entry.name, local: content(board), published: content(entry), tasks: board.tasks });
      continue;
    }
    const sameName = input.local.find(board => board.key === undefined && input.orphans[board.boardId] === undefined && !claimedBoards.has(board.boardId) && normalizeBoardName(board.name) === normalizeBoardName(entry.name));
    if (sameName) {
      claimedBoards.add(sameName.boardId);
      if (input.base === null) {
        boards.push({ decision: 'adopt', pending: true, boardId: sameName.boardId, key: entry.key, name: entry.name, local: content(sameName), published: content(entry), tasks: sameName.tasks });
      } else {
        boards.push({ decision: 'needs-review', pending: false, boardId: sameName.boardId, name: sameName.name, local: content(sameName), published: content(entry), tasks: sameName.tasks });
        blockers.push({ code: 'SHARING_NAME_COLLISION', message: 'The team published a board named "' + entry.name + '" but this installation has an unpublished board with that name. Rename or publish the local board first.', boardId: sameName.boardId, boardName: sameName.name });
      }
      continue;
    }
    boards.push({ decision: 'create', pending: true, key: entry.key, name: entry.name, published: content(entry), tasks: 0 });
  }

  for (const board of input.local) {
    if (claimedBoards.has(board.boardId)) continue;
    const orphan = input.orphans[board.boardId];
    if (orphan) {
      boards.push({ decision: 'orphan', pending: false, boardId: board.boardId, key: orphan.lastKey, name: board.name, local: content(board), tasks: board.tasks });
      continue;
    }
    if (board.key !== undefined) {
      const baseEntry = baseByKey.get(board.key);
      const localChanged = baseEntry === undefined || boardContentKey(content(board)) !== boardContentKey(content(baseEntry));
      const decision: BoardDecision = board.tasks > 0 || localChanged ? 'orphan' : 'remove';
      boards.push({ decision, pending: true, boardId: board.boardId, key: board.key, name: board.name, local: content(board), ...(baseEntry ? { base: content(baseEntry) } : {}), tasks: board.tasks });
      continue;
    }
    boards.push({ decision: 'draft', pending: false, boardId: board.boardId, name: board.name, local: content(board), tasks: board.tasks });
  }

  for (const board of boards) {
    if (!isApplyDecision(board.decision) || board.boardId === undefined || board.published === undefined) continue;
    const local = localById.get(board.boardId);
    if (!local || local.taskColumns.length === 0) continue;
    const columns = new Set(parseWorkflow((board.resolved ?? board.published).workflow).columns.map(column => column.id));
    for (const entry of local.taskColumns) {
      if (columns.has(entry.columnId)) continue;
      blockers.push({
        code: 'SHARING_ORPHAN_COLUMNS',
        message: 'Board "' + local.name + '" would leave ' + entry.tasks + ' task' + (entry.tasks === 1 ? '' : 's') + ' in column "' + entry.columnId + '", which the team workflow does not define.',
        boardId: local.boardId,
        boardName: local.name,
        columnId: entry.columnId,
        tasks: entry.tasks,
      });
    }
  }

  const removalIds = new Set(boards.filter(board => board.decision === 'remove').map(board => board.boardId!));
  for (const board of boards) {
    if (!isApplyDecision(board.decision) || board.published === undefined) continue;
    // The applied name can differ from the published one after a local rename
    // merged with a placement update; the blocker must judge the resolved name.
    const target = board.resolved ?? board.published;
    const wanted = normalizeBoardName(target.name);
    for (const other of input.local) {
      if (other.boardId === board.boardId || removalIds.has(other.boardId)) continue;
      if (normalizeBoardName(other.name) !== wanted) continue;
      blockers.push({ code: 'SHARING_NAME_CONFLICT', message: 'Applying the team board "' + target.name + '" would duplicate the local board name.', ...(board.boardId === undefined ? {} : { boardId: board.boardId }), boardName: target.name });
    }
  }

  const removed = Object.entries(input.removed)
    .filter(([key]) => publishedByKey.has(key))
    .map(([key, value]) => ({ key, boardId: value.boardId, name: value.name }));

  const orderChanged = input.base !== null && orderDiffers(input.base, input.published);
  const localOrder = input.local.filter(board => board.key !== undefined && (input.base?.boards ?? []).some(entry => entry.key === board.key)).map(board => board.key!);
  const baseOrder = (input.base?.boards ?? []).map(entry => entry.key).filter(key => localOrder.includes(key));
  const localOrderChanged = input.base !== null && localOrder.join('\u0000') !== baseOrder.join('\u0000');
  const drafts = boards.filter(board => board.decision === 'draft').length + (localOrderChanged ? 1 : 0) + input.pendingRemovals.filter(key => publishedByKey.has(key) || (input.base?.boards ?? []).some(entry => entry.key === key)).length;
  const updates = boards.filter(board => board.pending).length + (orderChanged ? 1 : 0);
  const conflicts = boards.filter(board => board.decision === 'needs-review').length;
  return { boards, removed, blockers: dedupeBlockers(blockers), drafts, updates, conflicts, orderChanged };
}

function orderDiffers(base: SharedHubDocument, published: SharedHubDocument): boolean {
  const publishedKeys = new Set(published.boards.map(entry => entry.key));
  const baseOrder = base.boards.map(entry => entry.key).filter(key => publishedKeys.has(key));
  const baseKeys = new Set(base.boards.map(entry => entry.key));
  const publishedOrder = published.boards.map(entry => entry.key).filter(key => baseKeys.has(key));
  return baseOrder.join('\u0000') !== publishedOrder.join('\u0000');
}

function dedupeBlockers(values: SharingBlocker[]): SharingBlocker[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = [value.code, value.boardId ?? value.boardName ?? '', value.columnId ?? ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Build the update application plan. Blockers make the plan unapplyable, never partial. */
export function buildUpdatePlan(input: SharingInput): SharingPlan {
  const comparison = compareSharing(input);
  const apply = comparison.boards
    .filter(board => isApplyDecision(board.decision) && board.published !== undefined && (board.key !== undefined || board.decision === 'create'))
    .map(board => {
      const source = board.resolved ?? board.published!;
      return {
        ...(board.boardId === undefined ? {} : { boardId: board.boardId }),
        key: board.key!,
        name: source.name,
        workflow: source.workflow,
        ...(source.projectKeys === undefined ? {} : { projectKeys: [...source.projectKeys] }),
      };
    });
  const removals = comparison.boards.filter(board => board.decision === 'remove' && board.boardId !== undefined).map(board => board.boardId!);
  const orphans = comparison.boards
    .filter(board => board.decision === 'orphan' && board.boardId !== undefined && board.key !== undefined)
    .map(board => {
      const baseEntry = (input.base?.boards ?? []).find(entry => entry.key === board.key);
      return { boardId: board.boardId!, lastKey: board.key!, lastPublishedName: baseEntry?.name ?? board.name };
    });
  const reconnections = comparison.boards
    .filter(board => board.decision === 'reconnect' && board.boardId !== undefined && board.key !== undefined)
    .map(board => ({ boardId: board.boardId!, key: board.key! }));
  const conflicts = comparison.boards
    .filter(board => board.decision === 'needs-review' && board.boardId !== undefined && board.key !== undefined)
    .map(board => ({ boardId: board.boardId!, key: board.key!, name: board.name }));
  const order = comparison.orderChanged
    ? input.published.boards.map(entry => ({ key: entry.key, ...(comparison.boards.find(board => board.key === entry.key && board.boardId !== undefined)?.boardId === undefined ? {} : { boardId: comparison.boards.find(board => board.key === entry.key && board.boardId !== undefined)!.boardId! }) }))
    : undefined;
  const conflictKeys = new Set(conflicts.map(conflict => conflict.key));
  const nextBase: SharedHubDocument = {
    version: SHARED_DOCUMENT_VERSION,
    boards: input.published.boards.map(entry => {
      if (!conflictKeys.has(entry.key)) return { ...entry };
      const baseEntry = (input.base?.boards ?? []).find(candidate => candidate.key === entry.key);
      return baseEntry ? { ...baseEntry } : { ...entry };
    }),
  };
  return { comparison, apply, removals, orphans, reconnections, conflicts, ...(order === undefined ? {} : { order }), nextBase };
}

export interface PublishDocument { document: SharedHubDocument; bindings: BoardBindings }

/**
 * Compose what this installation would publish: every local board in document
 * order, preserved entries this installation removed only locally, and no
 * orphan. Allocates keys for boards entering the document for the first time.
 */
export function buildPublishDocument(input: {
  base: SharedHubDocument | null;
  local: readonly LocalSharedBoard[];
  bindings: Readonly<BoardBindings>;
  orphans: Readonly<OrphanMap>;
  pendingRemovals: readonly string[];
  /** Keys that must not be reused, such as an orphan's removed key. */
  reserved?: Iterable<string>;
}): PublishDocument {
  const pending = new Set(input.pendingRemovals);
  const orphanIds = new Set(Object.keys(input.orphans));
  const bindings: BoardBindings = { ...input.bindings };
  const baseKeys = (input.base?.boards ?? []).map(entry => entry.key);
  const taken = new Set<string>([...(input.reserved ?? []), ...baseKeys]);
  const entries: SharedBoardEntry[] = [];
  const localKeys = new Set<string>();
  for (const board of input.local) {
    if (orphanIds.has(board.boardId)) continue;
    let key = board.key;
    if (key === undefined) {
      key = boardKeyFromName(board.name, taken);
      taken.add(key);
      bindings[board.boardId] = key;
    }
    if (pending.has(key) || localKeys.has(key)) continue;
    entries.push({ key, name: board.name, workflow: board.workflow, ...(board.projectKeys === undefined ? {} : { projectKeys: [...board.projectKeys] }) });
    localKeys.add(key);
  }
  // A board deleted only from this installation stays in the team document, at
  // the closest position its base predecessor still occupies.
  const preserved = (input.base?.boards ?? []).filter(entry => !localKeys.has(entry.key) && !pending.has(entry.key));
  const present = new Set(entries.map(entry => entry.key));
  for (const entry of preserved) {
    const baseIndex = baseKeys.indexOf(entry.key);
    let insertAt = 0;
    for (let index = baseIndex - 1; index >= 0; index--) {
      const key = baseKeys[index]!;
      if (!present.has(key)) continue;
      insertAt = entries.findIndex(candidate => candidate.key === key) + 1;
      break;
    }
    entries.splice(insertAt, 0, { ...entry });
    present.add(entry.key);
  }
  const names = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeBoardName(entry.name);
    if (names.has(normalized)) throw new KanbanError('SHARING_NAME_CONFLICT', 'Publishing would duplicate the board name "' + entry.name + '".', { board: entry.name });
    names.add(normalized);
  }
  return { document: { version: SHARED_DOCUMENT_VERSION, boards: entries }, bindings };
}

export function publishIsDirty(document: SharedHubDocument, base: SharedHubDocument | null): boolean {
  return !sameSharedDocument(document, base);
}
