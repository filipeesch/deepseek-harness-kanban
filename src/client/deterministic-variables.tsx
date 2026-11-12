import React, { useState } from 'react';
import type { Task } from '../shared/types.js';
import type { DeterministicReview } from '../shared/deterministic.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';

/** Keyed by project, stable stage, and variable: no write-only draft crosses scopes. */
function VariableValue({ taskId, projectId, stageIdentity, variable, run, onSaved }: { taskId: string; projectId: string; stageIdentity: string; variable: DeterministicReview['variables'][number]; run: RunCommand; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const action = useAction(run);
  async function save(remove: boolean) {
    // The reviewed project and stable stage travel with the command, so a delayed
    // save can never land in another scope.
    const result = await action.execute({ type: 'task.deterministicVariable', taskId, projectId, stageIdentity, name: variable.name, ...(remove ? {} : { value }) });
    setValue('');
    if (result !== null) onSaved();
  }
  return <fieldset className="kb-fieldset" disabled={action.pending}>
    <legend>{variable.name} — {variable.configured ? 'Configured' : 'Missing'}</legend>
    <label className="kb-field">Replacement value<input className="kb-input" type="password" autoComplete="new-password" aria-label={'Replacement value for ' + variable.name} value={value} onChange={event => setValue(event.target.value)} /></label>
    <div className="kb-actions"><button type="button" className="kb-button" disabled={!value || action.pending} onClick={() => void save(false)}>{action.pending ? 'Saving…' : 'Replace value'}</button><button type="button" className="kb-button" disabled={!variable.configured || action.pending} onClick={() => void save(true)}>Remove value</button></div>
    <ErrorNotice problem={action.error} />
  </fieldset>;
}
export function ScriptVariables({ task, projectName, review, run, onSaved }: { task: Task; projectName: string; review: DeterministicReview; run: RunCommand; onSaved: () => void }) {
  const stageIdentity = task.stageEntry?.stageIdentity;
  const scope = task.projectId + ':' + (stageIdentity ?? task.columnId);
  return <section aria-label="Local script variables">
    <h3>Local variables</h3><p className="kb-hint">Project: {projectName}. Stable stage: {stageIdentity ?? 'current stage (local association)'}. Values are write-only and never enter shared YAML. Other projects and stages do not inherit them.</p>
    {!stageIdentity && <p className="kb-hint">Move the task into this stage to bind its stable identity before saving values.</p>}
    {review.variables.length === 0 ? <p className="kb-hint">This captured program requests no variables.</p> : review.variables.map(variable => stageIdentity ? <VariableValue key={scope + ':' + variable.name} taskId={task.id} projectId={task.projectId} stageIdentity={stageIdentity} variable={variable} run={run} onSaved={onSaved} /> : null)}
  </section>;
}
