/** Card movement, the exit-copy overlay, the drag preview, and the empty-column note; concatenated into the board styles. */
export const motionStyles = String.raw`
.dsh-kanban .kb-columns{position:relative}
.dsh-kanban .kb-motion-overlay{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;z-index:2}
.dsh-kanban .kb-card.kb-card-gliding{z-index:3}
.dsh-kanban .kb-card.kb-drag-ghost{position:fixed;pointer-events:none;z-index:9999;opacity:.9;box-shadow:0 8px 24px #0000002e;transform:rotate(1.5deg)}
.dsh-kanban .kb-empty-column{animation:kb-empty-column-enter 120ms ease-out 100ms both}
/* The arrival pulse a card presents once a transit reaches it. It is a keyed child, so
   a new arrival remounts it and replays the animation without re-keying the card: focus,
   drag, and click activation survive. It is inert and changes no layout. */
.dsh-kanban .kb-card-arrival{position:absolute;inset:0;z-index:2;border-radius:inherit;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 10%,transparent);box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,CanvasText),0 0 18px 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 45%,transparent);animation:kb-card-arrival 520ms ease-out forwards}
@keyframes kb-card-arrival{from{opacity:0;transform:scale(.98)}30%{opacity:.95;transform:scale(1.01)}to{opacity:0;transform:scale(1.03)}}
@keyframes kb-empty-column-enter{from{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-motion-overlay{display:none}.dsh-kanban .kb-empty-column{animation:none}.dsh-kanban .kb-card-arrival{display:none}}
`;
