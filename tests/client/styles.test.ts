import { describe, expect, it } from 'vitest';
import { styles } from '../../src/client/styles.js';

describe('board and editor style contracts', () => {
  it('gives workflow columns content-driven heights instead of an equal share', () => {
    expect(styles).toContain('.kb-column{');
    expect(styles).toContain('flex:0 0 auto');
    expect(styles).not.toMatch(/\.kb-column\{[^}]*flex:1[;}]/);
  });
  it('defines the wide workflow dialog, code surface, and diagnostic summary', () => {
    for (const selector of ['.kb-dialog-wide', '.kb-workflow-surface', '.kb-workflow-editor-head', '.kb-issues', '.kb-code-editor', '.kb-editor-maximize']) expect(styles).toContain(selector);
  });
  it('defines symmetric drawer keyframes and reduced-motion handling', () => {
    for (const value of ['@keyframes kb-drawer-enter', '@keyframes kb-drawer-exit', '[data-entering=true]', '[data-closing=true]', 'prefers-reduced-motion:reduce']) expect(styles).toContain(value);
  });
  it('defines the working and background activity contract on host tokens', () => {
    for (const value of ['.kb-working{', '.kb-working-dot', '.kb-background{', '.kb-background:focus-visible', '.kb-task-background', '.kb-card-meta', '.kb-card-signals', '.kb-card[data-working=true]', '@keyframes kb-working-pulse', '--dsw-alias-label-deep-diving']) expect(styles).toContain(value);
    expect(styles).not.toContain('.kb-running');
  });
});

describe('destructive and operation surfaces', () => {
  it('defines the status stack, consequence list, and problem disclosure', () => {
    for (const selector of ['.kb-status-stack', '.kb-operation-failed', '.kb-operation-facts', '.kb-destructive-dialog', '.kb-consequence-list', '.kb-problem-details', '.kb-problem-facts']) expect(styles).toContain(selector);
  });
});
