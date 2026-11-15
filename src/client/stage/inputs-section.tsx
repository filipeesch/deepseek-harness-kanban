import React from 'react';
import { ProblemNotice } from './problem-notice.js';
import type { StageProblem } from './stage-problem.js';
import type { ScriptedDraft } from './scripted-draft.js';

/** The Inputs tab: what the program receives and what it may read from outside. */
export function InputsSection({ draft, problem, disabled, onChange }: {
  readonly draft: ScriptedDraft;
  readonly problem: (field: StageProblem['field']) => string | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: ScriptedDraft) => void;
}) {
  const field = <K extends keyof ScriptedDraft>(key: K, value: ScriptedDraft[K]) => onChange({ ...draft, [key]: value });
  return <>
    <fieldset className="kb-fieldset" disabled={disabled}>
      <legend>Required parameters</legend>
      {draft.params.length > 0 && <div className="kb-script-route kb-script-route-head" aria-hidden="true"><span>Name</span><span>Description</span><span /></div>}
      {draft.params.map((parameter, index) => <div className="kb-script-route" key={index}>
        <input className="kb-input" aria-label={'Parameter name ' + (index + 1)} placeholder="pipeline" value={parameter.name} onChange={event => field('params', draft.params.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
        <input className="kb-input" aria-label={'Parameter description ' + (index + 1)} placeholder="Optional description for the origin stage" value={parameter.description} onChange={event => field('params', draft.params.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
        <button type="button" className="kb-button" aria-label={'Remove parameter ' + (index + 1)} onClick={() => field('params', draft.params.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      <button type="button" className="kb-button" onClick={() => field('params', [...draft.params, { name: '', description: '' }])}>Add parameter</button>
      <ProblemNotice message={problem('params')} />
      <p className="kb-hint">Every declared name is required. A value comes from the transition that creates the entry, or from the card's parameter editor; values are never stored in workflow text.</p>
    </fieldset>
    <fieldset className="kb-fieldset" disabled={disabled}>
      <legend>Authorized variables</legend>
      <label className="kb-field">Variable names<input className="kb-input" aria-label="Authorized variable names" placeholder="CI_TOKEN, REVIEW_TOKEN" value={draft.env} onChange={event => field('env', event.target.value)} /></label>
      <ProblemNotice message={problem('env')} />
      <p className="kb-hint">Names only. Configure local values for each task project and stable stage in the task's script settings.</p>
    </fieldset>
  </>;
}
