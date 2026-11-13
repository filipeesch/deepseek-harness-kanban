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
.dsh-kanban .kb-card-actions{margin-left:auto;display:flex;align-items:center;gap:4px;position:relative;z-index:2;flex:0 0 auto}
.dsh-kanban .kb-card-run{display:flex;align-items:center;gap:2px;position:relative;z-index:2;flex:0 0 auto}
.dsh-kanban .kb-card-action{padding:0 7px;min-width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--kb-line);border-radius:999px;background:var(--kb-soft);color:inherit;font:inherit;cursor:pointer}
.dsh-kanban .kb-card-countdown{position:relative;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;min-width:26px;height:26px;overflow:hidden;font:inherit;font-size:12px;line-height:1;background:var(--kb-soft);border:1px solid var(--kb-line);border-radius:7px;cursor:pointer;color:inherit}
.dsh-kanban .kb-card-countdown:hover{background:color-mix(in srgb,currentColor 10%,var(--kb-surface))}
.dsh-kanban .kb-countdown-bar{position:absolute;left:0;bottom:0;height:2px;background:var(--kb-state-running);transition:width .25s linear}
.dsh-kanban .kb-countdown-label,.dsh-kanban .kb-countdown-cancel{position:relative;z-index:1;font-variant-numeric:tabular-nums}
.dsh-kanban .kb-countdown-cancel{font-size:14px;line-height:1}
.dsh-kanban .kb-card-status{display:flex;flex-direction:column;gap:3px;min-width:0;pointer-events:none}
.dsh-kanban .kb-card-parameters{display:flex;align-items:center;gap:6px;min-width:0;pointer-events:auto;position:relative;z-index:3}
.dsh-kanban .kb-card-parameters-values{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.35;opacity:.78}
.dsh-kanban .kb-card-parameter-edit{flex:0 0 auto;padding:0;border:0;background:none;color:inherit;font:inherit;font-size:11px;line-height:1.35;text-decoration:underline;cursor:pointer;opacity:.8}
.dsh-kanban .kb-card-status-line{display:flex;align-items:flex-start;gap:5px;margin:0;font-size:11px;line-height:1.35;overflow-wrap:anywhere}
.dsh-kanban .kb-card-status-line svg{flex:0 0 auto;margin-top:1px}
.dsh-kanban .kb-card-status-line.is-danger{color:color-mix(in srgb,var(--color-destructive,#c53030) 65%,var(--dsw-alias-label-primary,CanvasText))}
.dsh-kanban .kb-card-status-line.is-pending{color:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 70%,var(--dsw-alias-label-primary,CanvasText))}
.dsh-kanban .kb-card[data-working=true]::after{content:'';position:absolute;top:0;bottom:0;right:0;width:3px;border-radius:0 8px 8px 0;background:var(--kb-state-running);pointer-events:none;animation:kb-working-bar 1.4s ease-in-out infinite}
.dsh-kanban .kb-auto-chip{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;height:26px;padding:0 9px 0 7px;border:1px solid var(--kb-line);border-radius:999px;background:var(--kb-soft);color:inherit;font:inherit;font-size:9.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;opacity:.72;cursor:pointer;position:relative;z-index:3}
.dsh-kanban .kb-auto-chip svg{flex:0 0 auto}
.dsh-kanban .kb-auto-chip:hover{opacity:1}
.dsh-kanban .kb-auto-chip.is-on{opacity:1;border-color:color-mix(in srgb,var(--kb-state-running) 55%,var(--kb-line));background:color-mix(in srgb,var(--kb-state-running) 16%,var(--kb-surface))}
.dsh-kanban .kb-auto-chip.is-paused::after{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.75}
.dsh-kanban .kb-auto-chip.is-advancing::after{content:'';width:5px;height:5px;border-radius:50%;background:var(--kb-state-running);animation:kb-auto-pulse 1.2s ease-in-out infinite}
.dsh-kanban .kb-auto-chip.is-held{border-style:dotted}
.dsh-kanban .kb-auto-chip.is-held::after{content:'';width:5px;height:5px;border-radius:50%;border:1px solid currentColor;box-sizing:border-box;opacity:.85}
@keyframes kb-auto-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dsh-kanban .kb-auto-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.dsh-kanban .kb-auto-chip:disabled{opacity:.45;cursor:default}
/* The card's surface presents one attention state; its marks present all of them, so a
   painted card never hides a state behind the one that wins. The mix keeps the host
   surface underneath, so both appearances stay legible. */
.dsh-kanban .kb-card[data-presence=error]{background:color-mix(in srgb,var(--kb-state-error) var(--kb-state-tint),var(--kb-surface))}
.dsh-kanban .kb-card[data-presence=attention]{background:color-mix(in srgb,var(--kb-state-attention) var(--kb-state-tint),var(--kb-surface))}
.dsh-kanban .kb-card[data-presence=approval]{background:color-mix(in srgb,var(--kb-state-attention) var(--kb-state-tint),var(--kb-surface))}
.dsh-kanban .kb-card[data-presence=running]{background:color-mix(in srgb,var(--kb-state-running) var(--kb-state-tint),var(--kb-surface))}
.dsh-kanban .kb-card[data-presence=unread]{background:color-mix(in srgb,var(--kb-state-unread) var(--kb-state-tint),var(--kb-surface))}
/* The diagram publishes the bounded inverse of its zoom on the canvas; the column
   board keeps the fallback, so the marks only change size where they must. */
.dsh-kanban .kb-card .kb-attention-dots{transform:scale(var(--kb-mark-scale,1));transform-origin:right center}
/* Agent execution keeps the trailing bar and adds the border, so running stays
   distinguishable from unread once reduced motion removes the pulse. The pulse rides a
   pseudo-element, which keeps the card element itself free of animation for the board's
   motion bookkeeping. */
.dsh-kanban .kb-card[data-working=true]{border-color:var(--kb-state-running)}
.dsh-kanban .kb-card[data-working=true]::before{content:'';position:absolute;inset:0;border:1px solid var(--kb-state-running);border-radius:8px;pointer-events:none;animation:kb-working-frame 1.4s ease-in-out infinite}
@keyframes kb-working-frame{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-countdown-bar{display:none}.dsh-kanban .kb-auto-chip.is-advancing::after{animation:none;opacity:1}.dsh-kanban .kb-card[data-working=true]::before{animation:none;opacity:1}.dsh-kanban .kb-card[data-working=true]::after{animation:none;opacity:1}}
.dsh-kanban .kb-approval-queue{display:flex;flex-direction:column;gap:6px;margin:8px 0;padding:9px 11px;border:1px solid color-mix(in srgb,var(--kb-state-attention) 42%,var(--kb-line));border-radius:8px;background:color-mix(in srgb,var(--kb-state-attention) 8%,var(--kb-surface))}
.dsh-kanban .kb-approval-title{font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.dsh-kanban .kb-approval-item{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;font-size:12px;min-width:0}
.dsh-kanban .kb-approval-item span{min-width:0;overflow-wrap:anywhere}
.dsh-kanban .kb-script-panel-tools{display:flex;gap:6px;flex-wrap:wrap}
.dsh-kanban .kb-script-consequence{padding:7px 9px;border-left:3px solid var(--kb-state-attention);border-radius:4px;background:color-mix(in srgb,var(--kb-state-attention) 10%,var(--kb-surface));font-weight:600}
.dsh-kanban .kb-code-view{border:1px solid var(--kb-line);border-radius:7px;background:color-mix(in srgb,currentColor 4%,var(--kb-surface));max-height:340px;overflow:auto}
.dsh-kanban .kb-code-view .cm-editor{max-height:340px}
.dsh-kanban .kb-code-view:focus-visible,.dsh-kanban .kb-code-view .cm-content:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
`;
