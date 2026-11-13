import React from 'react';
import type { DeterministicHold } from '../shared/deterministic.js';
import type { Task } from '../shared/types.js';
import { holdDetail, holdJobs, holdLabel, holdNextStep } from './deterministic-view.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';

/**
 * The drawer's explanation of a held saved result, placed above the section content
 * so the reason and its action are readable before any section is opened.
 */
export function DeterministicHoldNotice({ task, hold, run }: { task: Task; hold: DeterministicHold; run: RunCommand }) {
  const action = useAction(run);
  const facts = holdDetail(hold);
  const jobs = holdJobs(hold);
  return <div className="kb-hold" role="status" aria-label="Saved result delivery held" data-hold-code={hold.code}>
    <div className="kb-hold-heading"><strong>Saved result is waiting to be delivered</strong></div>
    <p className="kb-hold-reason">{holdLabel(hold)}</p>
    {facts.length > 0 && <ul className="kb-hold-facts">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
    <p className="kb-hint">{holdNextStep(hold)}</p>
    {jobs.length > 0 && <div className="kb-hold-actions">{jobs.map(job => <button key={job.id} type="button" className="kb-button"
      aria-label={'Cancel job ' + job.id} title={'Cancel ' + job.label} aria-busy={action.pending || undefined} disabled={action.pending}
      onClick={() => void action.execute({ type: 'task.deterministicCancelJob', taskId: task.id, jobId: job.id })}>{action.pending ? '…' : 'Cancel job'}</button>)}</div>}
    <ErrorNotice problem={action.error} />
  </div>;
}
