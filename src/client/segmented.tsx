import React, { useId } from 'react';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * One exclusive choice presented as adjacent buttons. It is the pattern the Git
 * section already used inline, extracted so a second surface can share its
 * keyboard model: radiogroup semantics, one tab stop, and arrow keys that move
 * the selection instead of only the focus.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, disabled = false, id }: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Overrides the generated id, so a form can label the group. */
  id?: string;
}) {
  const generated = useId();
  const groupId = id ?? generated;
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  function select(next: number): void {
    if (disabled) return;
    const option = options[next];
    if (option === undefined || option.value === value) return;
    onChange(option.value);
    const target = document.getElementById(groupId + '-option-' + option.value);
    target?.focus();
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (selectedIndex + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (selectedIndex + options.length - 1) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  }
  return <div className="kb-segmented" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} id={groupId} onKeyDown={onKeyDown}>
    {options.map(option => <button
      key={option.value}
      type="button"
      role="radio"
      className={'kb-segment' + (option.value === value ? ' is-active' : '')}
      id={groupId + '-option-' + option.value}
      aria-checked={option.value === value}
      tabIndex={option.value === value ? 0 : -1}
      disabled={disabled}
      onClick={() => select(options.findIndex(candidate => candidate.value === option.value))}
    >{option.label}</button>)}
  </div>;
}
