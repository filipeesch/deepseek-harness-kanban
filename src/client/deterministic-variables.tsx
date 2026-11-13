import React, { useEffect, useState } from 'react';
import type { ClientApi, Problem, Task } from '../shared/types.js';
import type { DeterministicVariablesView } from '../shared/deterministic.js';
import { ErrorNotice, Modal, asProblem, useAction, type RunCommand } from './ui.js';

/** Keyed by project, stable stage, and variable: no write-only draft crosses scopes. */
function VariableValue({ taskId, projectId, stageIdentity, variable, run, onSaved }: { taskId: string; projectId: string; stageIdentity: string; variable: DeterministicVariablesView['variables'][number]; run: RunCommand; onSaved: () => void }) {
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

/**
 * Local values belong to one project and stable stage. They are configured here,
 * away from the executable-version review, so consent to code and credential
 * entry never share a dialog.
 */
export function LocalVariablesDialog({ task, projectName, api, run, onClose }: { task: Task; projectName: string; api: ClientApi; run: RunCommand; onClose: () => void }) {
  const [view, setView] = useState<DeterministicVariablesView | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [generation, refresh] = useState(0);
  const stageIdentity = task.stageEntry?.stageIdentity;
  useEffect(() => {
    let current = true;
    // A stage move changes the project/stage scope this dialog writes into; drop
    // the previous view before its names can be shown under the new scope.
    setView(null); setError(null);
    if (!api.deterministicVariables) { setError({ code: 'UPDATE_REQUIRED', message: 'Update DSH and Kanban to configure local variables.' }); return; }
    void api.deterministicVariables(task.id).then(value => { if (current) setView(value); }, failure => { if (current) setError(asProblem(failure)); });
    return () => { current = false; };
  }, [api, task.id, task.projectId, stageIdentity, generation]);
  return <Modal title="Local variables" onClose={onClose} size="wide">
    <div className="kb-form">
      <p className="kb-hint">Project: {projectName}. Stable stage: {stageIdentity ?? 'current stage (local association)'}. Values are write-only and never enter shared YAML. Other projects and stages do not inherit them.</p>
      <ErrorNotice problem={error} />
      {!view && !error && <p role="status">Loading local variables…</p>}
      {view && (view.variables.length === 0 ? <p className="kb-hint">This script requests no variables.</p> : view.variables.map(variable => stageIdentity
        ? <VariableValue key={task.projectId + ':' + stageIdentity + ':' + variable.name} taskId={task.id} projectId={task.projectId} stageIdentity={stageIdentity} variable={variable} run={run} onSaved={() => refresh(value => value + 1)} />
        : <p key={variable.name} className="kb-hint">{variable.name}: move the task into this stage to bind its stable identity before saving values.</p>))}
      <div className="kb-actions"><button type="button" className="kb-button" onClick={onClose}>Close</button></div>
    </div>
  </Modal>;
}
