import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskAttachmentStore } from '../../src/host/task-attachments/store.js';
import { fixture } from './helpers.js';

let attachmentsRoot: string;
const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
beforeEach(async () => { attachmentsRoot = await mkdtemp(join(tmpdir(), 'kanban-host-attachments-')); });
afterEach(async () => { for (const f of active.splice(0)) await f.close(); await rm(attachmentsRoot, { recursive: true, force: true }); });
// The task and answer stores are separate directories, so a conversation id can
// never address a task's files; the test wires both explicitly.
async function setup() {
  const f = await fixture({
    taskAttachments: new TaskAttachmentStore(attachmentsRoot),
    answerAttachments: new TaskAttachmentStore(join(attachmentsRoot, 'answers')),
  });
  active.push(f);
  return f;
}
async function sourceFile(name: string, body: string): Promise<string> { const file = join(attachmentsRoot, name); await writeFile(file, body); return file; }

describe('task attachments through the host', () => {
  it('creates a task carrying its files and copies the exact bytes', async () => {
    const f = await setup();
    const source = await sourceFile('evidence.csv', 'a,b');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'With evidence', description: '', attachments: [source] });
    expect(task.attachments?.map(attachment => attachment.name)).toEqual(['evidence.csv']);
    const attachment = task.attachments![0]!;
    const bytes = await f.app.readTaskAttachment(f.hub.id, task.id, attachment.id);
    expect(Buffer.from(bytes.data).toString()).toBe('a,b');
  });

  it('creates no task when one supplied path cannot be read', async () => {
    const f = await setup();
    const good = await sourceFile('ok.txt', 'ok');
    const before = f.store.snapshot().tasks.length;
    await expect(f.app.createTask({ projectId: f.project.id, title: 'Partial', description: '', attachments: [good, join(attachmentsRoot, 'absent.txt')] })).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    expect(f.store.snapshot().tasks.length).toBe(before);
  });

  it('adds a file to an existing task and removes it with its bytes', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Later evidence', description: '' });
    const source = await sourceFile('later.txt', 'later');
    const updated = await f.app.addTaskAttachments(f.hub.id, task.id, [source]);
    const attachment = updated.attachments![0]!;
    const storedPath = join(attachmentsRoot, task.id, attachment.id + '-later.txt');
    await expect(stat(storedPath)).resolves.toBeTruthy();
    const removed = await f.app.removeTaskAttachment(f.hub.id, task.id, attachment.id, true);
    expect(removed.attachments).toBeUndefined();
    await expect(stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an unconfirmed removal and deletes nothing', async () => {
    const f = await setup();
    const source = await sourceFile('keep.txt', 'keep');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Kept', description: '', attachments: [source] });
    const attachment = task.attachments![0]!;
    await expect(f.app.removeTaskAttachment(f.hub.id, task.id, attachment.id, false)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect((await f.app.readTaskAttachment(f.hub.id, task.id, attachment.id)).bytes).toBe(4);
  });

  it('reports a missing object instead of returning empty bytes', async () => {
    const f = await setup();
    const source = await sourceFile('gone.txt', 'gone');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Gone', description: '', attachments: [source] });
    const attachment = task.attachments![0]!;
    await rm(join(attachmentsRoot, task.id), { recursive: true, force: true });
    await expect(f.app.readTaskAttachment(f.hub.id, task.id, attachment.id)).rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
  });

  it('keeps the files of another task untouched when one task is deleted', async () => {
    const f = await setup();
    const firstSource = await sourceFile('first.txt', 'first');
    const secondSource = await sourceFile('second.txt', 'second');
    const first = await f.app.createTask({ projectId: f.project.id, title: 'First', description: '', attachments: [firstSource] });
    const second = await f.app.createTask({ projectId: f.project.id, title: 'Second', description: '', attachments: [secondSource] });
    await f.app.command({ type: 'worktree.dismiss', taskId: first.id });
    await f.app.command({ type: 'task.delete', taskId: first.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();
    const secondAttachment = f.store.requireTask(second.id).attachments![0]!;
    expect((await f.app.readTaskAttachment(f.hub.id, second.id, secondAttachment.id)).bytes).toBe(6);
    await expect(stat(join(attachmentsRoot, first.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('answer files through the host', () => {
  it('stores and reads back one draft answer file', async () => {
    const f = await setup();
    const saved = await f.app.saveQuestionAttachment('session-1', 'notes.txt', Buffer.from('abc').toString('base64'));
    expect(saved).toMatchObject({ name: 'notes.txt', bytes: 3 });
    const read = await f.app.readQuestionAttachment('session-1', saved);
    expect(Buffer.from(read.data, 'base64').toString()).toBe('abc');
  });

  it('refuses an attachment write while a task operation is in flight', async () => {
    const f = await setup();
    const source = await sourceFile('racy.txt', 'racy');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Busy', description: '' });
    // A deletion owns the bytes; a write admitted beside it would race the sweep.
    await f.store.transact(draft => {
      draft.tasks.find(item => item.id === task.id)!.operation = {
        id: 'op-1', request: { kind: 'delete', discardChanges: false }, phase: 'queued',
        previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [],
        gitCompleted: false, createdAt: '2026-01-01T00:00:00.000Z',
      };
    });
    await expect(f.app.addTaskAttachments(f.hub.id, task.id, [source])).rejects.toMatchObject({ code: 'TASK_BUSY' });
  });

  it('keeps the Hub valid when the deleted task had a relation', async () => {
    const f = await setup();
    const source = await sourceFile('related.txt', 'related');
    const first = await f.app.createTask({ projectId: f.project.id, title: 'Epic', description: '', attachments: [source] });
    const second = await f.app.createTask({ projectId: f.project.id, title: 'Child', description: '' });
    await f.hubs.hub(f.hub.id).createRelations([{ type: 'epic', from: first.id, to: second.id }]);
    expect(f.store.snapshot().relations).toHaveLength(1);
    await f.app.command({ type: 'worktree.dismiss', taskId: first.id });
    await f.app.command({ type: 'task.delete', taskId: first.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();
    // The relation named the deleted task, so a deletion that left it behind would
    // make the next Hub read reject the whole board.
    expect(f.store.snapshot().relations?.some(relation => relation.from === first.id || relation.to === first.id) ?? false).toBe(false);
    await expect(f.app.snapshot()).resolves.toBeTruthy();
  });

  it('keeps the record when the byte deletion fails, so the removal can be retried', async () => {
    const f = await setup();
    const source = await sourceFile('sticky.txt', 'sticky');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Sticky', description: '', attachments: [source] });
    const attachment = task.attachments![0]!;
    // A read-only directory fails the unlink the way a locked file does.
    await chmod(join(attachmentsRoot, task.id), 0o500);
    await expect(f.app.removeTaskAttachment(f.hub.id, task.id, attachment.id, true)).rejects.toBeTruthy();
    expect(f.store.requireTask(task.id).attachments?.map(value => value.id)).toEqual([attachment.id]);
    await chmod(join(attachmentsRoot, task.id), 0o700);
    const removed = await f.app.removeTaskAttachment(f.hub.id, task.id, attachment.id, true);
    expect(removed.attachments).toBeUndefined();
  });

  it('refuses an unusable file name instead of filing it under a placeholder', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Named', description: '' });
    await expect(f.app.addTaskAttachmentBytes(f.hub.id, task.id, [{ name: '   ', origin: 'upload', data: 'YWJj' }])).rejects.toMatchObject({ code: 'ATTACHMENT_NAME_INVALID' });
    await expect(f.app.addTaskAttachmentBytes(f.hub.id, task.id, [{ name: '...', origin: 'upload', data: 'YWJj' }])).rejects.toMatchObject({ code: 'ATTACHMENT_NAME_INVALID' });
  });

  it('stores a long multibyte name within the filesystem leaf limit', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Long name', description: '' });
    const name = 'é'.repeat(200) + '.csv';
    const updated = await f.app.addTaskAttachmentBytes(f.hub.id, task.id, [{ name, origin: 'upload', data: 'YWJj' }]);
    const path = f.app.taskAttachmentPaths(updated)[0]!.path;
    // The whole leaf fits, so the object exists rather than failing at open time.
    await expect(stat(path)).resolves.toBeTruthy();
    expect(Buffer.byteLength(path.slice(path.lastIndexOf('/') + 1))).toBeLessThanOrEqual(255);
  });

  it('writes no file when the edit revision is stale', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Stale', description: '' });
    const source = await sourceFile('later.txt', 'later');
    const stored = f.store.snapshot().revision;
    await expect(f.app.command({
      type: 'task.edit', hubId: f.hub.id, taskId: task.id, attachmentPaths: [source], expectedRevision: stored + 99,
    })).rejects.toBeTruthy();
    // A rejected edit leaves the card exactly as it was, with no half-stored evidence.
    expect(f.store.requireTask(task.id).attachments).toBeUndefined();
  });

  it('refuses a repeated removal instead of deleting once and failing after', async () => {
    const f = await setup();
    const source = await sourceFile('twice.txt', 'twice');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Twice', description: '', attachments: [source] });
    const attachment = task.attachments![0]!;
    const updated = await f.app.command({
      type: 'task.edit', hubId: f.hub.id, taskId: task.id, removeAttachmentIds: [attachment.id, attachment.id], confirmed: true,
    });
    const current = updated.state.hubs[0]!.tasks.find(value => value.id === task.id)!;
    expect(current.attachments).toBeUndefined();
  });

  it('accepts a real file named file', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Literal', description: '' });
    const updated = await f.app.addTaskAttachmentBytes(f.hub.id, task.id, [{ name: 'file', origin: 'upload', data: 'YWJj' }]);
    expect(updated.attachments?.[0]?.name).toBe('file');
  });

  it('applies an edit that adds a file and changes the text in one command', async () => {
    const f = await setup();
    const source = await sourceFile('together.txt', 'together');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Before', description: '' });
    const revision = f.store.snapshot().revision;
    // The attachment write advances the revision, so the text must not re-check the
    // revision the caller sent or the command would conflict with itself.
    await f.app.command({ type: 'task.edit', hubId: f.hub.id, taskId: task.id, title: 'After', attachmentPaths: [source], expectedRevision: revision });
    const current = f.store.requireTask(task.id);
    expect(current.title).toBe('After');
    expect(current.attachments?.[0]?.name).toBe('together.txt');
  });

  it('refuses an empty title before writing anything', async () => {
    const f = await setup();
    const source = await sourceFile('blocked.txt', 'blocked');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Named', description: '' });
    await expect(f.app.command({ type: 'task.edit', hubId: f.hub.id, taskId: task.id, title: '   ', attachmentPaths: [source] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.store.requireTask(task.id).attachments).toBeUndefined();
  });

  it('leaves the card untouched when the second removal is unknown', async () => {
    const f = await setup();
    const source = await sourceFile('atomic.txt', 'atomic');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Atomic', description: '', attachments: [source] });
    const attachment = task.attachments![0]!;
    const added = await sourceFile('added.txt', 'added');
    // The unknown identity must reject the whole edit, including the addition.
    await expect(f.app.command({
      type: 'task.edit', hubId: f.hub.id, taskId: task.id, attachmentPaths: [added],
      removeAttachmentIds: [attachment.id, 'ghost'], confirmed: true,
    })).rejects.toBeTruthy();
    const current = f.store.requireTask(task.id);
    expect(current.attachments?.map(value => value.id)).toEqual([attachment.id]);
    // The staged bytes were swept, so nothing is left under the task directory.
    expect(await new TaskAttachmentStore(attachmentsRoot).list(task.id)).toHaveLength(1);
  });

  it('deletes exactly the discarded draft attachment and keeps a live one', async () => {
    const f = await setup();
    const kept = await f.app.saveQuestionAttachment('session-1', 'kept.txt', Buffer.from('abc').toString('base64'));
    const discarded = await f.app.saveQuestionAttachment('session-1', 'gone.txt', Buffer.from('xyz').toString('base64'));
    // A fresh upload is stored before its debounced draft write records it, so only the
    // discarded identity may be removed and the live one must survive.
    await f.app.removeQuestionAttachment('session-1', { id: discarded.id });
    await expect(f.app.readQuestionAttachment('session-1', { id: discarded.id })).rejects.toBeTruthy();
    const read = await f.app.readQuestionAttachment('session-1', { id: kept.id });
    expect(read.name).toBe('kept.txt');
  });
});
