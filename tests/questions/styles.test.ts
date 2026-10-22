import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { questionCss } from '../../src/questions/styles.js';

describe('question strip styles', () => {
  it('uses host theme tokens for surfaces, states, radii and focus', () => {
    for (const token of ['--dsw-alias-bg-base', '--dsw-alias-border-l1', '--dsw-alias-interactive-bg-hover', '--dsw-alias-state-business-tertiary', '--dsw-alias-state-warn-tertiary', '--dsw-alias-state-success-tertiary', '--dsw-alias-button-primary-fill', '--dsw-radius-lg', '--dsw-focus-ring-width']) expect(questionCss).toContain(token);
  });
  it('keeps a visible host focus ring on interactive controls', () => {
    for (const selector of ['.kq-header:focus-visible', '.kq-primary:focus-visible', '.kq-secondary:focus-visible', '.kq-question:focus-visible', '.kq-option:focus-within', '.kq-input:focus-visible']) expect(questionCss).toContain(selector);
    expect(questionCss).toContain('var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color');
  });
  it('carries no fixed light-only colours from the previous card', () => {
    for (const legacy of ['#fff', '#d4d4d8', '#7c3aed', '#b91c1c', '--background-color', '--border-color']) expect(questionCss).not.toContain(legacy);
  });
  it('leaves no deprecated question styles in the client entry', () => {
    const client = readFileSync(new URL('../../src/client.tsx', import.meta.url), 'utf8');
    expect(client).not.toContain('kanban-question-form');
    expect(client).not.toContain('kanban-decision-summary');
    expect(client).not.toContain('--background-color');
  });
});
