/** Conversation workspace: the embedded window and the right Sidebar rail share one row. */
export const workspaceStyles = String.raw`
.dsh-kanban .kb-workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.dsh-kanban .kb-workspace-conversation{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
.dsh-kanban .kb-workspace-divider{position:relative;flex:0 0 8px;cursor:col-resize;background:transparent;outline:none;touch-action:none}
.dsh-kanban .kb-workspace-divider:hover,.dsh-kanban .kb-workspace-divider:focus-visible{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 45%,transparent)}
.dsh-kanban .kb-workspace-divider::after{content:'';position:absolute;left:50%;top:50%;width:2px;height:24px;margin:-12px 0 0 -1px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 55%,transparent);opacity:0;transition:opacity .12s ease}
.dsh-kanban .kb-workspace-divider:hover::after,.dsh-kanban .kb-workspace-divider:focus-visible::after{opacity:1}
.dsh-kanban .kb-workspace-rail{display:flex;flex:0 0 auto;min-width:0;min-height:0;flex-direction:column;overflow:hidden;border-left:1px solid var(--kb-line);background:var(--kb-surface)}
.dsh-kanban .kb-workspace-rail>*{flex:1;min-height:0;min-width:0}
.dsh-kanban .kb-workspace[data-workspace-mode=cover] .kb-workspace-rail{position:absolute;inset:0;z-index:2;width:auto;border-left:0;box-shadow:-10px 0 24px #00000026}
.dsh-kanban .kb-workspace-failure{position:absolute;left:10px;right:10px;top:10px;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid #c53030;border-radius:8px;background:var(--kb-surface);box-shadow:0 8px 24px #0002;font-size:12.5px}
.dsh-kanban .kb-workspace-failure span{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.dsh-kanban .kb-workspace-divider{transition:none}}
`;
