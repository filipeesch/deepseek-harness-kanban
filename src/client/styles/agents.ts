/** The board's agents list: a pinned main row and one collapsible row per agent. */
export const agentsStyles = `
.kb-agent-row { display: grid; gap: 8px; border: 1px solid var(--kb-border); border-radius: 8px; padding: 8px 10px; }
.kb-agent-header { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline; width: 100%; padding: 2px 0; background: none; border: 0; color: inherit; text-align: left; cursor: pointer; }
.kb-agent-chevron { opacity: 0.7; }
.kb-agent-title { font-weight: 600; }
.kb-agent-summary { color: var(--kb-muted); font-size: 0.9em; }
.kb-agent-fields { display: grid; gap: 10px; }
.kb-agent-footer { display: grid; gap: 6px; }
`;
