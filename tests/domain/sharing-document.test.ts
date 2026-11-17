import { describe, expect, it } from 'vitest';
import { boardDiffers, workflowDiffers, type BoardDocument } from '../../src/domain/sharing/document.js';

const NL = String.fromCharCode(10);
function text(lines: string[]): string { return lines.join(NL) + NL; }

const APPLIED = text([
  'name: Delivery',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    key: s1',
  '    label: Backlog',
  '  - id: review',
  '    key: a-stage-1',
  '    label: Review',
]);

/** The same document with the authored identity lines removed. */
const REQUESTED = APPLIED.split(NL).filter(line => !line.trim().startsWith('key:')).join(NL);

function document(overrides: Partial<BoardDocument> = {}): BoardDocument {
  return { workflow: APPLIED, name: 'Delivery', projectKeys: null, rank: 'i', presetMode: 'operator', ...overrides };
}

describe('workflow comparison', () => {
  it('treats a document without identity lines as the same workflow', () => {
    expect(REQUESTED).not.toBe(APPLIED);
    expect(workflowDiffers(REQUESTED, APPLIED)).toBe(false);
    expect(workflowDiffers(APPLIED, REQUESTED)).toBe(false);
  });

  it('treats a re-authored identity line as the same workflow', () => {
    expect(workflowDiffers(APPLIED.replace('key: a-stage-1', 'key: authored-2'), APPLIED)).toBe(false);
    expect(workflowDiffers(APPLIED, APPLIED.replace('key: a-stage-1', 'key: authored-2'))).toBe(false);
    expect(workflowDiffers(APPLIED.replace('key: a-stage-1', 'key: review'), APPLIED)).toBe(false);
  });

  it('sees a semantic edit, a description edit, and a layout edit', () => {
    expect(workflowDiffers(APPLIED.replace('label: Review', 'label: Checking'), APPLIED)).toBe(true);
    expect(workflowDiffers(APPLIED.replace('label: Review', 'label: Review' + NL + '    description: Details'), APPLIED)).toBe(true);
    expect(workflowDiffers(APPLIED.replace('    label: Review', '    label: Review' + NL + '    position: {x: 10, y: 20}'), APPLIED)).toBe(true);
  });

  it('ignores a comment or blank-description edit', () => {
    expect(workflowDiffers(APPLIED.replace('name: Delivery', '# Reviewed' + NL + 'name: Delivery'), APPLIED)).toBe(false);
    expect(workflowDiffers(APPLIED.replace('name: Delivery', 'name: Delivery' + NL + 'description: ""'), APPLIED)).toBe(false);
  });

  it('falls back to the authored bytes when a document cannot be read', () => {
    expect(workflowDiffers('not: [valid', APPLIED)).toBe(true);
    expect(workflowDiffers('not: [valid', 'not: [valid')).toBe(false);
  });
});

describe('board comparison', () => {
  it('reports every field that publishes beside the workflow', () => {
    const applied = document();
    expect(boardDiffers(applied, applied)).toBe(false);
    expect(boardDiffers(document({ name: 'Renamed' }), applied)).toBe(true);
    expect(boardDiffers(document({ projectKeys: ['app'] }), applied)).toBe(true);
    expect(boardDiffers(document({ rank: 'n' }), applied)).toBe(true);
    expect(boardDiffers(document({ presetMode: 'host' }), applied)).toBe(true);
    expect(boardDiffers(document({ presetMode: undefined }), applied)).toBe(true);
    expect(boardDiffers(document({ workflow: APPLIED.replace('label: Backlog', 'label: Inbox') }), applied)).toBe(true);
  });

  it('does not count record-only differences', () => {
    const applied = document();
    expect(boardDiffers(document({ workflow: REQUESTED }), applied)).toBe(false);
    expect(boardDiffers(document({ presetMode: 'operator' }), document({ presetMode: 'operator' }))).toBe(false);
  });
});
