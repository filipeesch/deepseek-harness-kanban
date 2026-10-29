import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fixture } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;

async function addTask(f: F) {
  const result = await f.app.command({ type: 'task.create', projectId: f.project.id, title: 'Task', description: '' });
  return result.state.hubs.find(hub => hub.id === f.hub.id)!.tasks[0]!;
}

describe('project save repository validation', () => {
  it('accepts a Git root that matches the repository top level', async () => {
    const f = await setup();
    const result = await f.app.command({ type: 'project.save', project: { id: 'root', name: 'Root', projectPath: f.gitRoot, gitRootPath: f.gitRoot } });
    expect(result.state.hubs[0]!.projects.find(project => project.id === 'root')?.gitRootPath).toBe(f.gitRoot);
  });

  it('rejects a Git root that is not the repository top level', async () => {
    const f = await setup();
    await expect(f.app.command({ type: 'project.save', project: { id: 'sub', name: 'Sub', projectPath: f.projectPath, gitRootPath: f.projectPath } })).rejects.toMatchObject({ code: 'INVALID_GIT_ROOT' });
    expect(f.hubs.snapshot().hubs[0]!.projects.some(project => project.id === 'sub')).toBe(false);
  });

  it('rejects a Git root that is not inside a repository', async () => {
    const f = await setup();
    const plain = path.join(f.root, 'plain');
    await (await import('node:fs/promises')).mkdir(plain);
    await expect(f.app.command({ type: 'project.save', project: { name: 'Plain', projectPath: plain, gitRootPath: plain } })).rejects.toMatchObject({ code: 'INVALID_GIT_ROOT' });
    expect(f.hubs.snapshot().hubs[0]!.projects.some(project => project.name === 'Plain')).toBe(false);
  });

  it('treats a blank Git root as a folder project', async () => {
    const f = await setup();
    const result = await f.app.command({ type: 'project.save', project: { name: 'Blank', projectPath: f.projectPath, gitRootPath: '' } });
    expect(result.state.hubs[0]!.projects.find(value => value.name === 'Blank')?.gitRootPath).toBeUndefined();
  });

  it('rejects a non-text Git root', async () => {
    const f = await setup();
    await expect(f.app.command({ type: 'project.save', project: { name: 'Bad', projectPath: f.projectPath, gitRootPath: 5 as never } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('accepts a folder project without invoking Git', async () => {
    const f = await setup();
    const result = await f.app.command({ type: 'project.save', project: { name: 'Notes', projectPath: f.projectPath } });
    const project = result.state.hubs[0]!.projects.find(value => value.name === 'Notes')!;
    expect(project.gitRootPath).toBeUndefined();
  });

  it('removes a Git association while the project still has tasks', async () => {
    const f = await setup();
    await addTask(f);
    const result = await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath } });
    const project = result.state.hubs[0]!.projects.find(value => value.id === f.project.id)!;
    expect(project.gitRootPath).toBeUndefined();
  });

  it('adds a Git association to a folder project with tasks', async () => {
    const f = await setup();
    const created = await f.app.command({ type: 'project.save', project: { name: 'Plain', projectPath: f.projectPath } });
    const project = created.state.hubs[0]!.projects.find(value => value.name === 'Plain')!;
    await f.app.command({ type: 'task.create', projectId: project.id, title: 'Task', description: '' });
    const result = await f.app.command({ type: 'project.save', project: { id: project.id, name: 'Plain', projectPath: f.projectPath, gitRootPath: f.gitRoot } });
    expect(result.state.hubs[0]!.projects.find(value => value.id === project.id)?.gitRootPath).toBe(f.gitRoot);
  });

  it('blocks a conversion while a worktree request is pending', async () => {
    const f = await setup();
    await addTask(f);
    const board = f.hub.boards[0]!;
    await f.store.transact(draft => {
      const task = draft.tasks[0]!;
      task.pendingTransition = {
        id: 'pending', fromColumnId: board.workflow.initialColumnId, columnId: board.workflow.columns[0]!.id,
        mode: 'move', worktreeRequest: { mode: 'new', path: path.join(f.root, 'trees', 'x'), branchName: 'x' }, status: 'waiting',
      };
    });
    await expect(f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath } })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
  });

  it('still rejects a project path change while tasks reference the project', async () => {
    const f = await setup();
    await addTask(f);
    await expect(f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.gitRoot, gitRootPath: f.gitRoot } })).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
  });
});

