import React from 'react';

/** The action that makes this stage the workflow's initial stage. */
export function InitialSection({ isInitial, willBeInitial, disabled, onMakeInitial }: {
  readonly isInitial: boolean;
  /** True when the draft already asks for this stage to become the initial stage. */
  readonly willBeInitial: boolean;
  readonly disabled: boolean;
  readonly onMakeInitial: () => void;
}) {
  if (isInitial) return <p className="kb-hint" role="status">New tasks are created in this stage.</p>;
  if (willBeInitial) return <p className="kb-hint" role="status">This stage becomes the initial stage when you save.</p>;
  return <div className="kb-actions">
    <button type="button" className="kb-button" disabled={disabled} aria-label="Make this stage the initial stage" onClick={onMakeInitial}>Make initial</button>
  </div>;
}
