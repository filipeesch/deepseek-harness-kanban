import React from 'react';
import type { Column } from '../../shared/types.js';
import { ProblemNotice } from './problem-notice.js';
import type { StageProblem } from './stage-problem.js';
import { newDecisionOption, type DecisionDraft, type DecisionOptionDraft } from './decision-draft.js';

/**
 * The Decision tab: the authored question, its context, and the ordered options.
 *
 * The tab edits the draft only; saving opens the mode switch, so the editor never
 * stores a decision step beside an instruction or a program.
 */
export function DecisionSection({ draft, choices, problem, disabled, onChange }: {
  readonly draft: DecisionDraft;
  /** The stages an option may target: every stage but the edited one. */
  readonly choices: readonly Column[];
  readonly problem: (field: StageProblem['field']) => string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: DecisionDraft) => void;
}) {
  const update = (next: Partial<DecisionDraft>): void => onChange({ ...draft, ...next });
  const updateOption = (index: number, patch: Partial<DecisionOptionDraft>): void => update({ options: draft.options.map((option, position) => position === index ? { ...option, ...patch } : option) });
  const add = (): void => update({ options: [...draft.options, newDecisionOption(draft.options, choices[0]?.id ?? '')] });
  const remove = (index: number): void => update({ options: draft.options.filter((_option, position) => position !== index) });
  const move = (index: number, offset: number): void => {
    const target = index + offset;
    if (target < 0 || target >= draft.options.length) return;
    const options = [...draft.options];
    const [moved] = options.splice(index, 1);
    options.splice(target, 0, moved!);
    update({ options });
  };
  return <fieldset className="kb-fieldset">
    <legend>Decision</legend>
    <p className="kb-hint">The task stops here until a person chooses one option. The card stays highlighted, no agent turn starts, and the chosen option routes the task.</p>
    <label className="kb-field">Question
      <textarea className="kb-input" aria-label="Decision question" value={draft.question} disabled={disabled} onChange={event => update({ question: event.target.value })} />
    </label>
    <label className="kb-field">Context (Markdown, optional)
      <textarea className="kb-input" aria-label="Decision context" value={draft.context} disabled={disabled} onChange={event => update({ context: event.target.value })} />
    </label>
    <div className="kb-decision-options" role="group" aria-label="Decision options">
      {draft.options.map((option, index) => <div className="kb-decision-option" role="group" aria-label={'Option ' + (index + 1)} key={option.rowKey ?? 'row-' + index}>
        <p className="kb-decision-option-heading">Option {index + 1}</p>
        <label className="kb-field">Id
          <input className="kb-input" aria-label={'Option ' + (index + 1) + ' id'} value={option.id} disabled={disabled} onChange={event => updateOption(index, { id: event.target.value })} />
        </label>
        <label className="kb-field">Title
          <input className="kb-input" aria-label={'Option ' + (index + 1) + ' title'} value={option.title} disabled={disabled} onChange={event => updateOption(index, { title: event.target.value })} />
        </label>
        <label className="kb-field">Description (Markdown, optional)
          <textarea className="kb-input" aria-label={'Option ' + (index + 1) + ' description'} value={option.description} disabled={disabled} onChange={event => updateOption(index, { description: event.target.value })} />
        </label>
        <label className="kb-field">Destination
          <select className="kb-input" aria-label={'Option ' + (index + 1) + ' destination'} value={option.to} disabled={disabled} onChange={event => updateOption(index, { to: event.target.value })}>
            <option value="">Choose a stage</option>
            {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
          </select>
        </label>
        <div className="kb-actions">
          <button type="button" className="kb-button" aria-label={'Move option ' + (index + 1) + ' up'} disabled={disabled || index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" className="kb-button" aria-label={'Move option ' + (index + 1) + ' down'} disabled={disabled || index === draft.options.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" className="kb-button" aria-label={'Remove option ' + (index + 1)} disabled={disabled} onClick={() => remove(index)}>Remove</button>
        </div>
      </div>)}
    </div>
    <button type="button" className="kb-button" disabled={disabled} onClick={add}>Add option</button>
    <ProblemNotice message={problem('decision')} />
  </fieldset>;
}