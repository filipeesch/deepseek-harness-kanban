import React, { useEffect, useState } from 'react';
import type { ClientApi, Problem } from '../shared/types.js';
import type { DeterministicStageReview } from '../shared/deterministic.js';
import { ErrorNotice, Modal, asProblem, useAction, type RunCommand } from './ui.js';
import { CodeView } from './code-view.js';

export interface ScriptReviewRequest { boardId: string; stageId: string; taskId?: string }

/**
 * One stage-scoped executable version. The dialog is served by the board-level
 * provider, so a card, the queue, and the stage editor share the same review.
 */
export function ScriptReviewDialog({ request, api, run, onClose }: {
  request: ScriptReviewRequest;
  api: ClientApi;
  run: RunCommand;
  onClose: () => void;
}) {
  const [review, setReview] = useState<DeterministicStageReview | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const action = useAction(run);
  useEffect(() => {
    let current = true;
    setReview(null); setError(null);
    if (!api.deterministicReview) { setError({ code: 'UPDATE_REQUIRED', message: 'Update DSH and Kanban to review captured programs securely.' }); return; }
    void api.deterministicReview({ boardId: request.boardId, stageId: request.stageId, ...(request.taskId === undefined ? {} : { taskId: request.taskId }) })
      .then(value => { if (current) setReview(value); }, failure => { if (current) setError(asProblem(failure)); });
    return () => { current = false; };
  }, [api, request.boardId, request.stageId, request.taskId]);
  const canApprove = review?.approval === 'required';
  return <Modal title="Review deterministic script" onClose={onClose} busy={action.pending} size="wide">
    <div className="kb-form kb-script-review">
      <ErrorNotice problem={error} />
      {!review && !error && <p role="status">Loading exact captured program…</p>}
      {review && <>
        <dl className="kb-script-facts">
          <dt>Stage</dt><dd>{review.stage.name}</dd>
          <dt>{review.version.captured ? 'Captured version' : 'Saved version'}</dt><dd><code>{review.version.fingerprint}</code></dd>
          <dt>Language / format</dt><dd>{review.language === 'typescript' ? 'TypeScript async function body (top-level await / return)' : 'Standalone Bash (one JSON completion on stdout)'}</dd>
          <dt>Canonical source</dt><dd>{review.source.kind === 'file' ? review.source.reference ?? 'External file' : 'Inline code'}</dd>
          <dt>Directory scope</dt><dd>{review.directory === 'project' ? 'Base project' : 'Task'}</dd>
          {review.captured && <><dt>Execution directory</dt><dd>{review.captured.executionDirectory}</dd></>}
          <dt>Authorized variables</dt><dd>{review.env.join(', ') || 'None'}</dd>
          <dt>Required parameters</dt><dd>{review.params.map(parameter => parameter.name + (parameter.description === undefined ? '' : ' — ' + parameter.description)).join('; ') || 'None'}</dd>
          <dt>Named exits</dt><dd>{Object.entries(review.exits).map(([name, to]) => name + ' → ' + to).join('; ') || 'None'}</dd>
        </dl>
        {review.version.directoryDependent && <p className="kb-hint" role="status">This source is read from each execution directory, so a version resolved from another directory may need its own approval.{review.version.representative === undefined ? '' : ' Resolved in ' + review.version.representative.projectName + ' (' + review.version.representative.directory + ').'}</p>}
        <p className="kb-hint">{review.version.captured ? 'This is the exact captured primary program, not a live read of the source file.' : 'This is the stored version resolved from the authored stage; it has not captured an execution yet.'}</p>
        <CodeView code={review.code} language={review.language} label="Exact captured code" className="kb-script-source" />
        <p className="kb-hint">Approval is local to this board and stable stage. It applies to every project the board allows and to future cards that resolve this same version. Saving, accepting, or publishing YAML does not approve execution. Imported modules and called executables are not frozen; approving this primary source does not freeze dependencies or bypass native permissions. Code can transform or disclose secrets; redaction is not a complete data-loss-prevention boundary.</p>
        {(review.waitingCards ?? 0) > 0 && <p className="kb-hint kb-script-consequence" role="status">Approving starts {(review.waitingCards ?? 0) === 1 ? 'this waiting card' : (review.waitingCards ?? 0) + ' waiting cards'} for this version.</p>}
        {review.captured && <p className="kb-hint">Local variables stay project-scoped. Configure them from the task's script panel; this review does not show their values.</p>}
      </>}
      <ErrorNotice problem={action.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={action.pending} onClick={onClose}>Close without approval</button>
        {canApprove && <button type="button" className="kb-button kb-primary" disabled={action.pending} onClick={async () => {
          if (review && await action.execute({ type: 'board.deterministicApprove', boardId: review.stage.boardId, stageId: review.stage.stageId, fingerprint: review.version.fingerprint, stageGeneration: review.version.stageGeneration, ...(request.taskId === undefined ? {} : { taskId: request.taskId }) })) onClose();
        }}>{action.pending ? 'Approving…' : review.version.captured ? 'Approve and run' : 'Approve this version'}</button>}
      </div>
    </div>
  </Modal>;
}
