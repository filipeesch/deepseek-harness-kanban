import React from 'react';
import type { SharingChangeSummary } from '../../../shared/types.js';
import { describeChange } from '../../sharing/status.js';

/** The changes a publish would send, or that the team sent, in product vocabulary. */
export function ChangeList({ changes, label }: { changes: readonly SharingChangeSummary[]; label: string }) {
  if (changes.length === 0) return null;
  return <div className="kb-share-diff">
    <p className="kb-share-board-state">{changes.length} {changes.length === 1 ? 'change' : 'changes'}</p>
    <ul className="kb-share-diff-list" aria-label={label}>
      {changes.map((change, index) => <li key={change.kind + ':' + index}>{describeChange(change)}</li>)}
    </ul>
  </div>;
}
