import { describe, expect, it } from 'vitest';
import { styles } from '../../src/client/styles.js';

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
});
