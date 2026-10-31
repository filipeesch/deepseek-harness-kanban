/**
 * Question strip styles. Every colour, radius, and focus ring comes from the
 * host theme tokens, so the strip follows light and dark appearance without a
 * second palette. Selectors stay scoped to the plugin's kq- classes.
 */
export const questionCss = String.raw`
.kq-strip{box-sizing:border-box;display:flex;flex-direction:column;flex:none;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;min-width:0;overflow:hidden;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu,Canvas);color:var(--dsw-alias-label-primary,inherit);font:inherit;color-scheme:inherit;box-shadow:var(--dsw-elevation-panel,none)}
.kq-strip[hidden]{display:none}
.kq-header{display:flex;align-items:center;gap:8px;flex:1;min-width:0;min-height:34px;padding:5px 12px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.kq-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kq-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,currentColor)}
.kq-progress{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-chevron{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary,currentColor);transition:transform .15s}
.kq-chevron[data-open=true]{transform:rotate(180deg)}
.kq-panel{display:flex;flex-direction:column;min-height:0;border-top:0.5px solid var(--dsw-alias-border-l1)}
.kq-scroll{display:flex;flex-direction:column;gap:10px;max-height:min(52vh,520px);overflow-y:auto;overscroll-behavior:contain;padding:10px 12px}
.kq-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-top:0.5px solid var(--dsw-alias-border-l1);flex-shrink:0}.kq-footer-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-left:auto}.kq-confirm-text{margin:0;flex:1 1 180px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary,currentColor)}.kq-dismiss{flex:none}.kq-dismiss-confirm{color:var(--dsw-alias-state-error-primary,crimson);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,crimson) 40%,transparent)}
.kq-status{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-step{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-context{padding-bottom:6px;border-bottom:0.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,currentColor)}
.kq-context :where(p,ul,ol),.kq-desc :where(p,ul,ol){margin:0 0 .5em}
.kq-context :where(p,ul,ol):last-child,.kq-desc :where(p,ul,ol):last-child{margin-bottom:0}
.kq-slide{display:flex;flex-direction:column;gap:10px;min-width:0}
.kq-question-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px}
.kq-question{margin:0;font-size:14px;font-weight:500;line-height:1.45;color:var(--dsw-alias-label-primary,currentColor)}
.kq-question :where(p,ul,ol){margin:0}
.kq-weight{flex:none;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.kq-weight-critical{background:var(--dsw-alias-state-warn-tertiary,transparent);color:var(--dsw-alias-state-warn-label,currentColor)}
.kq-weight-medium{background:var(--dsw-alias-state-business-tertiary,transparent);color:var(--dsw-alias-state-business-primary,currentColor)}
.kq-weight-easy{background:var(--dsw-alias-state-success-tertiary,transparent);color:var(--dsw-alias-state-success-primary,currentColor)}
.kq-lean{margin:0;font-size:12px;font-style:italic;line-height:1.45;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-options{display:flex;flex-direction:column;gap:2px;min-width:0;margin:0;padding:0;border:0}
.kq-options legend{margin-bottom:4px;padding:0;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,currentColor)}
.kq-option{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm);font-size:13px;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;user-select:none}
.kq-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kq-option[data-focused=true]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary,currentColor)}
.kq-option[data-selected=true] .kq-option-title{font-weight:500}
.kq-option input{flex:none;margin:0;accent-color:var(--dsw-alias-state-business-primary)}
.kq-option-title{flex:1;min-width:0;overflow-wrap:anywhere}
.kq-ai{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary,currentColor);font-size:10px;font-weight:600}
.kq-desc{box-sizing:border-box;min-height:88px;max-height:200px;overflow-y:auto;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base,Canvas);font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,currentColor)}
.kq-desc[data-other=true]{padding:0;overflow:hidden}
.kq-desc-body{min-width:0;overflow-wrap:anywhere}
.kq-desc-empty{margin:0;font-size:12px;font-style:italic;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-field{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,currentColor)}
.kq-input{box-sizing:border-box;width:100%;min-height:60px;padding:7px 9px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,currentColor);font:inherit;font-size:13px;line-height:1.5;resize:vertical}
.kq-input[data-fill=true]{height:100%;min-height:88px;border:0;border-radius:0;resize:none}
.kq-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,crimson)}
.kq-waiting{flex:1 1 100%;margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-tertiary,currentColor)}
.kq-new-page{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;padding:8px 10px;border-left:2px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-tertiary,transparent);font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary,currentColor)}
.kq-primary{flex:none;padding:6px 14px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.kq-primary:disabled{opacity:.4;cursor:not-allowed}
.kq-secondary{flex:none;padding:6px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:13px;cursor:pointer}
.kq-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kq-secondary:disabled{opacity:.4;cursor:not-allowed}
.kq-header:focus-visible,.kq-primary:focus-visible,.kq-secondary:focus-visible,.kq-question:focus-visible,.kq-input:focus-visible,.kq-dismiss-confirm:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText));outline-offset:2px}
.kq-option:focus-within{box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,CanvasText))}
@media(max-width:760px){.kq-scroll{max-height:60vh;padding:8px}.kq-footer{padding:6px 8px}.kq-confirm-text{font-size:11px}}
`;
