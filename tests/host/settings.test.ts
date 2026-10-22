import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

describe('board settings command', () => {
  it('saves an existing directory and retains its canonical path', async () => {
    const f = await setup();
    const trees = path.join(f.root, 'trees');
    await mkdir(trees);
    await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees + path.sep + '.' } });
    expect(f.store.snapshot().settings).toEqual({ worktreeBasePath: trees });
  });

  it('leaves an existing worktree and destination unchanged when the base path changes', async () => {
    const f = await setup();
    const trees = path.join(f.root, 'trees');
    await mkdir(trees);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Existing tree', description: '' });
    await f.store.transact(state => {
      const value = f.store.requireTask(task.id, state);
      value.worktree = { path: path.join(f.root, 'existing-tree'), branch: 'task/legacy', owned: true, status: 'ready' };
      value.effectiveCwd = path.join(f.root, 'existing-tree');
    });
    const before = structuredClone(f.store.requireTask(task.id));
    await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees } });
    expect(f.store.requireTask(task.id)).toEqual(before);
    await f.app.command({ type: 'settings.save', settings: {} });
    expect(f.store.requireTask(task.id)).toEqual(before);
  });

  it('clears the base path when the settings object is empty', async () => {
    const f = await setup();
    const trees = path.join(f.root, 'trees');
    await mkdir(trees);
    await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees } });
    expect(f.store.snapshot().settings).toEqual({ worktreeBasePath: trees });
    await f.app.command({ type: 'settings.save', settings: {} });
    expect(f.store.snapshot().settings).toEqual({});
  });

  it('rejects a missing directory and a file path', async () => {
    const f = await setup();
    await expect(f.app.command({ type: 'settings.save', settings: { worktreeBasePath: path.join(f.root, 'missing') } })).rejects.toMatchObject({ code: 'INVALID_WORKTREE_BASE_PATH' });
    const file = path.join(f.root, 'base.txt');
    await writeFile(file, 'not a directory');
    await expect(f.app.command({ type: 'settings.save', settings: { worktreeBasePath: file } })).rejects.toMatchObject({ code: 'INVALID_WORKTREE_BASE_PATH' });
    expect(f.store.snapshot().settings).toEqual({});
  });

  it('rejects a relative path and unsupported settings keys', async () => {
    const f = await setup();
    await expect(f.app.command({ type: 'settings.save', settings: { worktreeBasePath: 'relative/trees' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(f.app.command({ type: 'settings.save', settings: { engine: 'legacy' } as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.store.snapshot().settings).toEqual({});
  });

  it('honors the expected board revision', async () => {
    const f = await setup();
    const trees = path.join(f.root, 'trees');
    await mkdir(trees);
    const revision = f.store.snapshot().revision;
    await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees }, expectedRevision: revision });
    await expect(f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees }, expectedRevision: revision })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.snapshot().settings).toEqual({ worktreeBasePath: trees });
  });
});
