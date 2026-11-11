/** Publishing surfaces are scoped like every other plugin-owned selector. */
export const sharingStyles = String.raw`
.dsh-kanban .kb-share-dot{border-radius:2px;border-color:color-mix(in srgb,currentColor 40%,transparent)}
.dsh-kanban .kb-share-updates{background:#2563eb}
.dsh-kanban .kb-share-draft{background:color-mix(in srgb,currentColor 62%,transparent)}
.dsh-kanban .kb-share-review{background:#b45309}
.dsh-kanban .kb-share-orphan{background:transparent;border:1px dashed currentColor;opacity:.75}
.dsh-kanban .kb-share-unavailable{background:#b91c1c}
.dsh-kanban .kb-share-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--kb-state-unread) 35%,var(--kb-line));border-radius:8px;background:color-mix(in srgb,var(--kb-state-unread) 7%,var(--kb-surface));font-size:12.5px}
.dsh-kanban .kb-share-banner p{margin:0}
.dsh-kanban .kb-share-banner .kb-actions{margin-left:auto}
.dsh-kanban .kb-share-banner .kb-dismiss-button{align-self:flex-start}
.dsh-kanban .kb-share-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--kb-line);background:var(--kb-soft)}
.dsh-kanban .kb-share-status.is-attention{border-color:color-mix(in srgb,var(--kb-state-attention) 45%,var(--kb-line));background:color-mix(in srgb,var(--kb-state-attention) 10%,var(--kb-surface))}
.dsh-kanban .kb-share-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;opacity:.75;margin:0}
.dsh-kanban .kb-share-boards{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-kanban .kb-share-board{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;border:1px solid var(--kb-line);border-radius:7px}
.dsh-kanban .kb-share-board-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-kanban .kb-share-board-name{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.dsh-kanban .kb-share-board-state{font-size:11px;opacity:.72}
.dsh-kanban .kb-share-blockers{display:flex;flex-direction:column;gap:4px;margin:0;padding:8px 10px;list-style:none;border:1px solid color-mix(in srgb,var(--kb-state-attention) 35%,var(--kb-line));border-radius:7px;background:color-mix(in srgb,var(--kb-state-attention) 7%,var(--kb-surface));font-size:12px}
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
.dsh-kanban .kb-storage-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media(max-width:520px){.dsh-kanban .kb-storage-cards{grid-template-columns:1fr}}
.dsh-kanban .kb-storage-card{display:flex;align-items:flex-start;gap:10px;text-align:left;font:inherit;color:inherit;background:var(--kb-surface);border:1px solid var(--kb-line);border-radius:9px;padding:10px 11px;cursor:pointer;min-width:0}
.dsh-kanban .kb-storage-card:hover:not(:disabled){background:var(--kb-soft)}
.dsh-kanban .kb-storage-card.is-selected{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,CanvasText);background:var(--kb-soft)}
.dsh-kanban .kb-storage-card:disabled{cursor:not-allowed;opacity:.65}
.dsh-kanban .kb-storage-card-icon{display:inline-flex;flex:0 0 auto;padding-top:1px;opacity:.9}
.dsh-kanban .kb-storage-card-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-kanban .kb-storage-card-name{font-size:13px;font-weight:600}
.dsh-kanban .kb-storage-card-description{font-size:11.5px;opacity:.72;line-height:1.35}
.dsh-kanban .kb-storage-card:focus-visible,.dsh-kanban .kb-picker-location:focus-visible,.dsh-kanban .kb-picker-folder:focus-visible,.dsh-kanban .kb-picker-crumb:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-picker{display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:14px;min-height:320px}
@media(max-width:760px){.dsh-kanban .kb-picker{grid-template-columns:1fr}.dsh-kanban .kb-picker-locations{max-height:190px}}
.dsh-kanban .kb-picker-locations{border:1px solid var(--kb-line);border-radius:9px;padding:8px;min-width:0;display:flex;flex-direction:column;gap:6px}
.dsh-kanban .kb-picker-locations-header{display:flex;align-items:center;justify-content:space-between;font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.75}
.dsh-kanban .kb-picker-rescan{display:inline-flex;align-items:center;gap:4px;padding:4px 7px;font-size:11px}
.dsh-kanban .kb-picker-location-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;overflow:auto;min-height:0}
.dsh-kanban .kb-picker-location{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:7px;padding:7px;cursor:pointer}
.dsh-kanban .kb-picker-location:hover{background:var(--kb-soft)}
.dsh-kanban .kb-picker-location.is-selected{background:var(--kb-soft);border-color:var(--kb-line)}
.dsh-kanban .kb-picker-location-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsh-kanban .kb-picker-location-name{font-size:12.5px;font-weight:600;overflow-wrap:anywhere}
.dsh-kanban .kb-picker-location-path{font-size:10.5px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.dsh-kanban .kb-picker-browser{border:1px solid var(--kb-line);border-radius:9px;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0;min-height:0}
.dsh-kanban .kb-picker-toolbar{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.dsh-kanban .kb-picker-breadcrumb{display:flex;align-items:center;gap:2px;overflow:auto;flex:1 1 180px;min-width:0}
.dsh-kanban .kb-picker-crumb{font:inherit;font-size:12px;background:transparent;border:0;color:inherit;padding:3px 4px;border-radius:4px;cursor:pointer;white-space:nowrap}
.dsh-kanban .kb-picker-crumb:hover:not(:disabled){background:var(--kb-soft)}
.dsh-kanban .kb-picker-crumb:disabled{opacity:.75;cursor:default;font-weight:600}
.dsh-kanban .kb-picker-chevron{opacity:.45;flex:0 0 auto}
.dsh-kanban .kb-picker-filter{display:flex;align-items:center;gap:4px;opacity:.9}
.dsh-kanban .kb-picker-filter .kb-input{padding:5px 7px;font-size:12px;width:130px}
.dsh-kanban .kb-picker-folders{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;overflow:auto;min-height:180px;max-height:46vh}
.dsh-kanban .kb-picker-folder{display:flex;align-items:center;gap:7px;width:100%;text-align:left;font:inherit;font-size:12.5px;color:inherit;background:transparent;border:0;border-radius:6px;padding:6px 7px;cursor:pointer}
.dsh-kanban .kb-picker-folder:hover:not(:disabled){background:var(--kb-soft)}
.dsh-kanban .kb-picker-section{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.62;padding:8px 7px 3px}
.dsh-kanban .kb-picker-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap}
.dsh-kanban .kb-picker-footer-actions{display:flex;gap:6px;margin-left:auto}
`;
