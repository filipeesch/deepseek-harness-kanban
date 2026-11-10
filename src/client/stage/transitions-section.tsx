import React from 'react';
import type { Column } from '../../shared/types.js';
import type { StageTransitionDraft } from './stage-editor-draft.js';

/** The allowed transition targets: every stage, or a chosen set with conditions. */
export function TransitionsSection({ choices, mode, transitions, disabled, problem, onMode, onChoose, onCondition, onExpand }: {
  readonly choices: readonly Column[];
  readonly mode: 'any' | 'restricted';
  readonly transitions: readonly StageTransitionDraft[];
  readonly disabled: boolean;
  readonly problem: string | undefined;
  readonly onMode: (mode: 'any' | 'restricted') => void;
  readonly onChoose: (to: string, chosen: boolean) => void;
  readonly onCondition: (to: string, when: string) => void;
  /** Asks the dialog to open the long-text editor for one destination. */
  readonly onExpand: (to: string) => void;
}) {
  const chosen = new Map(transitions.map(transition => [transition.to, transition.when]));
  return <fieldset className="kb-fieldset">
    <legend>Allowed destinations</legend>
    <label className="kb-choice"><input type="checkbox" aria-label="Allow any stage" checked={mode === 'any'} disabled={disabled} onChange={event => onMode(event.target.checked ? 'any' : 'restricted')} /> Allow any stage</label>
    {mode === 'restricted' && <div className="kb-stage-destinations">
      {choices.map(choice => {
        const when = chosen.get(choice.id);
        return <div className="kb-stage-destination" key={choice.id}>
          <label className="kb-choice"><input type="checkbox" aria-label={'Allow transition to ' + choice.name} checked={when !== undefined} disabled={disabled} onChange={event => onChoose(choice.id, event.target.checked)} /> {choice.name}</label>
          {when !== undefined && <div className="kb-stage-condition">
            <input className="kb-input" aria-label={'Condition for ' + choice.name} placeholder="When does this apply? (optional)" value={when} disabled={disabled} onChange={event => onCondition(choice.id, event.target.value)} />
            <button type="button" className="kb-button" aria-label={'Expand the condition for ' + choice.name} title={'Expand the condition for ' + choice.name} disabled={disabled} onClick={() => onExpand(choice.id)}>Expand</button>
          </div>}
        </div>;
      })}
    </div>}
    {problem !== undefined && <p className="kb-hint kb-problem" role="alert">{problem}</p>}
  </fieldset>;
}
