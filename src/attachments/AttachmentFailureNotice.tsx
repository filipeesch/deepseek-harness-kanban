import React from 'react';

/**
 * The compact notice a failed selection leaves above a surface's actions, with the
 * two ways out: retry the same files, or discard the selection and proceed without it.
 */
export function AttachmentFailureNotice({ failed, message, disabled = false, onRetry, onDiscard }: {
  /** How many selections currently block the surface. */
  failed: number;
  /** The actionable reason the first failed selection reported. */
  message: string;
  disabled?: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (failed === 0) return null;
  return <div className="ka-failure" role="alert">
    <p>{failed === 1 ? message : failed + ' selected files could not be attached. ' + message}</p>
    <div className="ka-failure-actions">
      <button type="button" className="kq-secondary" disabled={disabled} onClick={onRetry}>Try again</button>
      <button type="button" className="kq-secondary" disabled={disabled} onClick={onDiscard}>Discard failed files</button>
    </div>
  </div>;
}
