/**
 * Attention color tokens. One declaration feeds the card surface, the attention
 * marks, the Hub and board tabs, and the conversation tabs, so one state can never
 * read as two different colors on one screen.
 */
export const tokenStyles = String.raw`
.dsh-kanban{--kb-state-unread:#3b82f6;--kb-state-attention:#ed8936;--kb-state-error:#e53e3e;--kb-state-running:var(--dsw-alias-label-deep-diving,var(--dsw-alias-state-business-primary,#3b82f6));--kb-state-tint:12%}
[data-ds-dark-theme] .dsh-kanban{--kb-state-tint:14%}
`;
