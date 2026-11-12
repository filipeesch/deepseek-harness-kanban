import type { HubSharingView, HubState, SharingAuthStatus, SharingBoardState, SharingBoardView, SharingBlockerView } from '../../shared/types.js';
import { boardChanges, evaluateBoard } from '../../domain/sharing/board-plan.js';
import { projectSharingBoards } from '../../domain/sharing/projection.js';
import { planRanks } from '../../domain/sharing/board-rank.js';
import type { ProviderDescription } from './provider.js';
import type { HubSharingRecord, StoredBoard } from './state.js';

/** The provider facts the view needs; they never come from the stored record. */
export interface SharingViewContext {
  provider: ProviderDescription;
  authorization?: SharingAuthStatus;
  syncing?: boolean;
}

function mirrorOf(record: HubSharingRecord, key: string): StoredBoard | null {
  return record.boards[key] ?? null;
}

/**
 * Project the stored publishing state plus the current Hub into the snapshot view.
 *
 * One evaluation decides each board's state, and the board rows carry the change
 * summary the interface shows; the authored texts travel only for a board that needs a
 * choice, because that is the only place the user compares them.
 */
export function buildSharingView(record: HubSharingRecord, hub: HubState, context: SharingViewContext): HubSharingView {
  const local = projectSharingBoards(hub, record.bindings);
  const boundKeys = local.flatMap(board => board.key === undefined ? [] : [board.key]);
  const ranks = new Map(boundKeys.map(key => [key, record.boards[key]?.rank ?? null]));
  const planned = planRanks(boundKeys, ranks);
  const boards: SharingBoardView[] = local.map(board => {
    const key = board.key;
    const stored = key === undefined ? null : mirrorOf(record, key);
    const rank = key === undefined ? null : planned?.get(key) ?? stored?.rank ?? null;
    const evaluation = evaluateBoard({
      local: board,
      mirror: stored === null ? null : { cursor: stored.seq, present: stored.present, workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, updates: stored.updates, removal: stored.removal, incoming: stored.incoming, conflict: stored.conflict, problem: stored.problem },
      orphaned: record.orphans[board.boardId] !== undefined,
      rank,
    });
    const review = evaluation.state === 'needs-review';
    const changes = evaluation.state === 'draft' || review
      ? boardChanges({ local: board, mirror: stored === null ? null : { cursor: stored.seq, present: stored.present, workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, updates: stored.updates, removal: stored.removal, incoming: stored.incoming, conflict: stored.conflict, problem: stored.problem }, rank })
      : [];
    return {
      boardId: board.boardId,
      ...(key === undefined ? {} : { key }),
      name: board.name,
      state: evaluation.state,
      bound: key !== undefined,
      draft: evaluation.draft,
      ...(evaluation.updates === 0 ? {} : { updates: evaluation.updates }),
      ...(changes.length === 0 && !review ? {} : {
        detail: {
          changes,
          ...(review && stored !== null ? {
            local: board.workflow,
            team: stored.incoming ?? stored.workflow ?? '',
            localName: board.name,
            teamName: record.published[key!]?.name ?? board.name,
          } : {}),
        },
      }),
    };
  });
  const bound = new Set(boundKeys);
  const incoming = Object.values(record.published)
    .filter(entry => !entry.removed && !bound.has(entry.key))
    .map(entry => ({ key: entry.key, name: entry.name }));
  const removed = Object.entries(record.removed)
    .filter(([key]) => record.published[key] !== undefined && !record.published[key]!.removed)
    .map(([key, value]) => ({ key, boardId: value.boardId, name: value.name }));
  const drafts = boards.filter(board => board.draft).length;
  const updates = boards.filter(board => board.state === 'updates-available').length + incoming.length;
  const conflicts = boards.filter(board => board.state === 'needs-review' || board.state === 'update-required').length;
  const blockers: SharingBlockerView[] = record.storageReview
    ? [{ code: record.storageReview.code, message: record.storageReview.message }]
    : record.reviewRequired
      ? [{ code: record.reviewRequired.code, message: record.reviewRequired.message }]
      : [];
  const error = record.lastError ? { code: record.lastError.code, message: record.lastError.message } : undefined;
  const status = record.preview
    ? 'preview'
    : record.lastError
      ? 'unavailable'
      : record.storageReview != null || record.reviewRequired != null || conflicts > 0
        ? 'needs-review'
        : updates > 0
          ? 'updates-available'
          : 'published';
  return {
    status,
    provider: record.binding.provider,
    providerLabel: context.provider.label,
    supportsFiles: context.provider.supportsFiles,
    address: context.provider.address,
    ...(record.notice == null ? {} : { notice: record.notice }),
    ...(context.provider.requiresAuthorization ? { authorization: context.authorization ?? 'not-connected' } : {}),
    intervalMinutes: record.binding.intervalMinutes,
    ...(record.lastCheck === null ? {} : { lastCheckedAt: record.lastCheck.at }),
    ...(record.lastSyncedAt === null ? {} : { lastSyncedAt: record.lastSyncedAt }),
    ...(error === undefined ? {} : { error }),
    drafts,
    updates,
    conflicts,
    syncing: context.syncing === true,
    boards,
    incoming,
    pendingRemovals: Object.entries(record.pendingRemovals).map(([key, value]) => ({ key, name: value.name })),
    ...(record.preview === null ? {} : { previewBoards: record.preview.boards.map(entry => ({ key: entry.key, name: entry.name })) }),
    removed,
    blockers,
    ...(record.preview === null ? {} : { preview: { publishedBoards: record.preview.boards.length, localBoards: local.length } }),
  };
}

export type { SharingBoardState };