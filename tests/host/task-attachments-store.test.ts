import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeAttachmentName, TaskAttachmentStore } from '../../src/host/task-attachments/store.js';
import { contentDisposition } from '../../src/host/task-attachments/route.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kanban-attachments-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('task attachment store', () => {
  it('stores bytes that read back exactly and removes them from disk', async () => {
    const store = new TaskAttachmentStore(root);
    const data = new Uint8Array([1, 2, 3, 4]);
    const stored = await store.store('task-1', { name: 'evidence.csv', origin: 'path', data }, 'att-1');
    expect(stored.attachment).toEqual({ id: 'att-1', name: 'evidence.csv', bytes: 4, origin: 'path' });
    expect([...await store.read('task-1', stored.attachment)]).toEqual([1, 2, 3, 4]);
    await store.remove('task-1', stored.attachment);
    expect(await store.list('task-1')).toEqual([]);
  });

  it('removes every object of a task without touching another task', async () => {
    const store = new TaskAttachmentStore(root);
    const first = await store.store('task-1', { name: 'a.txt', origin: 'upload', data: new Uint8Array([1]) }, 'att-1');
    const second = await store.store('task-2', { name: 'b.txt', origin: 'upload', data: new Uint8Array([2]) }, 'att-2');
    await store.removeAll('task-1');
    expect(await store.list('task-1')).toEqual([]);
    expect([...await store.read('task-2', second.attachment)]).toEqual([2]);
    void first;
  });

  it('refuses a recorded length that no longer matches the object', async () => {
    const store = new TaskAttachmentStore(root);
    const stored = await store.store('task-1', { name: 'a.txt', origin: 'path', data: new Uint8Array([1, 2]) }, 'att-1');
    await expect(store.read('task-1', { ...stored.attachment, bytes: 99 })).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' });
  });

  it('reports a missing object instead of returning empty bytes', async () => {
    const store = new TaskAttachmentStore(root);
    await expect(store.read('task-1', { id: 'gone', name: 'a.txt', bytes: 1 })).rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
  });
});

describe('attachment name sanitizing', () => {
  it('takes the leaf of a path-like name so it cannot escape the directory', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentName('/tmp/report.pdf')).toBe('report.pdf');
    expect(sanitizeAttachmentName('C:\\Users\\me\\notes.txt')).toBe('notes.txt');
  });

  it('strips characters a filesystem refuses and keeps a usable fallback', () => {
    expect(sanitizeAttachmentName('a<b>c:d.txt')).toBe('a_b_c_d.txt');
    expect(sanitizeAttachmentName('')).toBe('file');
    expect(sanitizeAttachmentName('..')).toBe('file');
    expect(sanitizeAttachmentName(undefined)).toBe('file');
  });

  it('escapes a Windows device name', () => {
    expect(sanitizeAttachmentName('CON.txt')).toBe('CON.txt');
    expect(sanitizeAttachmentName('aux')).toBe('_aux');
  });
});

describe('attachment source paths', () => {
  it('reads an existing file and names it by its leaf', async () => {
    const file = join(root, 'source.txt');
    await writeFile(file, 'hello');
    await expect(TaskAttachmentStore.readSourcePath(file)).resolves.toMatchObject({ name: 'source.txt' });
  });

  it('refuses a missing path, a directory, and a relative path', async () => {
    await expect(TaskAttachmentStore.readSourcePath(join(root, 'absent.txt'))).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    const directory = join(root, 'folder');
    await mkdir(directory);
    await expect(TaskAttachmentStore.readSourcePath(directory)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_A_FILE' });
    await expect(TaskAttachmentStore.readSourcePath('relative.txt')).rejects.toMatchObject({ code: 'ATTACHMENT_PATH_INVALID' });
  });

  it('finds an object whose identifier was truncated into the leaf', async () => {
    const store = new TaskAttachmentStore(root);
    const longId = 'id-' + 'a'.repeat(80);
    const stored = await store.store('conv-1', { name: 'notes.txt', origin: 'upload', data: new Uint8Array([7]) }, longId);
    // The lookup uses the same prefix the writer used, so truncation cannot hide it.
    const read = await store.readOwned('conv-1', longId);
    expect([...read.data]).toEqual([7]);
    expect(read.attachment.name).toBe('notes.txt');
    void stored;
  });

  it('derives the recorded name and length instead of trusting the caller', async () => {
    const store = new TaskAttachmentStore(root);
    await store.store('conv-1', { name: 'report.pdf', origin: 'upload', data: new Uint8Array([1, 2, 3]) }, 'att-9');
    const read = await store.readOwned('conv-1', 'att-9');
    expect(read.attachment.name).toBe('report.pdf');
    expect(read.attachment.bytes).toBe(3);
  });

  it('reports a missing identity rather than returning another conversation file', async () => {
    const store = new TaskAttachmentStore(root);
    await store.store('conv-1', { name: 'a.txt', origin: 'upload', data: new Uint8Array([1]) }, 'att-1');
    await expect(store.readOwned('conv-1', 'att-2')).rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
    await expect(store.readOwned('conv-other', 'att-1')).rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
  });

  it('removes objects no surviving draft references and keeps the rest', async () => {
    const store = new TaskAttachmentStore(root);
    await store.store('conv-1', { name: 'keep.txt', origin: 'upload', data: new Uint8Array([1]) }, 'att-keep');
    await store.store('conv-1', { name: 'drop.txt', origin: 'upload', data: new Uint8Array([2]) }, 'att-drop');
    await store.removeUnreferenced('conv-1', new Set(['att-keep']));
    await expect(store.readOwned('conv-1', 'att-keep')).resolves.toBeTruthy();
    await expect(store.readOwned('conv-1', 'att-drop')).rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
  });

  it('treats a missing owner directory as nothing to reclaim', async () => {
    const store = new TaskAttachmentStore(root);
    await expect(store.removeUnreferenced('conv-absent', new Set())).resolves.toBeUndefined();
  });
});

describe('attachment download headers', () => {
  it('carries a Unicode name in the UTF-8 parameter and an ASCII fallback', () => {
    const header = contentDisposition('📎 relatório.csv');
    // A Fetch header is a byte string, so the plain name cannot hold the emoji.
    // The ASCII fallback replaces every non-ASCII character with an underscore, so the
    // header stays a byte string while the real name travels in the UTF-8 parameter.
    expect(header).toContain('filename="__ relat_rio.csv"');
    expect(header).toContain("filename*=UTF-8''" + encodeURIComponent('📎 relatório.csv'));
  });

  it('cannot break the header with a quote or a newline', () => {
    const header = contentDisposition('a"b\nc.txt');
    expect(header).not.toContain('\n');
    // Exactly one disposition type plus the two filename parameters, never a third
    // smuggled by a crafted name.
    expect(header.split(';').length).toBe(3);
  });
});
