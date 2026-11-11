import React from 'react';
import type { HubSharingView } from '../../shared/types.js';
import { DismissButton } from './dismiss-button.js';
import { focusAfterDismissal } from './focus.js';

/**
 * A stable description of the Hub's pending team state. A different value means the
 * team has changed something new, which re-presents a dismissed banner.
 */
export function teamBannerSignature(view: HubSharingView, boardId?: string): string {
  const blockers = [...view.blockers]
    .map(blocker => [blocker.code, blocker.boardId ?? '', blocker.columnId ?? '', blocker.tasks ?? 0].join(':'))
    .sort();
  const board = boardId === undefined ? undefined : view.boards.find(entry => entry.boardId === boardId);
  return [view.status, view.updates, view.conflicts, board?.state ?? '', board?.updates ?? 0, ...blockers].join('|');
}

/**
 * The board banner for available team changes or a review that is required. It leads
 * to Team Settings, and dismissing it acknowledges only the banner: no change is
 * applied, published, received, or discarded.
 */
export function TeamChangesBanner({ view, boardId, pending, dismissedSignature, onReview, onUpdate, onDismiss, onFocusBoard }: {
  view: HubSharingView | undefined;
  /** The active board, whose own update action the banner offers. */
  boardId?: string;
  pending?: boolean;
  /** The signature the user dismissed for this Hub, when one was recorded in this page session. */
  dismissedSignature?: string;
  onReview: () => void;
  onUpdate?: (boardId: string) => void;
  onDismiss: (signature: string) => void;
  onFocusBoard?: () => void;
}) {
  if (!view || view.status === 'preview' || view.status === 'not-published') return null;
  if (view.updates === 0 && view.conflicts === 0 && view.blockers.length === 0) return null;
  const board = boardId === undefined ? undefined : view.boards.find(entry => entry.boardId === boardId);
  const signature = teamBannerSignature(view, boardId);
  if (dismissedSignature === signature) return null;
  const boardReview = board?.state === 'needs-review';
  const boardUpdates = board?.state === 'updates-available';
  const message = boardReview || view.conflicts > 0
    ? 'Your team changed this board in a way that needs a choice.'
    : boardUpdates
      ? 'Your team published changes to this board.'
      : view.updates > 0
        ? 'Your team published changes to this Hub.'
        : view.blockers[0]?.message ?? 'Team changes cannot be applied until the blocking boards are resolved.';
  return <div className="kb-share-banner" role="status">
    <p>{message}</p>
    <div className="kb-actions">
      {boardUpdates && boardId !== undefined && onUpdate !== undefined
        ? <button type="button" className="kb-button kb-primary" disabled={pending === true} onClick={() => onUpdate(boardId)}>{pending === true ? 'Updating…' : 'Update board'}</button>
        : null}
      <button type="button" className="kb-button" onClick={onReview}>{boardReview || view.conflicts > 0 ? 'Review the choice' : 'Review team changes'}</button>
    </div>
    <DismissButton
      label="Dismiss team changes"
      hint="Dismiss"
      onDismiss={control => { onDismiss(signature); focusAfterDismissal([control], onFocusBoard); }}
    />
  </div>;
}
