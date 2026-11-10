import React, { useState } from 'react';
import { Modal } from '../ui.js';

/** The long-text editor a transition condition expands into. */
export function ConditionEditor({ title, value, onConfirm, onClose }: {
  readonly title: string;
  readonly value: string;
  readonly onConfirm: (value: string) => void;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(value);
  // Modal owns the initial focus, so the textarea is prefixed and the field the
  // user pressed keeps focus history for the restore on close.
  return <Modal title={title} onClose={onClose} initialFocus="target">
    <form className="kb-form" aria-label={title} onSubmit={event => { event.preventDefault(); event.stopPropagation(); onConfirm(text); onClose(); }}>
      <label className="kb-field">Condition
        <textarea className="kb-input" aria-label="Transition condition" rows={8} data-kb-initial-focus value={text} onChange={event => setText(event.target.value)} />
      </label>
      <p className="kb-hint">Describe when this destination applies. The stage is stored only when the stage editor is saved.</p>
      <div className="kb-actions">
        <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
        <button className="kb-button kb-primary" type="submit">Use this condition</button>
      </div>
    </form>
  </Modal>;
}
