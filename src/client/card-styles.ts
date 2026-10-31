/** Card surface presentation; concatenated into the board styles. */
export const cardStyles = String.raw`
.dsh-kanban .kb-card{display:flex;flex-direction:column;gap:5px;border:1px solid var(--kb-line);border-radius:8px;background:var(--kb-surface);padding:10px;min-width:0;box-shadow:0 2px 4px #00000008;position:relative;cursor:pointer;touch-action:none}
.dsh-kanban .kb-card-open{border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:0;display:block;width:100%;min-width:0}
.dsh-kanban .kb-card-open::after{content:'';position:absolute;inset:0;z-index:1;border-radius:8px}
.dsh-kanban .kb-card-open strong{display:block;font-size:13px;line-height:1.45;overflow-wrap:anywhere}
.dsh-kanban .kb-card:has(.kb-card-open:focus-visible){outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-card-open:focus-visible{outline:none}
.dsh-kanban .kb-card-selected{outline:2px solid var(--dsw-alias-state-business-primary,CanvasText);outline-offset:-2px}
.dsh-kanban .kb-card-context{display:flex;align-items:center;gap:8px;min-width:0;min-height:16px;position:relative;z-index:2}
.dsh-kanban .kb-card-project{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.66}
.dsh-kanban .kb-card-select{position:relative;z-index:3;margin:0;flex:0 0 auto}
.dsh-kanban .kb-card-activity{display:flex;align-items:center;gap:7px;min-width:0;min-height:26px;flex-wrap:nowrap}
.dsh-kanban .kb-card-run{margin-left:auto;display:flex;align-items:center;gap:2px;position:relative;z-index:2;flex:0 0 auto}
.dsh-kanban .kb-background{display:inline-flex;align-items:center;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--kb-line);border-radius:999px;padding:1px 7px;font-size:10.5px;opacity:.72;background:var(--kb-soft);white-space:nowrap;position:relative;z-index:2;flex:0 1 auto}
.dsh-kanban .kb-background:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-card-action{padding:2px 6px;min-width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center}
.dsh-kanban .kb-card-countdown{position:relative;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;min-width:26px;height:26px;overflow:hidden;font:inherit;font-size:12px;line-height:1;background:var(--kb-soft);border:1px solid var(--kb-line);border-radius:7px;cursor:pointer;color:inherit}
.dsh-kanban .kb-card-countdown:hover{background:color-mix(in srgb,currentColor 10%,var(--kb-surface))}
.dsh-kanban .kb-countdown-bar{position:absolute;left:0;bottom:0;height:2px;background:var(--dsw-alias-state-business-primary,#3b82f6);transition:width .25s linear}
.dsh-kanban .kb-countdown-label,.dsh-kanban .kb-countdown-cancel{position:relative;z-index:1;font-variant-numeric:tabular-nums}
.dsh-kanban .kb-countdown-cancel{font-size:14px;line-height:1}
.dsh-kanban .kb-card-status{display:flex;flex-direction:column;gap:3px;min-width:0;pointer-events:none}
.dsh-kanban .kb-card-status-line{display:flex;align-items:flex-start;gap:5px;margin:0;font-size:11px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-card-status-line svg{flex:0 0 auto;margin-top:1px}
.dsh-kanban .kb-card-status-line.is-danger{color:color-mix(in srgb,var(--color-destructive,#c53030) 65%,var(--dsw-alias-label-primary,CanvasText))}
.dsh-kanban .kb-card-status-line.is-pending{color:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 70%,var(--dsw-alias-label-primary,CanvasText))}
.dsh-kanban .kb-card[data-working=true]{box-shadow:inset 3px 0 0 var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor)),0 2px 4px #00000008}
.dsh-kanban .kb-card-context .kb-card-project + .kb-auto-chip{margin-left:2px}
.dsh-kanban .kb-auto-chip{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;height:18px;padding:0 6px 0 4px;border:1px solid var(--kb-line);border-radius:999px;background:var(--kb-soft);color:inherit;font:inherit;font-size:9.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;opacity:.72;cursor:pointer;position:relative;z-index:3}
.dsh-kanban .kb-auto-chip svg{flex:0 0 auto}
.dsh-kanban .kb-auto-chip:hover{opacity:1}
.dsh-kanban .kb-auto-chip.is-on{opacity:1;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 55%,var(--kb-line));background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 16%,var(--kb-surface))}
.dsh-kanban .kb-auto-chip.is-paused::after{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.75}
.dsh-kanban .kb-auto-chip.is-advancing::after{content:'';width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#3b82f6);animation:kb-auto-pulse 1.2s ease-in-out infinite}
@keyframes kb-auto-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dsh-kanban .kb-auto-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-auto-chip:disabled{opacity:.45;cursor:default}
@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-countdown-bar{display:none}.dsh-kanban .kb-auto-chip.is-advancing::after{animation:none;opacity:1}}
`;
