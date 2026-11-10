import React from 'react';

/** The instruction delivered when a task enters this stage. */
export function InstructionSection({ value, disabled, onChange }: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return <fieldset className="kb-fieldset">
    <legend>Entry instruction</legend>
    <label className="kb-field">Instruction
      <textarea className="kb-input" aria-label="Stage entry instruction" rows={5} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </label>
    <p className="kb-hint">Sent to the task's conversation when it enters this stage. Leave it empty for no instruction.</p>
  </fieldset>;
}
