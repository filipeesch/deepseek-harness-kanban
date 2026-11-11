import type { HubSharingView, HubState, Problem, SharingAuthStatus, SharingBlockerView, SharingBoardState, SharingBoardView } from '../../shared/types.js';
import type { SharedHubManifest } from '../../domain/sharing/manifest.js';
import { boardContentKey } from '../../domain/sharing/manifest.js';
import { normalizeBoardName } from '../../domain/sharing/identity.js';
import { projectSharingBoards, type LocalSharedBoard } from '../../domain/sharing/projection.js';
import { workflowDigest } from '../../domain/sharing/board-plan.js';
import type { ProviderDescription } from './provider.js';
import type { HubSharingRecord, StoredBoard } from './state.js';

/** The published manifest this installation last read, or an empty one. */
export function publishedManifest(record: HubSharingRecord): SharedHubManifest {
  return record.preview?.manifest ?? record.seen?.manifest ?? { version: 3, boards: [] };
}

/** The manifest this installation last applied, which is what a draft is compared to. */
export function baseManifest(record: HubSharingRecord): SharedHubManifest | null {
  return record.base?.manifest ?? null;
}

export interface SharingViewContext {
  provider: ProviderDescription;
  authorization?: SharingAuthStatus;
  syncing?: boolean;
}

function boardState(local: LocalSharedBoard, entry: { name: string; projectKeys?: readonly string[] } | undefined, stored: StoredBoard | undefined, orphaned: boolean): SharingBoardState {
  // An orphan is a board whose published key the team dropped; a board the team never
  // named has no key and is simply a draft to send.
  if (entry === undefined) return orphaned || local.key !== undefined ? 'orphan' : 'draft';
  if (stored?.conflict != null) return 'needs-review';
  if ((stored?.behind ?? 0) > 0) return 'updates-available';
  const scopeMatches = (local.projectKeys === undefined && entry.projectKeys === undefined)
    || (local.projectKeys !== undefined && entry.projectKeys !== undefined && local.projectKeys.join('\u0000') === entry.projectKeys.join('\u0000'));
  const edited = stored?.published != null && stored.published !== workflowDigest(local.workflow);
  if (stored?.draft === true || edited || local.name !== entry.name || !scopeMatches) return 'draft';
  return 'in-sync';
}

/** The board order differs between the local Hub and the published manifest. */
function orderDiffers(local: readonly LocalSharedBoard[], manifest: SharedHubManifest): boolean {
  const publishedKeys = manifest.boards.map(entry => entry.key);
  const localKeys = local.filter(board => board.key !== undefined && publishedKeys.includes(board.key)).map(board => board.key!);
  const baseKeys = publishedKeys.filter(key => localKeys.includes(key));
  return baseKeys.join('\u0000') !== localKeys.join('\u0000');
}

/** Project the stored publishing state plus the current Hub into the snapshot view. */
export function buildSharingView(record: HubSharingRecord, hub: HubState, context: SharingViewContext): HubSharingView {
  const manifest = publishedManifest(record);
  const local = projectSharingBoards(hub, record.bindings);
  const entries = new Map(manifest.boards.map(entry => [entry.key, entry]));
  const boards: SharingBoardView[] = local.map(board => {
    const entry = board.key === undefined ? undefined : entries.get(board.key);
    const stored = board.key === undefined ? undefined : record.boards[board.key];
    const state = boardState(board, entry, stored, record.orphans[board.boardId] !== undefined);
    const sameContent = entry !== undefined && boardContentKey({ name: board.name, projectKeys: board.projectKeys }) === boardContentKey({ name: entry.name, projectKeys: entry.projectKeys });
    return {
      boardId: board.boardId,
      ...(board.key === undefined ? {} : { key: board.key }),
      name: board.name,
      state,
      bound: record.bindings[board.boardId] !== undefined,
      pending: state === 'updates-available' || state === 'draft',
      ...((stored?.behind ?? 0) === 0 ? {} : { updates: stored!.behind }),
      ...(state === 'needs-review' && stored?.publishedText != null
        ? { detail: { local: board.workflow, team: stored.publishedText, localName: board.name, teamName: entry!.name } }
        : {}),
    };
  });
  // A board the manifest names and this installation does not hold is incoming.
  const boundKeys = new Set(local.map(board => board.key).filter((key): key is string => key !== undefined));
  const incoming = manifest.boards.filter(entry => !boundKeys.has(entry.key)).map(entry => ({ key: entry.key, name: entry.name }));
  const removed = Object.entries(record.removed)
    .filter(([key]) => entries.has(key))
    .map(([key, value]) => ({ key, boardId: value.boardId, name: value.name }));
  const updated = boards.filter(board => board.state === 'updates-available').length + incoming.length;
  const conflicts = boards.filter(board => board.state === 'needs-review').length;
  const drafts = boards.filter(board => board.state === 'draft').length + (orderDiffers(local, manifest) ? 1 : 0) + record.pendingRemovals.length;
  const blocks: SharingBlockerView[] = record.storageReview
    ? [{ code: record.storageReview.code, message: record.storageReview.message }]
    : record.reviewRequired
      ? [{ code: record.reviewRequired.code, message: record.reviewRequired.message }]
      : [];
  const error: Problem | undefined = record.lastError ? { code: record.lastError.code, message: record.lastError.message } : undefined;
  const status = record.preview
    ? 'preview'
    : record.lastError
      ? 'unavailable'
      : record.storageReview != null || conflicts > 0
        ? 'needs-review'
        : updated > 0
          ? 'updates-available'
          : 'published';
  return {
    status,
    provider: record.binding.provider,
    providerLabel: context.provider.label,
    supportsFiles: context.provider.supportsFiles,
    address: context.provider.address,
    ...(record.binding.provider === 'git' ? { repository: context.provider.address } : {}),
    syncMode: 'explicit',
    ...(context.provider.requiresAuthorization ? { authorization: context.authorization ?? 'not-connected' } : {}),
    intervalMinutes: record.binding.intervalMinutes,
    ...(record.lastCheck === null ? {} : { lastCheckedAt: record.lastCheck.at }),
    ...(record.lastSyncedAt === null || record.lastSyncedAt === undefined ? {} : { lastSyncedAt: record.lastSyncedAt }),
    ...(error === undefined ? {} : { error }),
    drafts,
    pending: drafts,
    updates: updated,
    conflicts,
    orderChanged: orderDiffers(local, manifest),
    syncing: context.syncing === true,
    boards,
    incoming,
    removed,
    blockers: blocks,
    ...(record.preview === null ? {} : { preview: { publishedBoards: record.preview.manifest.boards.length, localBoards: local.length } }),
    // A removal is applied by the update action, never reported as a pending state.
    removing: [],
  };
}

/** The board name one manifest entry must be matched by, normalized. */
export function normalizedName(value: string): string {
  return normalizeBoardName(value);
}
