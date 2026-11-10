import React from 'react';
import type { StageEditorProblem } from './stage-editor-draft.js';

/** The stage's display name and identifier, with the reason a rename is unavailable. */
export function IdentitySection({ name, id, disabled, renameBlock, problem, onName, onId }: {
  readonly name: string;
  readonly id: string;
  readonly disabled: boolean;
  /** Why the identifier cannot be edited right now; null when it can. */
  readonly renameBlock: string | null;
  readonly problem: (field: StageEditorProblem['field']) => string | undefined;
  readonly onName: (value: string) => void;
  readonly onId: (value: string) => void;
}) {
  const nameProblem = problem('name');
  const idProblem = problem('id');
  return <fieldset className="kb-fieldset">
    <legend>Stage</legend>
    <label className="kb-field">Name
      <input className="kb-input" aria-label="Stage name" value={name} disabled={disabled} aria-invalid={nameProblem !== undefined} onChange={event => onName(event.target.value)} />
    </label>
    {nameProblem !== undefined && <p className="kb-hint kb-problem" role="alert">{nameProblem}</p>}
    <label className="kb-field">Id
      <input className="kb-input" aria-label="Stage id" value={id} disabled={disabled} aria-invalid={idProblem !== undefined} readOnly={renameBlock !== null} aria-readonly={renameBlock !== null} onChange={event => onId(event.target.value)} />
    </label>
    {renameBlock !== null && <p className="kb-hint" role="status">{renameBlock}</p>}
    {idProblem !== undefined && <p className="kb-hint kb-problem" role="alert">{idProblem}</p>}
    <p className="kb-hint">The id is what tasks and transitions point at. Renaming it moves every task in this stage.</p>
  </fieldset>;
}
