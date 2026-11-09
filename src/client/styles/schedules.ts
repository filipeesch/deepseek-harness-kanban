/** Schedule list and row surfaces; every selector stays inside the plugin scope. */
export const scheduleStyles = String.raw`
.dsh-kanban .kb-schedule-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dsh-kanban .kb-schedule-list>li{display:flex;flex-direction:column;gap:8px;border:1px solid var(--kb-line);padding:12px;border-radius:8px}
.dsh-kanban .kb-schedule-title{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dsh-kanban .kb-schedule-title strong{overflow-wrap:anywhere}
.dsh-kanban .kb-schedule-facts{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;opacity:.8;min-width:0}
.dsh-kanban .kb-schedule-facts code{overflow-wrap:anywhere}
.dsh-kanban .kb-schedule-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dsh-kanban .kb-schedule-last-run{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px}
`;
