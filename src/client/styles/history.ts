/** The task history table: its columns, its tones, and its self-scrolling section. */
export const historyStyles = [
  '.dsh-kanban .kb-history{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}',
  '.dsh-kanban .kb-history th{text-align:left;font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;opacity:.7;padding:6px 8px;border-bottom:1px solid var(--kb-line)}',
  '.dsh-kanban .kb-history td{padding:7px 8px;border-bottom:1px solid color-mix(in srgb,var(--kb-line) 55%,transparent);vertical-align:top;overflow-wrap:anywhere}',
  '.dsh-kanban .kb-history th:nth-child(1),.dsh-kanban .kb-history td:nth-child(1){width:26%}',
  '.dsh-kanban .kb-history th:nth-child(2),.dsh-kanban .kb-history td:nth-child(2){width:26%}',
  '.dsh-kanban .kb-history th:nth-child(3),.dsh-kanban .kb-history td:nth-child(3){width:32%}',
  '.dsh-kanban .kb-history th:nth-child(4),.dsh-kanban .kb-history td:nth-child(4){width:16%}',
  '.dsh-kanban .kb-history tbody tr:last-child td{border-bottom:0}',
  '.dsh-kanban .kb-history tr[data-tone=accent] .kb-history-event{font-weight:600}',
  // Readable text, not the indicator color: the orange marker token fails AA as body text.
  '.dsh-kanban .kb-history tr[data-tone=warning] .kb-history-event{color:var(--kb-state-attention-text)}',
  // The time and the duration wrap instead of forcing the table wider than a narrow drawer.
  '.dsh-kanban .kb-history-time{opacity:.85}',
  '.dsh-kanban .kb-history-duration{font-variant-numeric:tabular-nums;opacity:.85}',
  // The deep failure facts stay collapsed, so a narrow Detail column is not forced wide.
  '.dsh-kanban .kb-history-evidence{margin-top:4px;font-size:11.5px}',
  '.dsh-kanban .kb-history-evidence summary{cursor:pointer;opacity:.85}',
  '.dsh-kanban .kb-history-evidence-text{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:11.5px;opacity:.9}',
  '.dsh-kanban .kb-history-evidence summary:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}',
].join(String.fromCharCode(10));
