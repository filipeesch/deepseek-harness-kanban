/** Working and background activity presentation; concatenated into the board styles. */
export const activityStyles = String.raw`
.dsh-kanban .kb-execution{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:11px;min-height:18px}
.dsh-kanban .kb-working{display:inline-flex;align-items:center;gap:6px;font-weight:650;letter-spacing:.03em;color:var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor))}
.dsh-kanban .kb-working-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 7px;animation:kb-working-pulse 1.4s ease-in-out infinite}
.dsh-kanban .kb-background:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-background{display:inline-flex;align-items:center;border:1px solid var(--kb-line);border-radius:999px;padding:1px 7px;font-size:10.5px;opacity:.72;background:var(--kb-soft);white-space:nowrap}
.dsh-kanban .kb-task-background{font-size:11px;opacity:.7;overflow-wrap:anywhere}
.dsh-kanban .kb-execution-drawer{gap:6px;margin-top:7px;min-height:0}
.dsh-kanban .kb-execution-drawer .kb-working{font-size:10.5px}
.dsh-kanban .kb-card-meta{display:flex;align-items:center;gap:8px;min-width:0;min-height:18px}
.dsh-kanban .kb-card-project{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}
.dsh-kanban .kb-card-signals{display:flex;align-items:center;gap:7px;flex:0 0 auto;margin-left:auto;font-size:11px;position:relative;z-index:2;pointer-events:auto}
.dsh-kanban .kb-attention:empty{display:none}
.dsh-kanban .kb-card[data-working=true]{box-shadow:inset 3px 0 0 var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor)),0 2px 4px #00000008}
@keyframes kb-working-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.dsh-kanban .kb-working-dot{animation:none;opacity:1}}
`;
