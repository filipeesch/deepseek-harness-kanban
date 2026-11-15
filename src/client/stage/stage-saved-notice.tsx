import React from 'react';
import { Modal } from '../ui.js';
import type { ScriptedStageReview } from '../../shared/scripted.js';

/**
 * The state a save leaves behind when the stored version still waits for review.
 *
 * Editing the still-open draft would target the revision and identifier captured
 * when the editor opened, so this notice offers only what is safe next: review the
 * stored version, or close. A review that already reports the version as approved —
 * because another surface approved the same fingerprint while the save was in
 * flight — closes the editor instead of asking for a second decision.
 */
export function StageSavedNotice({ name, review, reviewError, pending, onClose, onApprove }: {
  readonly name: string;
  readonly review: ScriptedStageReview | null;
  readonly reviewError: string | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onApprove: () => void;
}) {
  const approved = review?.approval === 'approved';
  return <Modal title="Stage saved" onClose={onClose} size="wide">
    <div className="kb-form">
      <p>“{name}” was saved, but its program still needs one decision.</p>
      {approved
        ? <p className="kb-hint" role="status">This executable version is approved. Cards that enter the stage can start.</p>
        : <p className="kb-hint" role="status">This executable version still waits for review. Cards that enter the stage will wait for it.</p>}
      {!approved && review?.version.directoryDependent === true && <p className="kb-hint">The primary source is read from each execution directory, so a version resolved elsewhere may need its own approval.{review.version.representative === undefined ? '' : ' Resolved in ' + review.version.representative.projectName + ' (' + review.version.representative.directory + ').'}</p>}
      {review === null && <p className="kb-hint kb-problem" role="alert">The stored version could not be read here{reviewError === null ? '.' : ': ' + reviewError} Close and reopen the stage to review it.</p>}
      <div className="kb-actions">
        <button type="button" className="kb-button" onClick={onClose}>Close</button>
        {review !== null && !approved && <button type="button" className="kb-button kb-primary" disabled={pending} onClick={onApprove}>Review and approve script</button>}
      </div>
    </div>
  </Modal>;
}
