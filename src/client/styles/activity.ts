/** Working and background activity presentation; concatenated into the board styles. */
export const activityStyles = String.raw`
.dsh-kanban .kb-tab-running{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;line-height:1;letter-spacing:normal;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,currentColor));flex:0 0 auto}
.dsh-kanban .kb-tab-running-ring{box-sizing:border-box;width:9px;height:9px;border-radius:50%;border:2px solid currentColor;background:transparent;flex:0 0 9px;animation:kb-working-pulse 1.4s ease-in-out infinite}
.dsh-kanban .kb-tab-running-count{min-width:1ch}
@keyframes kb-working-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@keyframes kb-working-bar{0%,100%{opacity:.4}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.dsh-kanban .kb-tab-running-ring{animation:none;opacity:1}.dsh-kanban .kb-activity-dot{animation:none;opacity:1}}
`;
