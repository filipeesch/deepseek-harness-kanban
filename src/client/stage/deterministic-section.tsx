import React from 'react';
import type { Column } from '../../shared/types.js';
import type { DeterministicDraft, DeterministicField } from './deterministic-draft.js';

/** Authored capabilities only. Credential values never belong in this draft. */
export function DeterministicSection({ draft, choices, disabled, problem, onChange }: {
  draft: DeterministicDraft; choices: readonly Column[]; disabled: boolean;
  problem: (field: DeterministicField) => string | undefined; onChange: (draft: DeterministicDraft) => void;
}) {
  const field = <K extends keyof DeterministicDraft>(key: K, value: DeterministicDraft[K]) => onChange({ ...draft, [key]: value });
  const issue = (key: DeterministicField) => problem(key) && <p className="kb-hint kb-problem" role="alert">{problem(key)}</p>;
  return <fieldset className="kb-fieldset" disabled={disabled}>
    <legend>Deterministic program</legend>
    <label className="kb-field">Language<select className="kb-input" aria-label="Script language" value={draft.language} onChange={event => field('language', event.target.value as DeterministicDraft['language'])}><option value="bash">Bash</option><option value="typescript">TypeScript</option></select></label>
    <label className="kb-field">Program source<select className="kb-input" aria-label="Program source" value={draft.source} onChange={event => field('source', event.target.value as DeterministicDraft['source'])}><option value="inline">Inline code</option><option value="file">External file</option></select></label>
    {draft.source === 'inline' ? <label className="kb-field">Inline code<textarea className="kb-input kb-script-code" aria-label="Inline code" spellCheck={false} rows={8} value={draft.code} onChange={event => field('code', event.target.value)} /></label> : <label className="kb-field">Script file<input className="kb-input" aria-label="Script file" value={draft.file} onChange={event => field('file', event.target.value)} /></label>}
    {issue('source')}
    <label className="kb-field">Execution directory<select className="kb-input" aria-label="Execution directory" value={draft.directory} onChange={event => field('directory', event.target.value as DeterministicDraft['directory'])}><option value="task">Task directory</option><option value="project">Base project directory</option></select></label>
    <label className="kb-field">Authorized variable names<input className="kb-input" aria-label="Authorized variable names" placeholder="CI_TOKEN, REVIEW_TOKEN" value={draft.env} onChange={event => field('env', event.target.value)} /></label>
    <p className="kb-hint">Names only. Configure local values for each task project and stable stage in the task's script settings.</p>{issue('env')}
    <fieldset className="kb-fieldset"><legend>Named exits</legend>
      {draft.exits.map((route, index) => <div className="kb-script-route" key={index}>
        <input className="kb-input" aria-label={'Exit name ' + (index + 1)} value={route.name} onChange={event => field('exits', draft.exits.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
        <select className="kb-input" aria-label={'Exit destination ' + (index + 1)} value={route.to} onChange={event => field('exits', draft.exits.map((item, i) => i === index ? { ...item, to: event.target.value } : item))}><option value="">Choose destination</option>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
        <button type="button" className="kb-button" aria-label={'Remove exit ' + (index + 1)} onClick={() => field('exits', draft.exits.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      <button type="button" className="kb-button" onClick={() => field('exits', [...draft.exits, { name: '', to: '' }])}>Add exit</button>{issue('exits')}
      <p className="kb-hint">Different exit names may share a destination. The optional error exit handles executor failures; no first-exit default is used.</p>
    </fieldset>
    <p className="kb-hint">Saving does not run code or grant trust. Existing executions retain their captured version until explicit Play.</p>
  </fieldset>;
}
