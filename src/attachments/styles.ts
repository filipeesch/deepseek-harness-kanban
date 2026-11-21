/**
 * Attachment control styles shared by the task surfaces and the question strip.
 * Every colour, radius, and focus ring comes from the host theme tokens, so the
 * control follows light and dark appearance without a second palette.
 */
export const attachmentCss = String.raw`
.ka-attachment-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.ka-icon-button{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0.5px solid var(--dsw-alias-border-l2,var(--kb-line));border-radius:var(--dsw-radius-sm,7px);background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer}
.ka-icon-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,transparent)}
.ka-icon-button:disabled{opacity:.4;cursor:not-allowed}
.ka-icon-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.ka-chips{list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0;padding:0;min-width:0}
.ka-chip{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;padding:2px 4px 2px 7px;border:0.5px solid var(--dsw-alias-border-l2,var(--kb-line));border-radius:999px;background:var(--dsw-alias-bg-base,transparent);font-size:11.5px;line-height:1.6}
.ka-chip-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ka-chip-size{flex:none;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor)}
.ka-chip-remove{display:grid;place-items:center;flex:none;width:16px;height:16px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,currentColor);cursor:pointer}
.ka-chip-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,transparent);color:var(--dsw-alias-label-primary,currentColor)}
.ka-chip-remove:disabled{opacity:.4;cursor:not-allowed}
.ka-chip-remove:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:1px}
.ka-failure{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 12px;border-top:0.5px solid var(--dsw-alias-border-l1,var(--kb-line));background:var(--dsw-alias-state-error-tertiary,transparent);font-size:12px;line-height:1.4;color:var(--dsw-alias-state-error-primary,crimson)}
.ka-failure p{margin:0;flex:1 1 200px;min-width:0}
.ka-failure-actions{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}
@media(max-width:760px){.ka-chip{max-width:140px}}
`;
