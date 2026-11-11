import type { Problem } from '../../shared/types.js';
import { ErrorNotice } from '../ui.js';
import React from 'react';

/**
 * A board load failure keeps its retry action and is never dismissible: hiding it
 * would leave an empty board with no action that could bring it back.
 */
export function BoardErrorNotice({ problem, onRetry }: { problem: Problem | null; onRetry: () => void }) {
  if (!problem) return null;
  return <>
    <ErrorNotice problem={problem} />
    <button type="button" className="kb-button" onClick={onRetry}>Retry loading board</button>
  </>;
}
