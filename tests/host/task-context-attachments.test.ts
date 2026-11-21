import { describe, expect, it } from 'vitest';
import { buildAttachmentSection, TASK_ATTACHMENT_BUDGET } from '../../src/host/task-attachment-section.js';
import { createTaskContextMessage, FIRST_CONTACT_LABEL } from '../../src/host/task-context.js';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from '../../src/domain/workflow.js';
import type { Board, Task } from '../../src/shared/types.js';

function task(): Task {
  return { id: 'task-1', projectId: 'p', title: 'Evidence', description: 'Body', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
const board: Board = { id: 'board', name: 'Board', workflowYaml: DEFAULT_WORKFLOW_YAML, workflow: parseWorkflow(DEFAULT_WORKFLOW_YAML), createdAt: '', updatedAt: '' };
const contextText = (attachments?: Array<{ name: string; bytes: number; path: string }>): string =>
  createTaskContextMessage({ task: task(), board, hub: { id: 'hub', name: 'Hub' }, ...(attachments === undefined ? {} : { attachments }) })
    .content.map(block => ('text' in block ? block.text : '')).join('');
const attachment = (index: number) => ({ name: 'file-' + index + '.csv', bytes: 10, path: '/attachments/task-1/file-' + index + '.csv' });

describe('task context attachment listing', () => {
  it('names each attachment with its size and readable path', () => {
    const section = buildAttachmentSection([attachment(1), attachment(2)]);
    expect(section).toContain('file-1.csv');
    expect(section).toContain('/attachments/task-1/file-1.csv');
    expect(section).toContain('10 bytes');
  });

  it('renders nothing when the task carries no files', () => {
    expect(buildAttachmentSection([])).toBe('');
  });

  it('reports how many files a tight budget omitted instead of dropping them silently', () => {
    const many = Array.from({ length: 40 }, (_, index) => attachment(index));
    const section = buildAttachmentSection(many, 400);
    expect(section).toMatch(/more attachments omitted for length/);
    expect(section).toContain('get_card');
  });

  it('lists every attachment while it fits the default budget', () => {
    const text = contextText(Array.from({ length: 60 }, (_, index) => attachment(index)));
    // The snapshot label is what tells the agent it received the stage record at all.
    expect(text).toContain('Workflow first-contact snapshot');
    expect(text).toContain('Task attachments');
    // Sixty files fit the section budget, so none is reported omitted.
    expect(text).not.toContain('omitted for length');
  });

  it('keeps the workflow map when attachments exceed their own budget', () => {
    const text = contextText(Array.from({ length: 300 }, (_, index) => attachment(index)));
    expect(text).toContain('omitted for length');
    // The workflow map keeps its own budget, so the file list cannot evict it.
    expect(text).toContain('Workflow first-contact snapshot');
    expect(text).toContain('Stages in workflow order');
  });

  it('gives the workflow map the same text whatever the attachment listing holds', () => {
    const mapOf = (text: string): string => text.slice(text.indexOf(FIRST_CONTACT_LABEL) + FIRST_CONTACT_LABEL.length);
    const long = contextText(Array.from({ length: 300 }, (_, index) => attachment(index)));
    expect(mapOf(long)).toBe(mapOf(contextText()));
    const section = long.slice(long.indexOf('Task attachments'), long.indexOf(FIRST_CONTACT_LABEL));
    expect(Buffer.byteLength(section)).toBeLessThanOrEqual(TASK_ATTACHMENT_BUDGET + 2);
  });

  it('sends no attachment section when the task has none', () => {
    expect(contextText()).not.toContain('Task attachments');
  });

  it('never exceeds the budget it was given, footer included', () => {
    const many = Array.from({ length: 60 }, (_, index) => attachment(index));
    for (const budget of [200, 400, 800, 2048]) {
      const section = buildAttachmentSection(many, budget);
      expect(Buffer.byteLength(section)).toBeLessThanOrEqual(budget);
    }
  });

  it('lists a later short file even after an oversized name', () => {
    const long = { name: 'x'.repeat(1200) + '.csv', bytes: 1, path: '/attachments/task-1/long.csv' };
    const section = buildAttachmentSection([long, attachment(1)], 600);
    expect(section).toContain('file-1.csv');
    expect(section).toContain('omitted for length');
  });
});
