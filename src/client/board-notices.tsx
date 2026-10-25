import React, { type ReactNode } from 'react';
import type { Problem } from '../shared/types.js';
import { ErrorNotice } from './ui.js';

export interface BoardNoticesProps {
  loadError: Problem | null;
  actionError: Problem | null;
  onRetryLoad: () => void;
}

/** Board-level failures stay above the board body; the slot renders nothing while idle. */
export function BoardNotices({ loadError, actionError, onRetryLoad }: BoardNoticesProps): ReactNode {
  if (!loadError && !actionError) return null;
  return <>
    <ErrorNotice problem={loadError} />
    {loadError && <button type="button" className="kb-button" onClick={onRetryLoad}>Retry loading board</button>}
    <ErrorNotice problem={actionError} />
  </>;
}
