import { describe, expect, it } from 'vitest';
import { styles } from '../../src/client/styles/index.js';

describe('board and editor style contracts', () => {
  it('gives workflow columns content-driven heights instead of an equal share', () => {
    expect(styles).toContain('.kb-column{');
    expect(styles).toContain('flex:0 0 auto');
    expect(styles).not.toMatch(/\.kb-column\{[^}]*flex:1[;}]/);
  });
  it('uses 20% narrower default workflow columns', () => {
    expect(styles).toContain('.kb-column-slot{');
    expect(styles).toContain('min-width:208px;width:240px;flex:0 0 240px');
  });
  it('defines the wide workflow dialog, code surface, and diagnostic summary', () => {
    for (const selector of ['.kb-dialog-wide', '.kb-workflow-surface', '.kb-workflow-editor-head', '.kb-issues', '.kb-code-editor', '.kb-editor-maximize']) expect(styles).toContain(selector);
  });
  it('defines symmetric drawer keyframes and reduced-motion handling', () => {
    for (const value of ['@keyframes kb-drawer-enter', '@keyframes kb-drawer-exit', '[data-entering=true]', '[data-closing=true]', 'prefers-reduced-motion:reduce']) expect(styles).toContain(value);
  });
  it('defines the card regions, activity strip, and status tones on host tokens', () => {
    for (const value of ['.kb-working{', '.kb-working-dot', '.kb-background{', '.kb-background:focus-visible', '.kb-activity-dot', '.kb-icon-tab', '.kb-icon-tab:focus-visible', '.kb-drawer-title', '.kb-auto-chip-header', '@container (max-width:560px)', '.kb-card-context{', '.kb-card-project{', '.kb-card-activity{', '.kb-card-status{', '.kb-card-status-line.is-danger', '.kb-card-status-line.is-pending', '.kb-card[data-working=true]', '@keyframes kb-working-pulse', '--dsw-alias-label-deep-diving']) expect(styles).toContain(value);
    expect(styles).not.toContain('.kb-task-background');
    expect(styles).not.toContain('.kb-drawer-automode');
    expect(styles).not.toContain('.kb-running');
    expect(styles).not.toContain('.kb-card-meta');
    expect(styles).not.toContain('.kb-card-signals');
  });
  it('truncates the project label and never clamps the title', () => {
    expect(styles).toMatch(/\.kb-card-project\{[^}]*text-overflow:ellipsis/);
    expect(styles).toMatch(/\.kb-card-project\{[^}]*white-space:nowrap/);
    expect(styles).not.toContain('line-clamp');
  });
  it('defines the card motion overlay, glide stacking, and drag preview', () => {
    for (const value of ['.kb-columns{position:relative}', '.kb-motion-overlay{', '.kb-card.kb-card-gliding{', '.kb-card.kb-drag-ghost{', '@keyframes kb-empty-column-enter', '.kb-empty-column{animation:kb-empty-column-enter']) expect(styles).toContain(value);
    expect(styles).toMatch(/\.kb-motion-overlay\{[^}]*position:absolute/);
    expect(styles).toMatch(/\.kb-motion-overlay\{[^}]*overflow:hidden/);
    expect(styles).toMatch(/\.kb-motion-overlay\{[^}]*pointer-events:none/);
  });
  it('disables card motion under reduced motion', () => {
    const start = styles.indexOf('@media (prefers-reduced-motion: reduce){.dsh-kanban .kb-motion-overlay');
    expect(start).toBeGreaterThan(-1);
    expect(styles.slice(start)).toContain('.kb-empty-column{animation:none}');
  });
  it('defines the restricted-stage and override surface contract', () => {
    for (const value of ['.kb-stage-option-restricted{', '.kb-drop-restricted{', '.kb-drop-indicator-restricted{', '.kb-transition-dialog{', '.kb-transition-identity{']) expect(styles).toContain(value);
    expect(styles).not.toContain('.kb-drop-disabled');
  });
});

  it('hosts the conversation window and removes the task-context overlay layout', () => {
    expect(styles).toContain('.dsh-kanban .kb-conversation-window{');
    expect(styles).toContain('.dsh-kanban .kb-conversation-window>[data-kanban-conversation-window]{');
    expect(styles).toContain('.dsh-kanban .kb-task-context-fallback{');
    expect(styles).not.toContain('.kb-task-context{position:absolute');
    expect(styles).not.toContain('[data-conversation-content]>div>div:last-child');
  });

  it('replaces the inline closed block with the chip and popover', () => {
    expect(styles).toContain('.dsh-kanban .kb-closed-chip{');
    expect(styles).toContain('.dsh-kanban .kb-closed-popover{');
    expect(styles).not.toContain('.dsh-kanban .kb-closed{');
  });

describe('destructive and operation surfaces', () => {
  it('defines the status stack, consequence list, and problem disclosure', () => {
    for (const selector of ['.kb-status-stack', '.kb-operation-failed', '.kb-operation-facts', '.kb-destructive-dialog', '.kb-consequence-list', '.kb-problem-details', '.kb-problem-facts']) expect(styles).toContain(selector);
  });
});
