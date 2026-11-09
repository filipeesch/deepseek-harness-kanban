/** Workflow diagram presentation; every selector is scoped to the plugin root. */
export const workflowViewStyles = String.raw`
.dsh-kanban .kb-flow-shell{position:relative;display:flex;flex:1;min-height:0;border:1px solid var(--kb-line);border-radius:12px;overflow:hidden;background:color-mix(in srgb,var(--kb-soft) 45%,var(--kb-surface))}
.dsh-kanban .kb-flow-canvas{width:100%;height:100%;min-height:0}
.dsh-kanban .kb-flow-canvas[data-ready=false]{visibility:hidden}
.dsh-kanban .kb-flow-toolbar{position:absolute;left:12px;top:12px;z-index:6;display:flex;align-items:center;gap:6px;padding:5px;border:1px solid var(--kb-line);border-radius:9px;background:var(--kb-surface);box-shadow:0 4px 14px #00000012}
.dsh-kanban .kb-flow-toolbar .kb-button{font-size:12px;padding:5px 9px}
.dsh-kanban .kb-flow-zoom{display:flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--kb-line);border-radius:9px;background:var(--kb-surface);box-shadow:0 4px 14px #00000012}
.dsh-kanban .kb-flow-zoom .kb-button{font-size:12px;padding:5px 9px}
.dsh-kanban .kb-flow-stage{width:264px;display:flex;flex-direction:column;background:var(--kb-surface);border:1px solid var(--kb-line);border-radius:14px;box-shadow:0 8px 22px #00000014;font:inherit;color:inherit;overflow:hidden}
.dsh-kanban .kb-flow-stage[data-drop=true]{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 35%,transparent)}
.dsh-kanban .kb-flow-stage-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;cursor:grab;border-bottom:1px solid var(--kb-line);user-select:none}
.dsh-kanban .kb-flow-stage-header:active{cursor:grabbing}
.dsh-kanban .kb-flow-stage-header h2{font-size:13px;font-weight:650;margin:0;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-stage-header span{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
.dsh-kanban .kb-flow-stage .kb-card-list{padding:8px;display:flex;flex-direction:column;gap:6px;position:relative;min-height:34px}
.dsh-kanban .kb-flow-card{position:relative;display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;font:inherit;padding:7px 8px;border-radius:8px;border:1px solid var(--kb-line);background:var(--kb-surface);cursor:pointer;touch-action:none}
.dsh-kanban .kb-flow-card:hover{background:color-mix(in srgb,currentColor 6%,var(--kb-surface))}
.dsh-kanban .kb-flow-card:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-flow-card-title{font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-card-meta{display:flex;align-items:center;gap:5px;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;opacity:.62;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-edge{stroke:var(--kb-line);stroke-width:1.6;fill:none}
.dsh-kanban .kb-flow-edge.is-implicit{stroke-dasharray:6 5}
.dsh-kanban .kb-flow-arrow{fill:currentColor;opacity:.4}
.dsh-kanban .kb-flow-travel{position:absolute;pointer-events:none;z-index:8;width:190px}
.dsh-kanban .kb-flow-travel-card{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;border:1px solid var(--kb-line);background:var(--kb-surface);box-shadow:0 8px 20px #00000024;font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-stage .react-flow__handle{opacity:0;pointer-events:none}
.dsh-kanban .kb-flow-canvas .react-flow__attribution{background:transparent;color:inherit;opacity:.55}
.dsh-kanban .kb-flow-canvas .react-flow__attribution a{color:inherit}
`;
