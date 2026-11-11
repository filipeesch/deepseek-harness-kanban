import React from 'react';
import type { Problem } from '../../shared/types.js';
import { BoardErrorNotice } from '../notices/board-error-notice.js';
import { NoticeRow } from '../notices/notice-row.js';
import { focusAfterDismissal } from '../notices/focus.js';
import { DestructiveOperationsSection } from '../destructive-notices.js';
import type { BoardNotice } from '../notices/model.js';

export interface NoticeStackProps {
  loadError: Problem | null;
  onRetryLoad: () => void;
  notices: readonly BoardNotice[];
  dismissAllRetained?: () => void;
  /** Receives focus when a dismissal leaves no dismissible notice on the board. */
  onFocusBoard?: () => void;
}

/**
 * Every status surface between the header and the board body. The load failure keeps
 * its retry and is never dismissible; the command failure, relocations, operations,
 * and retained checkouts arrive already composed as notices.
 */
export function NoticeStack({ loadError, onRetryLoad, notices, dismissAllRetained, onFocusBoard }: NoticeStackProps) {
  const failure = notices.filter(notice => notice.group === 'failure');
  const relocation = notices.filter(notice => notice.group === 'relocation');
  const operations = notices.filter(notice => notice.group === 'operations');
  const retained = notices.filter(notice => notice.group === 'retained');
  // A dismissal already ran the notice's own action; this only hands focus on.
  const handOffFocus = (_notice: BoardNotice, control: HTMLButtonElement): void => focusAfterDismissal([control], onFocusBoard);
  return <>
    <BoardErrorNotice problem={loadError} onRetry={onRetryLoad} />
    {failure.length > 0 && <section className="kb-notice-failures" aria-label="Board failure">
      {failure.map(notice => <NoticeRow key={notice.id} notice={notice} role="alert" onDismiss={handOffFocus} />)}
    </section>}
    {relocation.length > 0 && <section className="kb-destructive-notice" aria-label="Project relocation" role="region">
      {relocation.map(notice => <NoticeRow key={notice.id} notice={notice} />)}
    </section>}
    <DestructiveOperationsSection
      operations={operations}
      retained={retained}
      onDismiss={handOffFocus}
      {...(dismissAllRetained === undefined ? {} : { dismissAllRetained })}
      {...(onFocusBoard === undefined ? {} : { onFocusBoard })}
    />
  </>;
}
