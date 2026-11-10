/**
 * The board header. One row carries the title, the Hub row, and the toolbar; the board
 * row is the second line. Every first-row control shares the Hub tab's line height so
 * the row reads as a single band.
 */
export const headerStyles = String.raw`
.dsh-kanban .kb-header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:18px 20px;padding-inline-start:max(20px,var(--dsh-frame-leading-clearance,20px));border-bottom:1px solid var(--kb-line);flex-shrink:0}
.dsh-kanban .kb-header h1{font-size:22px;font-weight:650;margin:0;flex:0 0 auto}
.dsh-kanban .kb-scope-row{display:flex;min-width:0}
.dsh-kanban .kb-hub-row{flex:1 1 auto}
.dsh-kanban .kb-board-row{flex:0 0 100%}
.dsh-kanban .kb-hub-tabs,.dsh-kanban .kb-board-tabs{display:flex;align-items:center;gap:3px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;min-width:0}
.dsh-kanban .kb-hub-tabs{min-height:32px}
.dsh-kanban .kb-hub-tab,.dsh-kanban .kb-board-tab{box-sizing:border-box;font:inherit;color:inherit;background:transparent;border:0;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.dsh-kanban .kb-hub-tab{height:32px;font-size:13px;padding:7px 10px;border-radius:6px 6px 0 0}
.dsh-kanban .kb-board-tab{font-size:12px;padding:5px 7px;border-radius:7px}
.dsh-kanban .kb-hub-tab:hover,.dsh-kanban .kb-board-tab:hover{background:var(--kb-soft)}
.dsh-kanban .kb-hub-tab.is-active{background:var(--kb-soft);border-bottom-color:var(--dsw-alias-state-business-primary,CanvasText);font-weight:600}
.dsh-kanban .kb-board-tab.is-active{background:var(--kb-soft);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,CanvasText);font-weight:600}
.dsh-kanban .kb-board-tabs{padding-left:2px;min-height:29px}
.dsh-kanban .kb-tab-add{font:inherit;font-size:16px;line-height:1;color:inherit;background:transparent;border:1px solid transparent;border-radius:6px;padding:3px 8px;cursor:pointer;opacity:.8}
.dsh-kanban .kb-tab-add:hover{background:var(--kb-soft);border-color:var(--kb-line);opacity:1}
.dsh-kanban .kb-toolbar{margin-left:auto}
.dsh-kanban .kb-control{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;cursor:pointer}
.dsh-kanban .kb-toolbar .kb-button.kb-control{height:32px;padding:0 10px;font-size:13px}
.dsh-kanban .kb-toolbar .kb-icon-button.kb-control{width:32px;padding:0}
.dsh-kanban .kb-view-switch{display:inline-flex;align-items:stretch;box-sizing:border-box;height:32px;border:1px solid var(--kb-line);border-radius:7px;overflow:hidden;background:var(--kb-soft)}
.dsh-kanban .kb-view-switch button{font:inherit;font-size:12px;color:inherit;background:transparent;border:0;padding:0 10px;cursor:pointer;line-height:1.3}
.dsh-kanban .kb-view-switch button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.dsh-kanban .kb-view-switch button[aria-pressed=true]{background:var(--dsw-alias-button-primary-fill,CanvasText);color:var(--dsw-alias-label-primary-foreground,Canvas)}
.dsh-kanban .kb-view-switch button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:-2px}
.dsh-kanban .kb-filter-trigger{position:relative}
.dsh-kanban .kb-filter-dot{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-filter-badge{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-state-business-primary,CanvasText);color:var(--dsw-alias-label-primary-foreground,Canvas);font-size:9px;font-weight:700;line-height:1;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.dsh-kanban .kb-filter-popover{box-sizing:border-box;width:min(300px,calc(100vw - 48px));display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--kb-surface);border:1px solid var(--kb-line);border-radius:10px;box-shadow:0 12px 32px #0003}
.dsh-kanban .kb-filter-popover .kb-field{min-width:0}
.dsh-kanban .kb-filter-popover select.kb-input{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.dsh-kanban .kb-filter-footer{display:flex;justify-content:flex-end;gap:6px}
.dsh-kanban .kb-filter-footer .kb-control{height:26px;width:26px;padding:0}
/* Once the toolbar takes the whole line, the funnel sits at the leading edge, so a
   trailing-aligned popover would be dragged off screen by the clipped page root. Anchor
   it to the leading edge of its trigger instead, inside the same breakpoint that moves
   the toolbar, so the two rules cannot drift apart silently. */
@media(max-width:760px){.dsh-kanban .kb-header{padding:12px;padding-inline-start:max(12px,var(--dsh-frame-leading-clearance,12px))}.dsh-kanban .kb-toolbar{width:100%;margin:0}.dsh-kanban .kb-toolbar .kb-popover.is-end{left:0;right:auto}}
`;
