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
.dsh-kanban .kb-flow-stage[data-drop=true]{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 calc(2px * var(--kb-affordance-scale,1)) color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 45%,transparent)}
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
.dsh-kanban .kb-flow-arrow{fill:currentColor;opacity:.4;pointer-events:none}
.dsh-kanban .kb-flow-canvas .react-flow__edge-interaction{pointer-events:stroke}
/* The marks that move a connection live above the stage regions, so a stage
   boundary or the arrowhead can never swallow a press. Each target is sized in
   screen pixels by the layer, which corrects for the viewport zoom. */
.dsh-kanban .kb-flow-affordances{position:absolute;left:0;top:0;width:0;height:0;z-index:6;pointer-events:none}
.dsh-kanban .kb-flow-marks{position:absolute;left:0;top:0;width:0;height:0;opacity:0;transition:opacity 110ms ease;pointer-events:none}
.dsh-kanban .kb-flow-marks[data-active=true],.dsh-kanban .kb-flow-marks:focus-within{opacity:1}
.dsh-kanban .kb-flow-handle{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;border-radius:50%;pointer-events:none;cursor:grab}
.dsh-kanban .kb-flow-marks[data-active=true] .kb-flow-handle,.dsh-kanban .kb-flow-marks:focus-within .kb-flow-handle{pointer-events:auto}
.dsh-kanban .kb-flow-handle:active{cursor:grabbing}
.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-handle{cursor:default}
.dsh-kanban .kb-flow-handle-dot{flex:0 0 auto;width:var(--kb-affordance-mark,12px);height:var(--kb-affordance-mark,12px);transform:scale(var(--kb-affordance-scale,1));border-radius:50%;border:1.5px solid color-mix(in srgb,currentColor 55%,var(--kb-line));background:var(--kb-surface);box-shadow:0 1px 4px #00000024}
.dsh-kanban .kb-flow-handle:hover .kb-flow-handle-dot,.dsh-kanban .kb-flow-marks.is-selected .kb-flow-handle-dot{border-color:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-flow-marks.is-selected .kb-flow-handle-dot{border-width:2px}
.dsh-kanban .kb-flow-handle:focus-visible{outline:calc(var(--dsw-focus-ring-width,2px) * var(--kb-affordance-scale,1)) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:calc(2px * var(--kb-affordance-scale,1))}
.dsh-kanban .kb-flow-grip{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;border-radius:4px;pointer-events:none;cursor:move}
.dsh-kanban .kb-flow-marks[data-active=true] .kb-flow-grip{pointer-events:auto}
.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-marks .kb-flow-handle,.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-marks .kb-flow-grip{pointer-events:none}
.dsh-kanban .kb-flow-grip[data-axis=x]{cursor:ew-resize}
.dsh-kanban .kb-flow-grip[data-axis=y]{cursor:ns-resize}
.dsh-kanban .kb-flow-canvas[data-locked=true] .kb-flow-grip{cursor:default}
.dsh-kanban .kb-flow-grip-dot{flex:0 0 auto;width:var(--kb-affordance-mark,12px);height:var(--kb-affordance-mark,12px);transform:scale(var(--kb-affordance-scale,1));border-radius:2px;border:1.2px solid color-mix(in srgb,currentColor 55%,var(--kb-line));background:var(--kb-surface);box-shadow:0 1px 4px #00000024}
.dsh-kanban .kb-flow-grip:hover .kb-flow-grip-dot,.dsh-kanban .kb-flow-marks.is-selected .kb-flow-grip-dot{border-color:var(--dsw-alias-state-business-primary,CanvasText)}
/* A connection is pressed to select it and double-pressed to edit its condition, so
   the line itself carries a cursor that says so. */
.dsh-kanban .react-flow__edge{cursor:pointer}
.dsh-kanban .kb-flow-edge-group.is-selected .kb-flow-edge{stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:2.4}
.dsh-kanban .kb-flow-edge-group.is-selected .kb-flow-arrow{opacity:.85}
/* A dashed hollow ring reads as "nothing set here", which is what it marks. */
.dsh-kanban .kb-flow-condition-mark{fill:var(--kb-surface);stroke:color-mix(in srgb,currentColor 55%,var(--kb-line));stroke-width:1.6;stroke-dasharray:2 1.8;pointer-events:none}
/* The port a connection is drawn from: a pointer affordance on the stage boundary,
   revealed while the stage is pointed at and never part of the keyboard order. */
/* The creation ports live above the stage too, so the stage can never clip half of
   their pointer target, and the pointer crossing from the stage onto a port keeps
   them presented through the hover linger. */
.dsh-kanban .kb-flow-port{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;border-radius:50%;pointer-events:auto;cursor:crosshair}
.dsh-kanban .kb-flow-port-dot{position:absolute;width:var(--kb-port-mark,12px);height:var(--kb-port-mark,12px);border-radius:50%;border:1.5px solid color-mix(in srgb,currentColor 55%,var(--kb-line));background:var(--kb-surface);box-shadow:0 1px 4px #00000024}
.dsh-kanban .kb-flow-port[data-side=top] .kb-flow-port-dot{left:50%;bottom:0;transform:translate(-50%,50%) scale(var(--kb-affordance-scale,1))}
.dsh-kanban .kb-flow-port[data-side=bottom] .kb-flow-port-dot{left:50%;top:0;transform:translate(-50%,-50%) scale(var(--kb-affordance-scale,1))}
.dsh-kanban .kb-flow-port[data-side=left] .kb-flow-port-dot{top:50%;right:0;transform:translate(50%,-50%) scale(var(--kb-affordance-scale,1))}
.dsh-kanban .kb-flow-port[data-side=right] .kb-flow-port-dot{top:50%;left:0;transform:translate(-50%,-50%) scale(var(--kb-affordance-scale,1))}
.dsh-kanban .kb-flow-port:hover .kb-flow-port-dot{border-color:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-flow-stage-edit:disabled{opacity:.38;cursor:default}
.dsh-kanban .kb-flow-stage[data-connect-candidate=true]{border-color:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 calc(2px * var(--kb-affordance-scale,1)) color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 45%,transparent)}
.dsh-kanban .kb-flow-creation{position:absolute;overflow:visible;pointer-events:none}
.dsh-kanban .kb-flow-creation-line{fill:none;stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:1.6;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}
.dsh-kanban .kb-flow-creation-route{fill:none;stroke:var(--dsw-alias-state-business-primary,CanvasText);stroke-width:1.8;vector-effect:non-scaling-stroke}
.dsh-kanban .kb-flow-creation-arrow{fill:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-flow-creation-tip{fill:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-condition-popover{position:fixed;z-index:70;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 16px);overflow:auto;padding:12px;border:1px solid var(--kb-line);border-radius:10px;background:var(--kb-surface);box-shadow:0 14px 34px #00000026;font:inherit;color:inherit}
.dsh-kanban .kb-condition-popover .kb-condition-field{max-height:40vh}
.dsh-kanban .kb-flow-shell:focus{outline:none}
.dsh-kanban .kb-flow-shell:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:-2px}
.dsh-kanban .kb-condition-popover-head{font-size:12px;line-height:1.35;overflow-wrap:anywhere}
/* The transit rides the connection the diagram already draws: each particle follows
   the same SVG path, so the drawing and the movement can never disagree. The path,
   the duration, the delay, and the diameter arrive as custom properties per particle;
   the CSS rule owns the timing, so a re-render cannot restart a running transit. */
.dsh-kanban .kb-flow-transit{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:8}
.dsh-kanban .kb-flow-transit-particle{position:absolute;left:0;top:0;width:var(--kb-transit-size,12px);height:var(--kb-transit-size,12px);border-radius:50%;background:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 calc(var(--kb-transit-size,12px) * 1.5) color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 45%,transparent);offset-path:var(--kb-transit-path);offset-distance:0%;offset-rotate:0deg;offset-anchor:center;opacity:0;animation-name:kb-flow-transit-run;animation-duration:var(--kb-transit-duration,450ms);animation-delay:var(--kb-transit-delay,0ms);animation-timing-function:linear;animation-fill-mode:backwards}
.dsh-kanban .kb-flow-transit-particle.is-core{box-shadow:0 0 calc(var(--kb-transit-size,12px) * 2.1) color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 60%,transparent)}
@keyframes kb-flow-transit-run{from{offset-distance:0%;opacity:0}12%{opacity:1}88%{opacity:1}to{offset-distance:100%;opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-flow-transit{display:none}}
.dsh-kanban .kb-flow-canvas .react-flow__attribution{background:transparent;color:inherit;opacity:.55}
.dsh-kanban .kb-flow-canvas .react-flow__attribution a{color:inherit}
`;