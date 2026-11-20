import { describe, expect, it } from 'vitest';
import { addTaskAttachments, assertAttachmentRemoval, removeTaskAttachment, taskAttachments } from '../../src/domain/task-attachment.js';
import { HubStateSchema, StoredHubStateSchema } from '../../src/domain/hub-schema.js';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from '../../src/domain/workflow.js';
import type { HubTask } from '../../src/shared/types.js';

function task(): HubTask {
  return { id: 'task-1', boardId: 'board-1', projectId: 'p', title: 'T', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
const write = (id: string) => ({ id, name: id + '.txt', bytes: 3, origin: 'path' as const });

describe('task attachment records', () => {
  it('appends attachments in the supplied order', () => {
    const value = task();
    addTaskAttachments(value, [write('a'), write('b')]);
    expect(taskAttachments(value).map(attachment => attachment.id)).toEqual(['a', 'b']);
  });

  it('refuses an identity the task already holds', () => {
    const value = task();
    addTaskAttachments(value, [write('a')]);
    expect(() => addTaskAttachments(value, [write('a')])).toThrow(/already holds/);
  });

  it('refuses an unknown origin and a negative length', () => {
    const value = task();
    expect(() => addTaskAttachments(value, [{ ...write('a'), origin: 'bogus' as never }])).toThrow(/origin/);
    expect(() => addTaskAttachments(value, [{ ...write('a'), bytes: -1 }])).toThrow(/byte length/);
  });

  it('clears the collection when the last attachment leaves', () => {
    const value = task();
    addTaskAttachments(value, [write('a')]);
    removeTaskAttachment(value, 'a');
    expect(value.attachments).toBeUndefined();
  });

  it('requires confirmation to remove an attachment because bytes are destroyed', () => {
    const value = task();
    addTaskAttachments(value, [write('a')]);
    expect(() => assertAttachmentRemoval(value, 'a', undefined)).toThrow(/confirm/);
    expect(() => assertAttachmentRemoval(value, 'a', false)).toThrow(/confirm/);
    expect(assertAttachmentRemoval(value, 'a', true).id).toBe('a');
  });

  it('refuses removing an attachment the task does not hold', () => {
    expect(() => assertAttachmentRemoval(task(), 'missing', true)).toThrow(/does not hold/);
  });
});

const baseHub = (taskValue: unknown) => ({
  id: 'hub', name: 'Hub', revision: 0,
  projects: [{ id: 'p', name: 'P', projectPath: '/repo', projectKey: 'repo' }],
  boards: [{ id: 'board-1', name: 'B', workflowYaml: DEFAULT_WORKFLOW_YAML, workflow: parseWorkflow(DEFAULT_WORKFLOW_YAML), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  tasks: [taskValue], notes: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('attachment persistence', () => {
  it('opens a Hub whose tasks predate attachments without change', () => {
    const parsed = StoredHubStateSchema.parse(baseHub(task()));
    expect(parsed.tasks[0]!.attachments).toBeUndefined();
  });

  it('round-trips a task carrying attachments', () => {
    const value = { ...task(), attachments: [{ id: 'a', name: 'a.txt', bytes: 3, origin: 'path' }] };
    const parsed = HubStateSchema.parse(baseHub(value));
    expect(parsed.tasks[0]!.attachments).toEqual([{ id: 'a', name: 'a.txt', bytes: 3, origin: 'path' }]);
  });

  it('rejects an attachment with an unknown origin', () => {
    const value = { ...task(), attachments: [{ id: 'a', name: 'a.txt', bytes: 3, origin: 'bogus' }] };
    expect(() => HubStateSchema.parse(baseHub(value))).toThrow();
  });
});
