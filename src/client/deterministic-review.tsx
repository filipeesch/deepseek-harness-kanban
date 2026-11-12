import React, { useEffect, useState } from 'react';
import type { ClientApi, Column, Task } from '../shared/types.js';
import type { DeterministicReview, DeterministicSummary } from '../shared/deterministic.js';
import { ErrorNotice, Modal, asProblem, useAction, type RunCommand } from './ui.js';
import { ScriptVariables } from './deterministic-variables.js';

/** Source is fetched only on explicit review and discarded when this dialog closes. */
export function ScriptReviewDialog({ task, projectName, column, summary, api, run, onClose }: {
  task: Task; projectName: string; column?: Column; summary?: DeterministicSummary; api: ClientApi; run: RunCommand; onClose: () => void;
}) {
  const [review, setReview] = useState<DeterministicReview | null>(null);
  const [error, setError] = useState<ReturnType<typeof asProblem> | null>(null);
  const [generation, refresh] = useState(0);
  const action = useAction(run);
  const scope = task.projectId + ':' + (task.stageEntry?.stageIdentity ?? task.columnId);
  useEffect(() => {
    let current = true; setReview(null); setError(null);
    if (!api.deterministicReview) { setError({ code: 'UPDATE_REQUIRED', message: 'Update DSH and Kanban to review captured programs securely.' }); return; }
    void api.deterministicReview(task.id).then(value => { if (current) setReview(value); }, failure => { if (current) setError(asProblem(failure)); });
    return () => { current = false; };
  }, [api, task.id, scope, summary?.executionId, summary?.fingerprint, generation]);
  const current = review !== null && review.executionId === summary?.executionId && (summary.fingerprint === undefined || review.fingerprint === summary.fingerprint);
  const canApprove = current && summary?.phase === 'awaiting-trust';
  return <Modal title="Review deterministic script" onClose={onClose} busy={action.pending} size="wide">
    <div className="kb-form kb-script-review">
      <p>Project: <strong>{projectName}</strong> · Stage: <strong>{column?.name ?? task.columnId}</strong></p>
      <ErrorNotice problem={error} />
      {!review && !error && <p role="status">Loading exact captured program…</p>}
      {review && <>
        <dl className="kb-script-facts"><dt>{review.executionId === 'preview' ? 'Saved preview version' : 'Captured version'}</dt><dd><code>{review.fingerprint}</code></dd><dt>Language / format</dt><dd>{review.language === 'typescript' ? 'TypeScript async function body (top-level await / return)' : 'Standalone Bash (one JSON completion on stdout)'}</dd><dt>Canonical source</dt><dd>{review.source?.kind === 'file' ? review.source.path : 'Inline code'}</dd><dt>Directory scope</dt><dd>{review.directory === 'project' ? 'Base project' : 'Task'}: {review.executionDirectory ?? 'Not available'}</dd><dt>Authorized variables</dt><dd>{review.env.join(', ') || 'None'}</dd><dt>Required parameters</dt><dd>{review.params.map(parameter => parameter.name + (parameter.description === undefined ? '' : ' — ' + parameter.description)).join('; ') || 'None'}</dd><dt>Captured exits</dt><dd>{Object.entries(review.exits).map(([name, to]) => name + ' → ' + to).join('; ') || 'None'}</dd></dl>
        <p className="kb-hint">{review.executionId === 'preview' ? 'Saved program preview only. No execution or trust is created by this review.' : summary?.savedVersionChanged ? 'Saved configuration differs. This review authorizes only the captured version below; Play captures the saved version separately.' : 'This is the exact captured primary program, not a live read of the source file.'}</p>
        <pre className="kb-script-source" tabIndex={0} aria-label="Exact captured code"><code>{review.code}</code></pre>
        <p className="kb-hint">Approval is local to this project and stable stage. Saving, accepting, or publishing YAML does not approve execution. Imported modules and called executables are not frozen; approving this primary source does not freeze dependencies or bypass native permissions. Code can transform or disclose secrets; redaction is not a complete data-loss-prevention boundary.</p>
        {summary?.savedVersionChanged && <details><summary>Saved capability differences</summary><p className="kb-hint">Captured capabilities above remain authoritative. Saved language: {column?.deterministic?.language ?? 'not deterministic'}; directory: {column?.deterministic?.directory ?? 'none'}; source: {column?.deterministic?.file ?? (column?.deterministic ? 'inline' : 'none')}; variable names: {column?.deterministic?.env?.join(', ') || 'none'}; exits: {Object.entries(column?.deterministic?.exits ?? {}).map(([name, to]) => name + ' → ' + to).join('; ') || 'none'}. Primary source changes are included in the version even when these capabilities are unchanged.</p></details>}
        <ScriptVariables key={scope} task={task} projectName={projectName} review={review} run={run} onSaved={() => refresh(value => value + 1)} />
        {!current && review.executionId !== 'preview' && <p className="kb-hint" role="status">The execution changed. Close and review the current execution before approving.</p>}
        {review.variables.some(variable => !variable.configured) && <p className="kb-hint">Approval does not configure variables. Set every missing variable under Local variables before the script can start.</p>}
      </>}
      <ErrorNotice problem={action.error} />
      <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={onClose}>Close without approval</button>{canApprove && <button type="button" className="kb-button kb-primary" disabled={action.pending} onClick={async () => { if (review && await action.execute({ type: 'task.deterministicApprove', taskId: task.id, executionId: review.executionId, fingerprint: review.fingerprint })) onClose(); }}>{action.pending ? 'Approving…' : 'Approve this captured version'}</button>}</div>
    </div>
  </Modal>;
}