describe('detectProject through the app', () => {
  it('reports a Git location for a registered repository path', async () => {
    const f = await setup();
    await expect(f.app.detectProject(f.projectPath)).resolves.toEqual({ kind: 'git', projectPath: f.projectPath, gitRootPath: f.gitRoot, defaultBranch: 'main' });
  });

  it('reports a folder location for a path outside any repository', async () => {
    const f = await setup();
    const plain = path.join(f.root, 'plain');
    await (await import('node:fs/promises')).mkdir(plain);
    await expect(f.app.detectProject(plain)).resolves.toEqual({ kind: 'folder', projectPath: plain });
  });
});

describe('folder projects and execution context', () => {
  async function folderTask(f: F) {
    const created = await f.app.command({ type: 'project.save', project: { name: 'Plain', projectPath: f.projectPath } });
    const project = created.state.hubs[0]!.projects.find(value => value.name === 'Plain')!;
    const result = await f.app.command({ type: 'task.create', projectId: project.id, title: 'Plain task', description: '' });
    const task = result.state.hubs[0]!.tasks.find(value => value.title === 'Plain task')!;
    return { project, task };
  }

  it('rejects branch discovery and worktree defaults for a folder project', async () => {
    const f = await setup();
    const { task } = await folderTask(f);
    await expect(f.app.branches(task.id)).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
    await expect(f.app.worktreeDefault(task.id)).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
  });

  it('uses the project path as the effective conversation directory', async () => {
    const f = await setup();
    const { task } = await folderTask(f);
    expect(task.effectiveCwd).toBe(f.projectPath);
    await expect(f.app.assertExecutionContext(task.sessionIds[0]!)).resolves.toBeUndefined();
  });

  it('keeps a retained plain checkout valid until the recorded directory escapes it', async () => {
    const f = await setup();
    const { task } = await folderTask(f);
    const checkout = path.join(f.root, 'plain-checkout');
    const nested = path.join(checkout, 'sub');
    await (await import('node:fs/promises')).mkdir(nested, { recursive: true });
    await f.store.transact(draft => {
      const current = draft.tasks.find(value => value.id === task.id)!;
      current.worktree = { path: checkout, branch: 'feature', owned: true, status: 'ready' };
      current.effectiveCwd = nested;
    });
    f.sessions.dirs.set(task.sessionIds[0]!, nested);
    await expect(f.app.assertExecutionContext(task.sessionIds[0]!)).resolves.toBeUndefined();
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.effectiveCwd = f.root; });
    f.sessions.dirs.set(task.sessionIds[0]!, f.root);
    await expect(f.app.assertExecutionContext(task.sessionIds[0]!)).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
  });

  it('keeps task effective directories when a folder project gains a Git association', async () => {
    const f = await setup();
    const { project, task } = await folderTask(f);
    const result = await f.app.command({ type: 'project.save', project: { id: project.id, name: 'Plain', projectPath: f.projectPath, gitRootPath: f.gitRoot } });
    expect(result.state.hubs[0]!.projects.find(value => value.id === project.id)?.gitRootPath).toBe(f.gitRoot);
    expect(result.state.hubs[0]!.tasks.find(value => value.id === task.id)?.effectiveCwd).toBe(f.projectPath);
  });

  it('detection does not register a project', async () => {
    const f = await setup();
    const before = f.hubs.snapshot().hubs[0]!.projects.length;
    await f.app.detectProject(f.projectPath);
    expect(f.hubs.snapshot().hubs[0]!.projects).toHaveLength(before);
  });
});
