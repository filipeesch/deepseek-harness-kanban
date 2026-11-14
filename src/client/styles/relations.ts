/** The task Relations section: a plain list of the cards this task is linked to. */
export const relationStyles = [
  '.dsh-kanban .kb-relations{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
  // Baseline alignment keeps the badge-less row on one line until a long title wraps.
  '.dsh-kanban .kb-relations-row{display:flex;align-items:baseline;gap:8px;padding:7px 9px;border:1px solid var(--kb-line);border-radius:8px;font-size:12.5px}',
  '.dsh-kanban .kb-relations-label{flex:1;min-width:0;overflow-wrap:anywhere}',
  '.dsh-kanban .kb-relations-meta{flex:none;display:flex;align-items:baseline;gap:6px;font-size:11.5px;color:inherit;font-variant-numeric:tabular-nums}',
  '.dsh-kanban .kb-relations-stage,.dsh-kanban .kb-relations-board{white-space:nowrap}',
  '.dsh-kanban .kb-relations-board{padding-left:6px;border-left:1px solid var(--kb-line)}',
].join(String.fromCharCode(10));
