import React, { useState } from 'react';
import type { Column, Task } from '../shared/types.js';
import type { DeterministicSummary } from '../shared/deterministic.js';
import { ErrorNotice, Modal, useAction, type RunCommand } from './ui.js';

/**
 * Entry-bound parameter repair. The dialog edits only the current entry's values:
 * saving never grants trust, starts code, or writes the authored declaration.
 */
export function ScriptParametersDialog({ task, column, summary, run, onClose }: {
  task: Task; column: Column | undefined; summary: DeterministicSummary; run: RunCommand; onClose: () => void;
}) {
  const declared = column?.deterministic?.params ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(declared.map(parameter => [parameter.name, summary.parameters?.[parameter.name] ?? ''])));
  const action = useAction(run);
  const missing = declared.filter(parameter => (values[parameter.name] ?? '').trim().length === 0);
  return <Modal title="Edit script parameters" onClose={onClose} busy={action.pending} initialFocus="target">
    <div className="kb-form">
      <p className="kb-hint">Values apply to this stage entry only. Saving does not start the script; press Play afterwards. These values are task data, not secrets.</p>
      {declared.map((parameter, index) => <label className="kb-field" key={parameter.name}>{parameter.name}
        {parameter.description !== undefined && <span className="kb-hint">{parameter.description}</span>}
        <input className="kb-input" aria-label={'Parameter ' + parameter.name} aria-required="true" required value={values[parameter.name] ?? ''} {...(index === 0 ? { 'data-kb-initial-focus': '' } : {})} onChange={event => setValues(current => ({ ...current, [parameter.name]: event.target.value }))} />
      </label>)}
      {missing.length > 0 && <p className="kb-hint" role="status">Every declared parameter is required.</p>}
      <ErrorNotice problem={action.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={action.pending} onClick={onClose}>Cancel</button>
        <button type="button" className="kb-button kb-primary" disabled={action.pending || missing.length > 0} onClick={async () => { if (await action.execute({ type: 'task.deterministicParameters', taskId: task.id, entryId: summary.entryId, values })) onClose(); }}>{action.pending ? 'Saving…' : 'Save values'}</button>
      </div>
    </div>
  </Modal>;
}
