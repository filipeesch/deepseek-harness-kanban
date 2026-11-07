import type { HubSharingView, HubState, Problem, SharingAuthStatus, SharingBlockerView, SharingBoardState, SharingBoardView } from '../../shared/types.js';
import { displayState, type BoardDecision, type SharingComparison } from '../../domain/sharing/plan.js';
import { compareSharing } from '../../domain/sharing/plan.js';
import { projectSharingBoards } from '../../domain/sharing/projection.js';
import type { SharedHubDocument } from '../../domain/sharing/document.js';
import type { ProviderDescription } from './provider.js';
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

export interface SharingViewContext {
  provider: ProviderDescription;
  authorization?: SharingAuthStatus;
  syncing?: boolean;
}

/** Project stored publishing state plus the current Hub into the snapshot view. */
export function buildSharingView(record: HubSharingRecord, hub: HubState, context: SharingViewContext): HubSharingView {
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
  // A storage-level review is a fact about the document, so it precedes the per-board comparison.
  const storageBlockers: SharingBlockerView[] = record.storageReview
    ? [{ code: record.storageReview.code, message: record.storageReview.message }]
    : [];
  const status = record.preview
    ? 'preview'
    : record.lastError
      ? 'unavailable'
      : record.storageReview != null || comparison.conflicts > 0
        ? 'needs-review'
        : comparison.updates > 0
          ? 'updates-available'
          : 'published';
  return {
    status,
    provider: record.binding.provider,
    providerLabel: context.provider.label,
    address: context.provider.address,
    ...(record.binding.provider === 'git' ? { repository: context.provider.address } : {}),
    syncMode: context.provider.syncMode,
    ...(context.provider.requiresAuthorization ? { authorization: context.authorization ?? 'not-connected' } : {}),
    intervalMinutes: record.binding.intervalMinutes,
    ...(record.lastCheck === null ? {} : { lastCheckedAt: record.lastCheck.at }),
    ...(record.lastSyncedAt === null || record.lastSyncedAt === undefined ? {} : { lastSyncedAt: record.lastSyncedAt }),
    ...(error === undefined ? {} : { error }),
    drafts: comparison.drafts,
    pending: comparison.drafts,
    updates: comparison.updates,
    conflicts: comparison.conflicts,
    orderChanged: comparison.orderChanged,
    syncing: context.syncing === true,
    boards,
    incoming,
    removed: comparison.removed,
    blockers: [...storageBlockers, ...comparison.blockers],
    ...(record.preview === null ? {} : { preview: { publishedBoards: record.preview.document.boards.length, localBoards: hub.boards.length } }),
    removing,
  };
}
