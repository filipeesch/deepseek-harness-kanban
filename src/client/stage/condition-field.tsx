import React from 'react';

/**
 * One transition condition, as multiline text the user can resize.
 *
 * The stage editor and the diagram's connection editor both present a condition
 * through this field, so a condition has one editing surface and one meaning
 * everywhere it appears. It never stores anything: the surface that owns the
 * draft decides when the text is written.
 */
export function ConditionField({ value, label, disabled, onChange }: {
  readonly value: string;
  /** The accessible name of this field, naming the destination it belongs to. */
  readonly label: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return <textarea
    className="kb-input kb-condition-field"
    aria-label={label}
    placeholder="When does this apply? (optional)"
    rows={2}
    value={value}
    disabled={disabled}
    onChange={event => onChange(event.target.value)}
  />;
}
