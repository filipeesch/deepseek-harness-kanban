import React from 'react';
import type { HubSharingView } from '../../shared/types.js';
import { boardSharing } from '../sharing/status.js';
import { DismissButton } from './dismiss-button.js';
import { focusAfterDismissal } from './focus.js';

/**
 * A stable description of the Hub's pending publishing state. A different value means
 * something new is pending, which re-presents a dismissed banner.
 */
export function teamBannerSignature(view: HubSharingView, boardId?: string): string {
  const blockers = [...view.blockers]
    .map(blocker => [blocker.code, blocker.boardId ?? '', blocker.columnId ?? '', blocker.tasks ?? 0].join(':'))
    .sort();
  const board = boardId === undefined ? undefined : boardSharing(view, boardId);
  return [view.status, view.drafts, view.updates, view.conflicts, board?.state ?? '', board?.draft ?? false, board?.updates ?? 0, board?.detail?.changes.length ?? 0, ...blockers].join('|');
}

/**
 * The board banner for the active board's publishing state: changes to publish, team
 * changes to get, or a review that is required. It leads to Team Settings, and
 * dismissing it acknowledges only the banner.
 */
export function TeamChangesBanner({ view, boardId, pending, dismissedSignature, onPublish, onUpdate, onReview, onDismiss, onFocusBoard }: {
  view: HubSharingView | undefined;
  /** The active board, whose own action the banner offers. */
  boardId?: string;
  pending?: boolean;
  /** The signature the user dismissed for this Hub, when one was recorded in this page session. */
  dismissedSignature?: string;
  onReview: () => void;
  onPublish?: (boardId: string) => void;
  onUpdate?: (boardId: string) => void;
  onDismiss: (signature: string) => void;
  onFocusBoard?: () => void;
}) {
  if (!view || view.status === 'preview' || view.status === 'not-published') return null;
  const pendingWork = view.drafts + view.updates + view.conflicts + view.blockers.length;
  if (pendingWork === 0) return null;
  const board = boardId === undefined ? undefined : boardSharing(view, boardId);
  const signature = teamBannerSignature(view, boardId);
  if (dismissedSignature === signature) return null;
  const boardReview = board?.state === 'needs-review';
  const updateRequired = board?.state === 'update-required';
  const boardUpdates = board?.state === 'updates-available';
  const boardDraft = board?.state === 'draft';
  // Naming the board matters as soon as more than one is published, because the
  // banner speaks for the active tab.
  const named = view.boards.filter(entry => entry.bound).length > 1 && board !== undefined ? ' “' + board.name + '”' : '';
  const message = updateRequired
    ? 'This team board was written by a newer plugin version. Update dsh-kanban, then refresh' + named + '.'
    : boardReview
      ? 'Your team changed this board' + named + ' in a way that needs a choice.'
      : boardUpdates
        ? 'Your team published changes to this board' + named + '.'
        : boardDraft
          ? 'You have changes to send for this board' + named + '.'
          : view.drafts > 0
            ? 'You have changes to send.'
            : view.updates > 0
              ? 'Your team published changes to this Hub.'
              : view.conflicts > 0
                ? 'Some team boards require attention.'
                : view.blockers[0]?.message ?? 'Team changes cannot be applied until the blocking boards are resolved.';
  const primary = boardDraft && boardId !== undefined && onPublish !== undefined
    ? { label: 'Publish board', run: () => onPublish(boardId) }
    : boardUpdates && boardId !== undefined && onUpdate !== undefined
      ? { label: 'Get updates', run: () => onUpdate(boardId) }
      : null;
  return <div className="kb-share-banner" role="status">
    <p>{message}</p>
    <div className="kb-actions">
      {primary !== null && <button type="button" className="kb-button kb-primary" disabled={pending === true} onClick={primary.run}>{pending === true ? 'Working…' : primary.label}</button>}
      <button type="button" className="kb-button" onClick={onReview}>{updateRequired ? 'Team settings' : boardReview || boardDraft ? 'Review changes' : 'Review team changes'}</button>
    </div>
    <DismissButton
      label="Dismiss team changes"
      hint="Dismiss"
      onDismiss={control => { onDismiss(signature); focusAfterDismissal([control], onFocusBoard); }}
    />
  </div>;
}
