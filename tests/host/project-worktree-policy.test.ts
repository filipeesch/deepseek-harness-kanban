import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { CommandSchema } from '../../src/remote.js';
import { fixture } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;

function projectInput(f: F, overrides: Record<string, unknown> = {}) {
  return { id: f.project.id, name: f.project.name, projectPath: f.projectPath, gitRootPath: f.gitRoot, ...overrides };
}
async function setPolicy(f: F, worktreePolicy: 'ask' | 'always' | 'never') {
  return f.store.saveProject(projectInput(f, { worktreePolicy }) as never);
}

const staticProject = { id: 'project-1', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };

describe('project worktree policy command schema', () => {
  it('accepts the three states and an omitted policy', () => {
    for (const worktreePolicy of ['ask', 'always', 'never', undefined]) {
      const command = { type: 'project.save', project: { ...staticProject, ...(worktreePolicy === undefined ? {} : { worktreePolicy }) } };
      const parsed = CommandSchema.safeParse(command);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
  it('rejects an unknown policy', () => {
    expect(CommandSchema.safeParse({ type: 'project.save', project: { ...staticProject, worktreePolicy: 'sometimes' } }).success).toBe(false);
  });
});

describe('project worktree policy storage', () => {
  it('stores an explicit policy and reads it back', async () => {
    const f = await setup();
    const saved = await setPolicy(f, 'never');
    expect(saved.worktreePolicy).toBe('never');
    expect(f.store.requireProject(f.project.id).worktreePolicy).toBe('never');
  });
  it('keeps the stored policy when a save omits it', async () => {
    const f = await setup();
    await setPolicy(f, 'always');
    const saved = await f.store.saveProject(projectInput(f) as never);
    expect(saved.worktreePolicy).toBe('always');
  });
  it('keeps the policy across a rename and a new key', async () => {
    const f = await setup();
    await setPolicy(f, 'never');
    const renamed = await f.store.saveProject(projectInput(f, { name: 'Renamed', projectKey: 'renamed-key', worktreePolicy: undefined }) as never);
    expect(renamed).toMatchObject({ name: 'Renamed', projectKey: 'renamed-key', worktreePolicy: 'never' });
  });
  it('rejects an unknown policy at the domain boundary', async () => {
    const f = await setup();
    await expect(f.store.saveProject(projectInput(f, { worktreePolicy: 'sometimes' }) as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.store.requireProject(f.project.id).worktreePolicy).toBeUndefined();
  });
  it('defaults a new project to Ask by leaving the field absent', async () => {
    const f = await setup();
    const folderPath = path.join(f.root, 'notes'); await mkdir(folderPath, { recursive: true });
    const created = await f.store.saveProject({ name: 'Notes', projectPath: folderPath });
    expect(created.worktreePolicy).toBeUndefined();
  });
});

describe('first execution under the Never policy', () => {
  it('creates the first conversation without a worktree or a recorded choice', async () => {
    const f = await setup();
    await setPolicy(f, 'never');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'No tree', description: '' });
    const sessionId = await f.app.createConversation(task.id);
    const current = f.store.requireTask(task.id);
    expect(sessionId).toBeTruthy();
    expect(current.worktree).toBeNull();
    expect(current.worktreeDismissed).toBeUndefined();
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.get(sessionId)).toBe(f.projectPath);
  });

  it('prepares a message conversation in the base project', async () => {
    const f = await setup();
    await setPolicy(f, 'never');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Message target', description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    expect(prepared.createdConversation).toBe(true);
    expect(prepared.createdWorktree).toBeUndefined();
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.get(prepared.sessionId)).toBe(f.projectPath);
    expect(f.store.requireTask(task.id).worktree).toBeNull();
  });
});

describe('first execution under the Always create policy', () => {
  it('prepares the default worktree for a message conversation', async () => {
    const f = await setup();
    await setPolicy(f, 'always');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Always tree', description: '' });
    const prepared = await f.app.prepareMessageConversation(task.id);
    const current = f.store.requireTask(task.id);
    expect(prepared.createdWorktree).toEqual({ path: current.worktree!.path, branch: current.worktree!.branch });
    expect(current.worktree).toMatchObject({ status: 'ready' });
    expect(f.git.created).toBe(1);
    expect(f.sessions.dirs.get(prepared.sessionId)).toBe(path.join(current.worktree!.path, 'apps', 'web'));
  });

  it('creates the default worktree before an explicit first conversation', async () => {
    const f = await setup();
    await setPolicy(f, 'always');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Plain start', description: '' });
    const sessionId = await f.app.createConversation(task.id);
    const current = f.store.requireTask(task.id);
    expect(f.git.created).toBe(1);
    expect(current.worktree).toMatchObject({ status: 'ready' });
    expect(f.sessions.dirs.get(sessionId)).toBe(path.join(current.worktree!.path, 'apps', 'web'));
  });

  it('fails an explicit first conversation when the policy cannot derive a destination', async () => {
    const f = await setup();
    await setPolicy(f, 'always');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Plain start', description: '' });
    // The derivation is private; the test replaces it through a narrow cast to force the refusal.
    (f.app as unknown as { worktreeDefaultsFor: () => Promise<unknown> }).worktreeDefaultsFor = async () => ({ kind: 'unavailable', reason: { code: 'WORKTREE_NAME_UNAVAILABLE', message: 'No name.' } });
    await expect(f.app.createConversation(task.id)).rejects.toMatchObject({ code: 'WORKTREE_NAME_UNAVAILABLE' });
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });
});
