import React, { useId } from 'react';

/** Optional context describing a stage, distinct from its entry instruction. */
export function DescriptionField({ value, disabled, onChange }: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const hint = useId();
  return <>
    <label className="kb-field">Description (optional)
      <textarea className="kb-input" aria-label="Stage description" aria-describedby={hint} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </label>
    <p className="kb-hint" id={hint}>Describe this stage for people and task agents. This is not an entry instruction.</p>
  </>;
}
