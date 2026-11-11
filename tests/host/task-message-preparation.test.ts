import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { KanbanError } from '../../src/shared/errors.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
const TITLE = 'Message target';

describe('message conversation preparation', () => {
  it('uses the first open conversation without preparing anything', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: TITLE, description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    expect(prepared).toEqual({ sessionId: task.sessionIds[0], createdConversation: false });
    expect(f.git.created).toBe(0);
    expect(f.store.requireTask(task.id).sessionIds).toEqual(task.sessionIds);
  });

  it('creates the default worktree and then the first conversation', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    const current = f.store.requireTask(task.id);
    expect(prepared.createdConversation).toBe(true);
    expect(prepared.createdWorktree).toEqual({ path: current.worktree!.path, branch: current.worktree!.branch });
    expect(current.worktree).toMatchObject({ status: 'ready', branch: 'message-target' });
    expect(f.git.created).toBe(1);
    expect(current.sessionIds).toEqual([prepared.sessionId]);
    expect(f.sessions.dirs.get(prepared.sessionId)).toBe(path.join(current.worktree!.path, 'apps', 'web'));
  });

  it('uses the base project after the recorded choice', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const prepared = await f.app.prepareMessageConversation(task.id);
    expect(prepared).toMatchObject({ createdConversation: true });
    expect(prepared.createdWorktree).toBeUndefined();
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.get(prepared.sessionId)).toBe(f.projectPath);
  });

  it('uses the folder project directory', async () => {
    const f = await setup();
    const folderPath = path.join(f.root, 'docs'); await mkdir(folderPath, { recursive: true });
    const folder = await f.store.saveProject({ name: 'Docs', projectPath: folderPath });
    const task = await f.app.createTask({ projectId: folder.id, title: TITLE, description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    expect(prepared.createdConversation).toBe(true);
    expect(f.git.created).toBe(0);
    expect(f.store.requireTask(task.id).worktree).toBeNull();
    expect(f.sessions.dirs.get(prepared.sessionId)).toBe(folderPath);
  });

  it('blocks a preparing or error worktree binding', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    await f.store.transact(draft => {
      draft.tasks.find(value => value.id === task.id)!.worktree = { path: '/gone', branch: 'gone', owned: true, status: 'error', error: { code: 'WORKTREE_REMOVED', message: 'Removed externally.' } };
    });
    await expect(f.app.prepareMessageConversation(task.id)).rejects.toMatchObject({ code: 'WORKTREE_BINDING_UNRESOLVED' });
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.git.created).toBe(0);
  });

  it('reuses one conversation when a first-start request is queued behind the preparation', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    const [prepared, created] = await Promise.all([
      f.app.prepareMessageConversation(task.id),
      f.app.createConversation(task.id, { ensureFirst: true }),
    ]);
    expect(created).toBe(prepared.sessionId);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([prepared.sessionId]);
    expect(f.git.created).toBe(1);
  });

  it('reuses one conversation when the message preparation is queued behind first-start', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    // The user's execution preparation resolves the worktree choice before it creates the conversation.
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const [created, prepared] = await Promise.all([
      f.app.createConversation(task.id, { ensureFirst: true }),
      f.app.prepareMessageConversation(task.id),
    ]);
    expect(prepared.sessionId).toBe(created);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([created]);
    expect(f.git.created).toBe(0);
  });

  it('lets the plus action add a conversation after the preparation', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    const extra = await f.app.createConversation(task.id);
    expect(extra).not.toBe(prepared.sessionId);
    expect(f.store.requireTask(task.id).sessionIds).toHaveLength(2);
  });

  it('reuses the prepared conversation through the queued first-start command', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    await f.app.command({ type: 'conversation.create', taskId: task.id, ensureFirst: true });
    expect(f.store.requireTask(task.id).sessionIds).toEqual([prepared.sessionId]);
  });

  it('blocks a preparing worktree binding as well as an error binding', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    await f.store.transact(draft => {
      draft.tasks.find(value => value.id === task.id)!.worktree = { path: '/tree', branch: 'preparing', owned: true, status: 'preparing' };
    });
    await expect(f.app.prepareMessageConversation(task.id)).rejects.toMatchObject({ code: 'WORKTREE_BINDING_UNRESOLVED' });
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.git.created).toBe(0);
  });

  it('keeps the created worktree when the conversation cannot be created', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: TITLE, description: '' });
    f.sessions.create = async () => { throw new KanbanError('SESSION_FAILED', 'No conversation.'); };
    await expect(f.app.prepareMessageConversation(task.id)).rejects.toMatchObject({ code: 'SESSION_FAILED' });
    expect(f.git.created).toBe(1);
    expect(f.store.requireTask(task.id).worktree).toMatchObject({ status: 'ready' });
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });
});
