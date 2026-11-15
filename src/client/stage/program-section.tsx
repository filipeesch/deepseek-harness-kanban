import React from 'react';
import { CodeEditor } from '../code-editor.js';
import { ProblemNotice } from './problem-notice.js';
import type { StageProblem } from './stage-problem.js';
import type { ScriptedDraft } from './scripted-draft.js';

/** The Execution tab of a stage that authors a program: what runs, and where it runs. */
export function ProgramSection({ draft, problem, disabled, active, onSave, onChange }: {
  readonly draft: ScriptedDraft;
  readonly problem: (field: StageProblem['field']) => string | undefined;
  readonly disabled: boolean;
  /** False while another tab is on screen, so the code surface re-measures when it returns. */
  readonly active: boolean;
  /** The editor's own save, bound to the code surface's keyboard shortcut. */
  readonly onSave: () => void;
  readonly onChange: (draft: ScriptedDraft) => void;
}) {

  const field = <K extends keyof ScriptedDraft>(key: K, value: ScriptedDraft[K]) => onChange({ ...draft, [key]: value });
  return <fieldset className="kb-fieldset kb-stage-fill" disabled={disabled}>
    <legend>Program</legend>
    <div className="kb-stage-row">
      <label className="kb-field">Language<select className="kb-input" aria-label="Script language" value={draft.language} onChange={event => field('language', event.target.value as ScriptedDraft['language'])}><option value="bash">Bash</option><option value="typescript">TypeScript</option></select></label>
      <label className="kb-field">Program source<select className="kb-input" aria-label="Program source" value={draft.source} onChange={event => field('source', event.target.value as ScriptedDraft['source'])}><option value="inline">Inline code</option><option value="file">External file</option></select></label>
      <label className="kb-field">Execution directory<select className="kb-input" aria-label="Execution directory" value={draft.directory} onChange={event => field('directory', event.target.value as ScriptedDraft['directory'])}><option value="task">Task directory</option><option value="project">Base project directory</option></select></label>
    </div>
    {draft.source === 'inline'
      ? <div className="kb-field kb-stage-code"><span className="kb-field-label">Inline code</span>
          <CodeEditor value={draft.code} language={draft.language} label="Inline code" active={active} readOnly={disabled} className="kb-script-surface" onChange={value => field('code', value)} onSaveShortcut={onSave} />
        </div>
      : <label className="kb-field">Script file<input className="kb-input" aria-label="Script file" placeholder="scripts/wait-ci.ts" value={draft.file} onChange={event => field('file', event.target.value)} /></label>}
    <ProblemNotice message={problem('source')} />
    <p className="kb-hint">Saving an inline program authorizes it; an external file source still needs a review. Saving never runs code, and an existing execution keeps its captured version until explicit Play.</p>
    <p className="kb-hint">The directory resolves a relative script file and is where the program runs. A task directory includes a bound worktree.</p>
  </fieldset>;
}
