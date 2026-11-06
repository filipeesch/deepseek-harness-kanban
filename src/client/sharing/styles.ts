/** Publishing surfaces are scoped like every other plugin-owned selector. */
export const sharingStyles = String.raw`
.dsh-kanban .kb-share-dot{border-radius:2px;border-color:color-mix(in srgb,currentColor 40%,transparent)}
.dsh-kanban .kb-share-updates{background:#2563eb}
.dsh-kanban .kb-share-draft{background:color-mix(in srgb,currentColor 62%,transparent)}
.dsh-kanban .kb-share-review{background:#b45309}
.dsh-kanban .kb-share-orphan{background:transparent;border:1px dashed currentColor;opacity:.75}
.dsh-kanban .kb-share-unavailable{background:#b91c1c}
.dsh-kanban .kb-share-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid color-mix(in srgb,#3b82f6 35%,var(--kb-line));border-radius:8px;background:color-mix(in srgb,#3b82f6 7%,var(--kb-surface));font-size:12.5px}
.dsh-kanban .kb-share-banner p{margin:0}
.dsh-kanban .kb-share-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--kb-line);background:var(--kb-soft)}
.dsh-kanban .kb-share-status.is-attention{border-color:color-mix(in srgb,#ed8936 45%,var(--kb-line));background:color-mix(in srgb,#ed8936 10%,var(--kb-surface))}
.dsh-kanban .kb-share-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;opacity:.75;margin:0}
.dsh-kanban .kb-share-boards{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-kanban .kb-share-board{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;border:1px solid var(--kb-line);border-radius:7px}
.dsh-kanban .kb-share-board-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-kanban .kb-share-board-name{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.dsh-kanban .kb-share-board-state{font-size:11px;opacity:.72}
.dsh-kanban .kb-share-blockers{display:flex;flex-direction:column;gap:4px;margin:0;padding:8px 10px;list-style:none;border:1px solid color-mix(in srgb,#ed8936 35%,var(--kb-line));border-radius:7px;background:color-mix(in srgb,#ed8936 7%,var(--kb-surface));font-size:12px}
.dsh-kanban .kb-share-blockers code{font-size:10.5px;font-weight:700;margin-right:5px}
.dsh-kanban .kb-share-actions{display:flex;flex-wrap:wrap;gap:6px}
.dsh-kanban .kb-share-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.dsh-kanban .kb-share-form .kb-field{flex:1 1 240px}
.dsh-kanban .kb-share-interval{max-width:120px}
.dsh-kanban .kb-share-diff{width:100%;font-size:11.5px}
.dsh-kanban .kb-share-diff summary{cursor:pointer;opacity:.8}
.dsh-kanban .kb-share-diff-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-top:6px}
.dsh-kanban .kb-share-diff-body h5{margin:0 0 3px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}
.dsh-kanban .kb-share-diff-body pre{margin:0;max-height:200px;overflow:auto;padding:7px;border:1px solid var(--kb-line);border-radius:6px;background:var(--kb-soft);white-space:pre-wrap;overflow-wrap:anywhere}
`;
