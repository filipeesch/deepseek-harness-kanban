import React from 'react';

/** The Execution tab of a stage that authors no program: the instruction it delivers on entry. */
export function InstructionSection({ value, disabled, onChange }: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return <fieldset className="kb-fieldset kb-stage-fill">
    <legend>Entry instruction</legend>
    <label className="kb-field">Instruction
      <textarea className="kb-input kb-stage-instruction" aria-label="Stage entry instruction" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </label>
    <p className="kb-hint">Sent to the task's conversation when it enters this stage. Leave it empty for no instruction.</p>
  </fieldset>;
}
