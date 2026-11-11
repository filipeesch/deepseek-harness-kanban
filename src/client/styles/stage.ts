/** The stage editor: its sections, its destination rows, and its inline problems. */
export const stageStyles = [
  '.dsh-kanban .kb-problem{color:color-mix(in srgb,var(--color-destructive,#c53030) 65%,var(--dsw-alias-label-primary,currentColor))}',
  '.dsh-kanban .kb-stage-destinations{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
  '.dsh-kanban .kb-stage-destination{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px dashed var(--kb-line);border-radius:8px}',
  '.dsh-kanban .kb-stage-modes{display:flex;flex-wrap:wrap;gap:12px}',
  '.dsh-kanban .kb-stage-condition{display:flex;align-items:stretch;gap:6px;min-width:0}',
  '.dsh-kanban .kb-stage-condition .kb-input{flex:1;min-width:0}',
  // A condition is prose: the field grows with the user, not with a fixed row count.
  '.dsh-kanban .kb-condition-field{resize:vertical;min-height:46px;font:inherit;line-height:1.5}',
  '.dsh-kanban .kb-transition-condition{display:flex;flex-direction:column;gap:8px}',
  '.dsh-kanban .kb-transition-condition-actions{display:flex;gap:8px;justify-content:flex-end}',
  '.dsh-kanban .kb-input[readonly]{background:var(--kb-soft);cursor:default}',
  '.dsh-kanban .kb-input:disabled{opacity:.65;cursor:not-allowed}',
  '.dsh-kanban .kb-flow-stage-edit{width:24px;height:24px;min-width:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;flex:0 0 24px}',
].join(String.fromCharCode(10));
