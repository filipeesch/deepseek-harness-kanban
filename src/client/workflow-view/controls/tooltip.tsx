import React, { type ReactNode } from 'react';

export interface TooltipButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly children: ReactNode;
}

/**
 * One diagram control: an icon button whose accessible name and CSS tooltip
 * share one label, so a sighted and an assisted reading never disagree.
 */
export function TooltipButton({ label, onClick, disabled = false, pressed, children }: TooltipButtonProps) {
  return <button
    type="button"
    className="kb-flow-control"
    aria-label={label}
    data-tooltip={label}
    {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    disabled={disabled}
    onClick={onClick}
  >{children}</button>;
}
