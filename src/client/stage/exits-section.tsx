import React from 'react';
import type { Column } from '../../shared/types.js';
import { ProblemNotice } from './problem-notice.js';
import { EXIT_HELP, type ScriptedDraft } from './scripted-draft.js';
import type { StageProblem } from './stage-problem.js';

/** The Routing tab of a stage that authors a program: its named exits and their destinations. */
export function ExitsSection({ draft, choices, problem, disabled, onChange }: {
  readonly draft: ScriptedDraft;
  readonly choices: readonly Column[];
  readonly problem: (field: StageProblem['field']) => string | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: ScriptedDraft) => void;
}) {
  const field = <K extends keyof ScriptedDraft>(key: K, value: ScriptedDraft[K]) => onChange({ ...draft, [key]: value });
  return <fieldset className="kb-fieldset" disabled={disabled}>
    <legend>Named exits</legend>
    {draft.exits.map((route, index) => <div className="kb-script-route" key={index}>
      <input className="kb-input" aria-label={'Exit name ' + (index + 1)} placeholder="passed" value={route.name} onChange={event => field('exits', draft.exits.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      <select className="kb-input" aria-label={'Exit destination ' + (index + 1)} value={route.to} onChange={event => field('exits', draft.exits.map((item, i) => i === index ? { ...item, to: event.target.value } : item))}><option value="">Choose destination</option>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
      <button type="button" className="kb-button" aria-label={'Remove exit ' + (index + 1)} onClick={() => field('exits', draft.exits.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <button type="button" className="kb-button" onClick={() => field('exits', [...draft.exits, { name: '', to: '' }])}>Add exit</button>
    <ProblemNotice message={problem('exits')} />
    <p className="kb-hint">{EXIT_HELP}</p>
  </fieldset>;
}
