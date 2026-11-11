import React from 'react';
import { NoticeRow } from './notices/notice-row.js';
import { focusAfterDismissal } from './notices/focus.js';
import type { BoardNotice } from './notices/model.js';

export interface DestructiveOperationsSectionProps {
  /** Running, queued, and failed operations; never dismissible. */
  operations: readonly BoardNotice[];
  /** Checkouts left on disk; each entry is dismissible on its own. */
  retained: readonly BoardNotice[];
  onDismiss: (notice: BoardNotice, control: HTMLButtonElement) => void;
  dismissAllRetained?: () => void;
  onFocusBoard?: () => void;
}

/**
 * One board section with two groups: the operations the user must resolve and the
 * checkouts a deletion left on disk, which the user may dismiss and forget.
 */
export function DestructiveOperationsSection({ operations, retained, onDismiss, dismissAllRetained, onFocusBoard }: DestructiveOperationsSectionProps) {
  if (operations.length === 0 && retained.length === 0) return null;
  return <section className="kb-destructive-notice" aria-label="Destructive operations" role="region">
    {operations.length > 0 && <div className="kb-notice-group">
      {operations.map(notice => <NoticeRow key={notice.id} notice={notice} role={notice.tone === 'failure' ? 'alert' : undefined} />)}
    </div>}
    {retained.length > 0 && <div className="kb-notice-group">
      <div className="kb-notice-group-header">
        <div>
          <strong>Checkouts left on disk</strong>
          <p className="kb-hint kb-notice-group-hint">Dismissing a notice does not delete the directory.</p>
        </div>
        {retained.length > 1 && dismissAllRetained !== undefined && <button
          type="button"
          className="kb-button"
          onClick={event => {
            // Every retained control is about to unmount; none of them may take focus.
            const removing = Array.from(event.currentTarget.closest('.kb-notice-group')?.querySelectorAll<HTMLButtonElement>('[data-kb-dismiss]') ?? []);
            dismissAllRetained();
            focusAfterDismissal(removing, onFocusBoard);
          }}
        >Dismiss all</button>}
      </div>
      {retained.map(notice => <NoticeRow key={notice.id} notice={notice} onDismiss={onDismiss} />)}
    </div>}
  </section>;
}
