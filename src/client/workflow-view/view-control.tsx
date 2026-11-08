import React from 'react';
import type { WorkflowView } from '../../shared/types.js';

/** The board header's presentation switch; the YAML default decides the first render. */
export function WorkflowViewControl({ view, onChange }: { readonly view: WorkflowView; readonly onChange: (view: WorkflowView) => void }) {
  return <div className="kb-view-switch" role="group" aria-label="Board presentation">
    <button type="button" aria-pressed={view === 'board'} onClick={() => onChange('board')}>Board</button>
    <button type="button" aria-pressed={view === 'workflow'} onClick={() => onChange('workflow')}>Workflow</button>
  </div>;
}
