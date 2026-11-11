import React from 'react';
import type { Column } from '../../shared/types.js';
import { ConditionField } from './condition-field.js';
import type { StageTransitionDraft, StageTransitionMode } from './stage-editor-draft.js';

/** The three states a stage can be in, in the order the editor presents them. */
const MODES: ReadonlyArray<{ readonly value: StageTransitionMode; readonly label: string; readonly hint: string }> = [
  { value: 'any', label: 'Allow any stage', hint: 'Any other stage may be a destination.' },
  { value: 'restricted', label: 'Choose destinations', hint: 'Only the stages you choose may be destinations.' },
  { value: 'none', label: 'No destinations', hint: 'This stage is terminal: tasks leave it only with an explicit confirmation.' },
];

/**
 * The allowed transition targets: every stage, a chosen set with conditions, or no
 * destination at all. A stage that permits nothing is its own mode rather than an
 * empty checklist, so it is reachable and reversible on purpose.
 */
export function TransitionsSection({ choices, mode, transitions, disabled, problem, onMode, onChoose, onCondition }: {
  readonly choices: readonly Column[];
  readonly mode: StageTransitionMode;
  readonly transitions: readonly StageTransitionDraft[];
  readonly disabled: boolean;
  readonly problem: string | undefined;
  readonly onMode: (mode: StageTransitionMode) => void;
  readonly onChoose: (to: string, chosen: boolean) => void;
  readonly onCondition: (to: string, when: string) => void;
}) {
  const chosen = new Map(transitions.map(transition => [transition.to, transition.when]));
  const hint = MODES.find(value => value.value === mode)?.hint ?? '';
  return <fieldset className="kb-fieldset">
    <legend>Allowed destinations</legend>
    <div className="kb-stage-modes" role="radiogroup" aria-label="Allowed destinations mode">
      {MODES.map(option => <label className="kb-choice" key={option.value}>
        <input
          type="radio"
          name="kb-transition-mode"
          aria-label={option.label}
          checked={mode === option.value}
          disabled={disabled}
          onChange={() => onMode(option.value)}
        /> {option.label}
      </label>)}
    </div>
    <p className="kb-hint">{hint}</p>
    {mode === 'restricted' && <div className="kb-stage-destinations">
      {choices.map(choice => {
        const when = chosen.get(choice.id);
        return <div className="kb-stage-destination" key={choice.id}>
          <label className="kb-choice"><input type="checkbox" aria-label={'Allow transition to ' + choice.name} checked={when !== undefined} disabled={disabled} onChange={event => onChoose(choice.id, event.target.checked)} /> {choice.name}</label>
          {when !== undefined && <div className="kb-stage-condition">
            <ConditionField value={when} label={'Condition for ' + choice.name} disabled={disabled} onChange={value => onCondition(choice.id, value)} />
          </div>}
        </div>;
      })}
    </div>}
    {problem !== undefined && <p className="kb-hint kb-problem" role="alert">{problem}</p>}
  </fieldset>;
}
