import type { HubState, HubSharingView, Problem, SharingBoardState, SharingBoardView } from '../../shared/types.js';
import { displayState, type BoardDecision, type SharingComparison } from '../../domain/sharing/plan.js';
import { compareSharing } from '../../domain/sharing/plan.js';
import { projectSharingBoards } from '../../domain/sharing/projection.js';
import type { SharedHubDocument } from '../../domain/sharing/document.js';
import type { HubSharingRecord } from './state.js';

export function publishedDocument(record: HubSharingRecord): SharedHubDocument {
  return record.preview?.document ?? record.seen?.document ?? { version: 1, boards: [] };
}

export function sharingComparison(record: HubSharingRecord, hub: HubState): SharingComparison {
  return compareSharing({
    base: record.base?.document ?? null,
    published: publishedDocument(record),
    local: projectSharingBoards(hub, record.bindings),
    bindings: record.bindings,
    orphans: record.orphans,
    removed: record.removed,
    pendingRemovals: record.pendingRemovals,
  });
}

function boardState(decision: BoardDecision): SharingBoardState {
  return displayState(decision);
}

/** Project stored publishing state plus the current Hub into the snapshot view. */
export function buildSharingView(record: HubSharingRecord, hub: HubState): HubSharingView {
  const comparison = sharingComparison(record, hub);
  const boards: SharingBoardView[] = comparison.boards
    .filter(board => board.boardId !== undefined && board.decision !== 'create')
    .map(board => ({
      boardId: board.boardId!,
      ...(board.key === undefined ? {} : { key: board.key }),
      name: board.name,
      state: boardState(board.decision),
      bound: record.bindings[board.boardId!] !== undefined,
      pending: board.pending,
      ...(board.local !== undefined && board.published !== undefined && (board.local.workflow !== board.published.workflow || board.local.name !== board.published.name) ? { detail: { local: board.local.workflow, team: board.published.workflow, localName: board.local.name, teamName: board.published.name } } : {}),
    }));
  const incoming = comparison.boards.filter(board => board.decision === 'create' && board.key !== undefined).map(board => ({ key: board.key!, name: board.name }));
  const removing = comparison.boards.filter(board => board.decision === 'remove' && board.boardId !== undefined).map(board => ({ boardId: board.boardId!, name: board.name }));
  const error: Problem | undefined = record.lastError ? { code: record.lastError.code, message: record.lastError.message } : undefined;
  const status = record.preview
    ? 'preview'
    : record.lastError
      ? 'unavailable'
      : comparison.conflicts > 0
        ? 'needs-review'
        : comparison.updates > 0
          ? 'updates-available'
          : 'published';
  return {
    status,
    provider: record.binding.provider,
    repository: record.binding.repository,
    intervalMinutes: record.binding.intervalMinutes,
    ...(record.lastCheck === null ? {} : { lastCheckedAt: record.lastCheck.at }),
    ...(error === undefined ? {} : { error }),
    drafts: comparison.drafts,
    updates: comparison.updates,
    conflicts: comparison.conflicts,
    orderChanged: comparison.orderChanged,
    boards,
    incoming,
    removed: comparison.removed,
    blockers: comparison.blockers,
    ...(record.preview === null ? {} : { preview: { publishedBoards: record.preview.document.boards.length, localBoards: hub.boards.length } }),
    removing,
  };
}
