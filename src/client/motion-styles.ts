/** Card movement, the exit-copy overlay, the drag preview, and the empty-column note; concatenated into the board styles. */
export const motionStyles = String.raw`
.dsh-kanban .kb-columns{position:relative}
.dsh-kanban .kb-motion-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2}
.dsh-kanban .kb-card.kb-card-gliding{z-index:3}
.dsh-kanban .kb-card.kb-drag-ghost{position:fixed;pointer-events:none;z-index:9999;opacity:.9;box-shadow:0 8px 24px #0000002e;transform:rotate(1.5deg)}
.dsh-kanban .kb-empty-column{animation:kb-empty-column-enter 120ms ease-out 100ms both}
@keyframes kb-empty-column-enter{from{opacity:0}to{opacity:.6}}
@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-motion-overlay{display:none}.dsh-kanban .kb-empty-column{animation:none}}
`;
