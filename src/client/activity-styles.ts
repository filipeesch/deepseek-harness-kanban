/** Working and background activity presentation; concatenated into the board styles. */
export const activityStyles = String.raw`
.dsh-kanban .kb-execution{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:11px;min-height:18px}
.dsh-kanban .kb-working{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;letter-spacing:normal;color:var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor))}
.dsh-kanban .kb-working-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 7px;animation:kb-working-pulse 1.4s ease-in-out infinite}
.dsh-kanban .kb-task-background{font-size:11px;opacity:.7;overflow-wrap:anywhere}
.dsh-kanban .kb-execution-drawer{gap:6px;margin-top:7px;min-height:0}
@keyframes kb-working-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.dsh-kanban .kb-working-dot{animation:none;opacity:1}}
`;
