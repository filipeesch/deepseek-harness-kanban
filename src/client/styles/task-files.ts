/** The task Info section's file list: one row per attachment, with its actions. */
export const taskFileStyles = [
  '.dsh-kanban .kb-task-files-section{display:flex;flex-direction:column;gap:12px;padding-top:12px;border-top:1px solid var(--kb-line)}',
  '.dsh-kanban .kb-file-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
  '.dsh-kanban .kb-file-list li{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--kb-line);border-radius:8px;font-size:12.5px}',
  '.dsh-kanban .kb-file-name{flex:1;min-width:0;overflow-wrap:anywhere}',
  '.dsh-kanban .kb-file-size{white-space:nowrap;opacity:.7}',
  '.dsh-kanban .kb-file-add{display:flex;flex-direction:column;gap:8px}',
  '.dsh-kanban .kb-file-add-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
].join(String.fromCharCode(10));
