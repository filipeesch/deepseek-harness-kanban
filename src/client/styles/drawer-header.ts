/** Task drawer header presentation; concatenated into the board styles. */
export const drawerHeaderStyles = String.raw`
.dsh-kanban .kb-drawer{container-type:inline-size}
.dsh-kanban .kb-drawer-header{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"nav title stage actions";align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--kb-line);flex-shrink:0;min-width:0}
.dsh-kanban .kb-icon-tabs{grid-area:nav;display:flex;align-items:center;gap:2px;min-width:0}
.dsh-kanban .kb-icon-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:3px;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer;flex:0 0 auto}
.dsh-kanban .kb-icon-tab:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.dsh-kanban .kb-icon-tab[aria-selected=true]{background:var(--kb-soft);color:var(--dsw-alias-state-business-primary,CanvasText)}
.dsh-kanban .kb-icon-tab[aria-selected=true]::after{content:'';position:absolute;left:6px;right:6px;bottom:1px;height:2px;border-radius:1px;background:currentColor}
.dsh-kanban .kb-icon-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:1px}
.dsh-kanban .kb-activity-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor));animation:kb-working-pulse 1.4s ease-in-out infinite;flex:0 0 6px}
.dsh-kanban .kb-drawer-title{grid-area:title;display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;overflow:hidden}
.dsh-kanban .kb-drawer-title h2{font-size:16px;font-weight:650;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;margin:0}
.dsh-kanban .kb-drawer-project{flex:0 1 auto;min-width:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--kb-line);border-radius:999px;padding:1px 5px;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;opacity:.72;background:var(--kb-soft)}
.dsh-kanban .kb-drawer-stage{grid-area:stage;display:flex;align-items:center;gap:4px;min-width:0}
.dsh-kanban .kb-stage-control{display:flex;align-items:center;min-width:0}
.dsh-kanban .kb-stage-select{font-size:12px;padding:4px 6px;max-width:150px;min-width:0}
.dsh-kanban .kb-stage-advance{width:28px;height:28px;min-width:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px}
.dsh-kanban .kb-drawer-header-actions{grid-area:actions;display:flex;align-items:center;gap:4px;flex:0 0 auto}
.dsh-kanban .kb-drawer-header-actions .kb-icon-button{width:32px;height:32px;min-width:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;flex:0 0 32px}
.dsh-kanban .kb-auto-chip-header{height:24px;padding:0 6px 0 5px;font-size:10px;opacity:1}
.dsh-kanban .kb-worktree-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:8px 12px;padding:6px 10px;border:1px solid var(--kb-line);border-radius:8px;background:var(--kb-soft);font-size:12px;flex-shrink:0}
.dsh-kanban .kb-worktree-line-summary{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 240px;overflow:hidden}
.dsh-kanban .kb-worktree-line-summary strong{flex:0 0 auto;font-size:12px;font-weight:650}
.dsh-kanban .kb-worktree-line-facts{display:flex;align-items:center;gap:2px;min-width:0;opacity:.78;overflow:hidden}
.dsh-kanban .kb-worktree-line-facts code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:180px}
.dsh-kanban .kb-worktree-line-actions{flex:1 1 auto;min-width:0;flex-wrap:wrap;gap:4px}
.dsh-kanban .kb-worktree-line .kb-error{flex-basis:100%}
@container (max-width:560px){.dsh-kanban .kb-drawer-header{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title actions" "nav stage";gap:6px 8px;padding:8px 10px}.dsh-kanban .kb-drawer-title{justify-content:flex-start}.dsh-kanban .kb-drawer-project{max-width:50%}.dsh-kanban .kb-stage-select{max-width:132px}}
@media(prefers-reduced-motion:reduce){.dsh-kanban .kb-activity-dot{animation:none;opacity:1}}
`;
