/** Script surfaces inherit the host palette and preserve the reserved card action row. */
export const deterministicStyles = String.raw`
.dsh-kanban .kb-script-card-label{font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:var(--kb-muted)}
.dsh-kanban .kb-script-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dsh-kanban .kb-script-panel{padding:10px 14px;border-bottom:1px solid var(--kb-line);background:var(--kb-soft);font-size:12px}
.dsh-kanban .kb-script-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dsh-kanban .kb-script-panel .kb-hint,.dsh-kanban .kb-script-panel .kb-problem{margin:5px 0;overflow-wrap:anywhere}
.dsh-kanban .kb-script-code{font-family:ui-monospace,SFMono-Regular,monospace;resize:vertical;min-height:150px;tab-size:2}
.dsh-kanban .kb-script-route{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}
.dsh-kanban .kb-script-route input,.dsh-kanban .kb-script-route select{min-width:0;flex:1}
.dsh-kanban .kb-script-facts{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:6px 12px;margin:0}
.dsh-kanban .kb-script-facts dt{font-weight:600}.dsh-kanban .kb-script-facts dd{margin:0;overflow-wrap:anywhere}
.dsh-kanban .kb-script-source{overflow:auto;max-height:320px;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--kb-soft);border:1px solid var(--kb-line);border-radius:6px;color:inherit}
.dsh-kanban .kb-script-card-label[data-held="true"]{color:var(--kb-state-attention-text);font-weight:600}
.dsh-kanban .kb-hold{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--kb-state-attention);border-left-width:4px;border-radius:6px;background:color-mix(in srgb,var(--kb-state-attention) 10%,var(--kb-surface));font-size:12px}
.dsh-kanban .kb-hold-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px}
.dsh-kanban .kb-hold-reason{margin:0;font-weight:600;overflow-wrap:anywhere}
.dsh-kanban .kb-hold-facts{margin:0;padding-left:18px;overflow-wrap:anywhere}
.dsh-kanban .kb-hold .kb-hint{margin:0}
.dsh-kanban .kb-hold-actions{display:flex;gap:6px;flex-wrap:wrap}
`;
