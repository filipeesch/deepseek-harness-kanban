import React from 'react';
import type { ScriptedStageReview } from '../../shared/scripted.js';

/**
 * The Approval tab: the stored executable version, where its approval came from, and
 * the one action that authorizes it.
 *
 * A version the author saved as an inline program is already approved, so this tab
 * presents it without offering a second approval of the same bytes.
 */
export function ApprovalSection({ review, reviewError, checked, changed, pending, storedHasProgram, onApprove }: {
  readonly review: ScriptedStageReview | null;
  readonly reviewError: string | null;
  readonly checked: boolean;
  /** False when the stored stage authors no program yet, so there is no version to read. */
  readonly storedHasProgram: boolean;
  /** True while the draft differs from the stored stage. */
  readonly changed: boolean;
  readonly pending: boolean;
  readonly onApprove: () => void;
}) {
  if (!storedHasProgram) return <fieldset className="kb-fieldset">
    <legend>Stored version</legend>
    <p className="kb-hint" role="status">This stage stores no program yet. Save it as a scripted step to review and authorize its version.</p>
  </fieldset>;
  const state = review === null
    ? (checked ? 'unavailable' : 'checking…')
    : review.approval === 'approved' ? 'approved' : 'not approved';
  const origin = review?.approvalOrigin === 'author-save' ? 'saved in this editor by you' : review?.approvalOrigin === 'review' ? 'after an explicit review' : undefined;
  return <fieldset className="kb-fieldset">
    <legend>Stored version</legend>
    <p className="kb-stage-approval-state" role="status">Stored script version: <strong>{state}</strong>{origin === undefined ? '' : ' — ' + origin}{review?.approvalAt === undefined ? '' : ' on ' + review.approvalAt}.</p>
    {review !== null && <dl className="kb-details kb-stage-approval-facts">
      <dt>Version</dt><dd><code>{review.version.fingerprint.slice(0, 16)}</code></dd>
      <dt>Cards waiting</dt><dd>{review.waitingCards === undefined ? 'Not reported for this version.' : review.waitingCards === 0 ? 'None. The next card to enter starts once this version is approved.' : review.waitingCards + (review.waitingCards === 1 ? ' card waits for this version.' : ' cards wait for this version.')}</dd>
    </dl>}
    {review === null && checked && <p className="kb-hint kb-problem" role="alert">The stored version could not be read here{reviewError === null ? '.' : ': ' + reviewError}</p>}
    {review?.version.directoryDependent === true && <p className="kb-hint">The primary source is read from each execution directory, so a version resolved elsewhere may need its own approval.{review.version.representative === undefined ? '' : ' Resolved in ' + review.version.representative.projectName + ' (' + review.version.representative.directory + ').'}</p>}
    {changed && <p className="kb-hint" id="kb-approval-draft">The draft is not the stored version. Saving an inline program authorizes it; an external file source still needs a review.</p>}
    <p className="kb-hint">A version you save from this editor is authorized by that save. A version written by a tool, received with a shared workflow, or restored from an earlier revision waits for a review.</p>
    {review !== null && review.approval === 'required' && <button type="button" className="kb-button kb-primary" disabled={pending || changed} aria-describedby={changed ? 'kb-approval-draft' : undefined} onClick={onApprove}>Review and approve script</button>}
  </fieldset>;
}
