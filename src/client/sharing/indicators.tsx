import React from 'react';
import type { HubSharingView, SharingBoardState } from '../../shared/types.js';
import { boardSharing, countLabel } from './status.js';

/**
 * The Hub-level publishing indicator. It states how many boards carry each kind of
 * pending work, so the tab is legible without opening Configuration.
 */
export function HubPublishingBadge({ view }: { view?: HubSharingView }) {
  if (!view || view.status === 'not-published') return null;
  if (view.status === 'preview') return <span className="kb-dot kb-share-dot kb-share-draft" role="img" aria-label="Team storage connection needs review" title="Team storage connection needs review" />;
  const publishing = view.drafts;
  const updates = view.updates;
  const review = view.conflicts > 0 || view.status === 'needs-review' || view.blockers.length > 0;
  return <>
    {view.syncing && <span className="kb-dot kb-share-dot kb-share-updates" role="img" aria-label="Synchronizing team configuration" title="Synchronizing team configuration" />}
    {review && <span className="kb-share-count kb-share-review" role="img" aria-label="Team review needed" title="Team review needed">!</span>}
    {updates > 0 && <span className="kb-share-count kb-share-updates" role="img" aria-label={countLabel(updates, 'board to get', 'boards to get')} title={countLabel(updates, 'board to get', 'boards to get')}>{updates}</span>}
    {publishing > 0 && <span className="kb-share-count kb-share-draft" role="img" aria-label={countLabel(publishing, 'board to publish', 'boards to publish')} title={countLabel(publishing, 'board to publish', 'boards to publish')}>{publishing}</span>}
    {view.status === 'unavailable' && <span className="kb-dot kb-share-dot kb-share-unavailable" role="img" aria-label="Team updates unavailable" title={view.error?.message ?? 'Team updates unavailable'} />}
  </>;
}

const BOARD_LABEL: Record<Exclude<SharingBoardState, 'in-sync'>, { className: string; label: string }> = {
  draft: { className: 'kb-share-draft', label: 'Board changes not sent' },
  'updates-available': { className: 'kb-share-updates', label: 'Team updates available for this board' },
  'needs-review': { className: 'kb-share-review', label: 'This board needs a team review' },
  'update-required': { className: 'kb-share-review', label: 'Update the plugin to use this team board' },
  orphan: { className: 'kb-share-orphan', label: 'Board removed by the team' },
};

/** The per-board publishing indicator, with the pending count when there is one. */
export function BoardPublishingBadge({ view, boardId }: { view?: HubSharingView; boardId?: string }) {
  if (view === undefined || boardId === undefined) return null;
  const board = boardSharing(view, boardId);
  if (board === undefined || board.state === 'in-sync') return null;
  const value = BOARD_LABEL[board.state];
  if (value === undefined) return null;
  const count = board.state === 'updates-available' ? (board.updates ?? 0) : board.draft ? (board.detail?.changes.length ?? 1) : 0;
  const label = count > 0 ? value.label + ' (' + count + ')' : value.label;
  return count > 0
    ? <span className={'kb-share-count ' + value.className} role="img" aria-label={label} title={label}>{count}</span>
    : <span className={'kb-dot kb-share-dot ' + value.className} role="img" aria-label={label} title={label} />;
}
