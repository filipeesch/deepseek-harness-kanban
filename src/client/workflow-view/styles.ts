/** Workflow diagram presentation; every selector is scoped to the plugin root. */
export const workflowViewStyles = String.raw`
.dsh-kanban .kb-flow-shell{position:relative;display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.dsh-kanban .kb-flow-canvas{width:100%;height:100%;min-height:0}
.dsh-kanban .kb-flow-canvas[data-ready=false]{visibility:hidden}
.dsh-kanban .kb-flow-controls{display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid var(--kb-line);border-radius:12px;background:var(--kb-surface);box-shadow:0 4px 14px #00000012}
.dsh-kanban .kb-flow-control{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.dsh-kanban .kb-flow-control:hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}
.dsh-kanban .kb-flow-control:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:1px}
.dsh-kanban .kb-flow-control:disabled{opacity:.38;cursor:default}
.dsh-kanban .kb-flow-control[data-tooltip]::after{content:attr(data-tooltip);position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);white-space:nowrap;background:var(--kb-surface);color:inherit;border:1px solid var(--kb-line);border-radius:6px;padding:4px 8px;font-size:11px;line-height:1.3;box-shadow:0 4px 14px #00000018;opacity:0;pointer-events:none;transition:opacity 90ms ease;z-index:12}
.dsh-kanban .kb-flow-control[data-tooltip]:hover::after,.dsh-kanban .kb-flow-control[data-tooltip]:focus-visible::after{opacity:1}
.dsh-kanban .kb-flow-control-divider{height:1px;margin:2px 4px;background:var(--kb-line)}
.dsh-kanban .kb-flow-stage{position:relative;display:flex;flex-direction:column;background:var(--kb-surface);border:1px solid var(--kb-line);border-radius:14px;box-shadow:0 8px 22px #00000014;font:inherit;color:inherit;overflow:hidden;box-sizing:border-box}
.dsh-kanban .kb-flow-stage[data-drop=true]{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 35%,transparent)}
.dsh-kanban .kb-flow-stage-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;min-height:24px;cursor:grab;border-bottom:1px solid var(--kb-line);user-select:none}
.dsh-kanban .kb-flow-stage-header[data-locked=true]{cursor:default}
.dsh-kanban .kb-flow-stage-header:active{cursor:grabbing}
.dsh-kanban .kb-flow-stage-header[data-locked=true]:active{cursor:default}
.dsh-kanban .kb-flow-stage .react-flow__handle{opacity:0;pointer-events:none}
.dsh-kanban .kb-flow-stage-header h2{font-size:13px;font-weight:650;margin:0;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-stage-header span{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
/* The card count and the creation action travel together, so presenting the action
   never shifts the title or the count. The action is a compact icon button, and the
   stage clips overflow, so it names itself with a native tooltip rather than the
   control stack's positioned one. The header above reserves the row a 24px control
   needs, so a stage offering the action is no taller than one that does not. */
.dsh-kanban .kb-flow-stage-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.dsh-kanban .kb-flow-stage-create{width:24px;height:24px;min-width:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;flex:0 0 24px}
.dsh-kanban .kb-flow-stage .kb-card-list{padding:8px;display:flex;flex-direction:column;gap:8px;position:relative;min-height:34px}
.dsh-kanban .kb-flow-card-slot{display:block;min-width:0}
.dsh-kanban .kb-flow-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;border-right:2px solid var(--kb-line);border-bottom:2px solid var(--kb-line);border-bottom-right-radius:12px;opacity:.55}
.dsh-kanban .kb-flow-resize:hover{opacity:1;border-color:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-flow-canvas .react-flow__minimap{background:var(--kb-surface);border:1px solid var(--kb-line);border-radius:10px;overflow:hidden}
.dsh-kanban .kb-flow-canvas .react-flow__minimap-node{fill:var(--kb-soft);stroke:var(--kb-line);stroke-width:1}
.dsh-kanban .kb-flow-canvas .react-flow__minimap-mask{fill:color-mix(in srgb,var(--kb-surface) 65%,transparent)}
.dsh-kanban .kb-flow-edge{stroke:var(--kb-line);stroke-width:1.6;fill:none}
.dsh-kanban .kb-flow-edge.is-implicit{stroke-dasharray:6 5}
.dsh-kanban .kb-flow-arrow{fill:currentColor;opacity:.4}
.dsh-kanban .kb-flow-canvas .react-flow__edge-interaction{pointer-events:stroke}
.dsh-kanban .kb-flow-contact{fill:var(--kb-surface);stroke:var(--kb-line);stroke-width:1.4;opacity:0;transition:opacity 110ms ease;pointer-events:all;cursor:grab}
.dsh-kanban .react-flow__edge:hover .kb-flow-contact,.dsh-kanban .react-flow__edge:focus-within .kb-flow-contact{opacity:1}
.dsh-kanban .kb-flow-contact:focus-visible{outline:none;stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:2;opacity:1}
.dsh-kanban .kb-flow-contact-hit{fill:transparent;stroke:none;pointer-events:all;cursor:grab}
.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-contact-hit{cursor:default}
.dsh-kanban .kb-flow-segment{fill:var(--kb-surface);stroke:var(--kb-line);stroke-width:1.2;opacity:0;transition:opacity 110ms ease;pointer-events:all;cursor:move}
.dsh-kanban .react-flow__edge:hover .kb-flow-segment,.dsh-kanban .react-flow__edge:focus-within .kb-flow-segment{opacity:1}
.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-contact,.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-segment{cursor:default}
/* A connection is pressed to select it and double-pressed to edit its condition, so
   the line itself carries a cursor that says so. */
.dsh-kanban .react-flow__edge{cursor:pointer}
.dsh-kanban .kb-flow-edge-group.is-selected .kb-flow-edge{stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:2.4}
.dsh-kanban .kb-flow-edge-group.is-selected .kb-flow-arrow{opacity:.85}
/* A dashed hollow ring reads as "nothing set here", which is what it marks. */
.dsh-kanban .kb-flow-condition-mark{fill:var(--kb-surface);stroke:color-mix(in srgb,currentColor 55%,var(--kb-line));stroke-width:1.6;stroke-dasharray:2 1.8;pointer-events:none}
/* The port a connection is drawn from: a pointer affordance on the stage boundary,
   revealed while the stage is pointed at and never part of the keyboard order. */
.dsh-kanban .kb-flow-port{position:absolute;width:13px;height:13px;border-radius:50%;border:1.5px solid var(--kb-line);background:var(--kb-surface);opacity:0;transition:opacity 110ms ease;cursor:crosshair;pointer-events:all;z-index:5}
.dsh-kanban .kb-flow-stage:hover .kb-flow-port{opacity:1}
.dsh-kanban .kb-flow-port:hover{border-color:var(--dsw-alias-state-business-primary,CanvasText)}
/* The stage clips its content, so every port sits just inside the boundary it anchors. */
.dsh-kanban .kb-flow-port[data-side=right]{right:3px;top:50%;margin-top:-6.5px}
.dsh-kanban .kb-flow-port[data-side=left]{left:3px;top:50%;margin-top:-6.5px}
.dsh-kanban .kb-flow-port[data-side=top]{top:3px;left:50%;margin-left:-6.5px}
.dsh-kanban .kb-flow-port[data-side=bottom]{bottom:3px;left:50%;margin-left:-6.5px}
.dsh-kanban .kb-flow-stage-edit:disabled{opacity:.38;cursor:default}
.dsh-kanban .kb-flow-stage[data-connect-candidate=true]{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 35%,transparent)}
.dsh-kanban .kb-flow-creation{pointer-events:none}
.dsh-kanban .kb-flow-creation line{stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:1.8;stroke-dasharray:5 4;fill:none}
.dsh-kanban .kb-flow-creation circle{fill:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-condition-popover{position:fixed;z-index:70;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 16px);overflow:auto;padding:12px;border:1px solid var(--kb-line);border-radius:10px;background:var(--kb-surface);box-shadow:0 14px 34px #00000026;font:inherit;color:inherit}
.dsh-kanban .kb-condition-popover .kb-condition-field{max-height:40vh}
.dsh-kanban .kb-flow-shell:focus{outline:none}
.dsh-kanban .kb-flow-shell:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:-2px}
.dsh-kanban .kb-condition-popover-head{font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-travel{position:absolute;pointer-events:none;z-index:8;width:190px}
.dsh-kanban .kb-flow-travel-card{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;border:1px solid var(--kb-line);background:var(--kb-surface);box-shadow:0 8px 20px #00000024;font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-flow-canvas .react-flow__attribution{background:transparent;color:inherit;opacity:.55}
.dsh-kanban .kb-flow-canvas .react-flow__attribution a{color:inherit}
`;
