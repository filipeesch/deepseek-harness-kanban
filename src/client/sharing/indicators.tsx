import React from 'react';
import type { HubSharingView, SharingBoardState } from '../../shared/types.js';

/** The Hub-level publishing indicator, alongside the existing attention dots. */
export function HubPublishingBadge({ view }: { view?: HubSharingView }) {
  if (!view || view.status === 'not-published') return null;
  if (view.status === 'preview') return <span className="kb-dot kb-share-dot kb-share-draft" role="img" aria-label="Team storage connection needs review" title="Team storage connection needs review" />;
  return <>
    {view.syncing && <span className="kb-dot kb-share-dot kb-share-updates" role="img" aria-label="Synchronizing team configuration" title="Synchronizing team configuration" />}
    {(view.conflicts > 0 || view.status === 'needs-review' || view.blockers.length > 0) && <span className="kb-dot kb-share-dot kb-share-review" role="img" aria-label="Team review needed" title="Team review needed" />}
    {view.updates > 0 && <span className="kb-dot kb-share-dot kb-share-updates" role="img" aria-label="Team updates available" title="Team updates available" />}
    {view.status === 'unavailable' && <span className="kb-dot kb-share-dot kb-share-unavailable" role="img" aria-label="Team updates unavailable" title={view.error?.message ?? 'Team updates unavailable'} />}
    {view.drafts > 0 && <span className="kb-dot kb-share-dot kb-share-draft" role="img" aria-label="Unsynced team changes" title="Unsynced team changes" />}
  </>;
}

const BOARD_LABEL: Record<Exclude<SharingBoardState, 'in-sync'>, { className: string; label: string }> = {
  draft: { className: 'kb-share-draft', label: 'Board changes not sent' },
  'updates-available': { className: 'kb-share-updates', label: 'Team updates available for this board' },
  'needs-review': { className: 'kb-share-review', label: 'This board needs a team review' },
  'update-required': { className: 'kb-share-review', label: 'Update the plugin to use this team board' },
  orphan: { className: 'kb-share-orphan', label: 'Board removed by the team' },
};

/** The per-board publishing indicator shown on the board tab. */
export function BoardPublishingBadge({ state }: { state?: SharingBoardState }) {
  if (!state || state === 'in-sync') return null;
  const value = BOARD_LABEL[state];
  if (!value) return null;
  return <span className={'kb-dot kb-share-dot ' + value.className} role="img" aria-label={value.label} title={value.label} />;
}
