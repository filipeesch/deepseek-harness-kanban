import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { stringify } from 'yaml';
import { BoardStore } from '../../src/domain/store.js';
import { KanbanApp } from '../../src/host/app.js';
import { GitAdapter } from '../../src/host/git.js';
import { productToolDefinitions } from '../../src/host/tools.js';
import { KanbanError } from '../../src/shared/errors.js';
import type { CommandResult } from '../../src/shared/ports.js';
import type { Project } from '../../src/shared/types.js';
import { MemoryStorage, TestSessions } from './helpers.js';
import { cleanup as cleanupGit, fixture as gitFixture, gitOk, LocalExecutor } from '../worktrees/helpers.js';

const approvedInstruction = '    Implement the approved product change.\n\nKeep the monorepo subdirectory.\n';
const apps: KanbanApp[] = [];
afterEach(async () => {
  try { for (const app of apps.splice(0).reverse()) await app.close(); }
  finally { await cleanupGit(); }
});

class ProductSessions extends TestSessions {
  // Synthetic ownership markers only: not Native messages, events, or a runtime history factory.
  readonly histories = new Map<string, readonly string[]>();
  readonly origins = new Map<string, string>();
  readonly switches: Array<{ id: string; cwd: string }> = [];
  readonly cancel = vi.fn();
  readonly delete = vi.fn();
  readonly purge = vi.fn();
  readonly setGlobalDefaults = vi.fn();
  readonly defaults = Object.freeze({ preset: 'unchanged-fixture-default', selection: 'unchanged-fixture-selection' });
  override async create(cwd: string): Promise<string> {
    const id = await super.create(cwd);
    this.origins.set(id, cwd);
    this.histories.set(id, Object.freeze(['synthetic-history-marker:' + id]));
    return id;
  }
  override async setDirectory(id: string, cwd: string): Promise<void> {
    await super.setDirectory(id, cwd);
    this.switches.push({ id, cwd });
  }
}

class ProductExecutor extends LocalExecutor {
  readonly removals: Array<{ directories: Array<[string, string]>; archived: string[] }> = [];
  constructor(private readonly sessions: ProductSessions) { super(); }
  override async run(project: Project, args: string[], ids: string[], signal?: AbortSignal): Promise<CommandResult> {
    if (args.includes('worktree') && args.includes('remove')) {
      // Capture state before the real Git command, not after cleanup has succeeded.
      this.removals.push({ directories: ids.map(id => [id, this.sessions.dirs.get(id)!]), archived: [...this.sessions.archived] });
    }
    return super.run(project, args, ids, signal);
  }
}

async function setup() {
  // Reuses guarded absolute temporary-root cleanup and repo-local Git config; never the user's repository.
  const files = await gitFixture();
  const storage = new MemoryStorage();
  const sessions = new ProductSessions();
  sessions.dirs.set('unbound-synthetic-blank', files.project.projectPath);
  sessions.histories.set('unbound-synthetic-blank', Object.freeze([]));
  const executor = new ProductExecutor(sessions);
  let app = new KanbanApp(await BoardStore.open(storage), sessions, new GitAdapter(executor));
  apps.push(app);
  await app.initialize();
  await app.command({ type: 'project.save', project: files.project });
  const workflow = app.store.snapshot().workflow;
  await app.command({ type: 'workflow.save', yaml: stringify({
    name: workflow.name, initial_column: workflow.initialColumnId,
    columns: workflow.columns.map(column => ({ id: column.id, label: column.name,
      ...(column.id === 'plan' ? { on_enter_prompt: 'Plan only after explicit approval.' } : {}),
      ...(column.id === 'in_progress' ? { on_enter_prompt: approvedInstruction } : {}),
    })),
  }) });
  function execution(id = 'ordinary-synthetic-caller') {
    return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
  }
  async function tool(name: string, args: Record<string, unknown>, id?: string) {
    const definition = productToolDefinitions(app).find(candidate => candidate.name === name);
    if (!definition) throw new Error('Missing product tool: ' + name);
    return definition.execute(args, execution(id));
  }
  async function task() {
    await tool('create_card', { project_id: files.project.id, title: 'Product walkthrough', description: '**Initial product description**' });
    const created = app.store.snapshot().tasks.at(-1)!;
    const a = created.sessionIds[0]!;
    const b = await app.createConversation(created.id);
    expect(a).not.toBe(b);
    expect([a, b]).not.toContain('unbound-synthetic-blank');
    expect(app.store.requireTask(created.id).sessionIds).toEqual([a, b]);
    expect(sessions.origins.get(a)).toBe(files.project.projectPath);
    expect(sessions.origins.get(b)).toBe(files.project.projectPath);
    expect(sessions.sent).toEqual([]);
    return { id: created.id, a, b };
  }
  async function reopen() {
    await app.close();
    app = new KanbanApp(await BoardStore.open(storage), sessions, new GitAdapter(executor));
    apps.push(app);
    await app.initialize();
  }
  function noNativeDestruction() {
    expect(sessions.cancel).not.toHaveBeenCalled();
    expect(sessions.delete).not.toHaveBeenCalled();
    expect(sessions.purge).not.toHaveBeenCalled();
    expect(sessions.setGlobalDefaults).not.toHaveBeenCalled();
    expect(sessions.defaults).toEqual({ preset: 'unchanged-fixture-default', selection: 'unchanged-fixture-selection' });
    expect(sessions.histories.get('unbound-synthetic-blank')).toEqual([]);
    expect(sessions.dirs.get('unbound-synthetic-blank')).toBe(files.project.projectPath);
  }
  return { ...files, storage, sessions, executor, get app() { return app; }, task, tool, execution, reopen, noNativeDestruction };
}

async function waitForReady(f: Awaited<ReturnType<typeof setup>>, taskId: string) {
  f.app.activityChanged();
  await expect.poll(() => f.app.store.requireTask(taskId).operation, { timeout: 5000 }).toBeNull();
  expect(f.app.store.requireTask(taskId).worktree?.status).toBe('ready');
}

async function addSharedNote(f: Awaited<ReturnType<typeof setup>>, task: { id: string; a: string; b: string }) {
  await f.tool('create_note', { content: '# Shared product note\n\n**From A**' }, task.a);
  const note = f.app.store.snapshot().notes.find(value => value.taskId === task.id)!;
  await f.tool('update_note', { id: note.id, content: '# Shared product note\n\n**Edited from B**' }, task.b);
  const expected = f.app.store.snapshot().notes.filter(value => value.taskId === task.id);
  expect(await f.tool('list_notes', {}, task.a)).toEqual(expected);
  expect(await f.tool('list_notes', {}, task.b)).toEqual(expected);
  expect(expected).toHaveLength(1);
  return expected[0]!;
}

// PW01 maps product tasks 2.2/2.5, 3.2, 4.1/4.3, 5.2–5.4, 6.2/6.4, 7.1, 8.1/8.2/8.4, 9.2/9.4.
describe('bounded integrated product walkthrough', () => {
  it('PW01 walks monorepo creation, scoped delegation, restart, and confirmed permanent deletion', async () => {
    const f = await setup();
    expect(f.project.projectPath).not.toBe(f.project.gitRootPath);
    const t = await f.task();
    expect(f.app.store.requireTask(t.id).columnId).toBe('backlog');
    await f.app.command({ type: 'task.move', taskId: t.id, columnId: 'plan', mode: 'move' });
    await f.tool('edit_card', { task_id: t.id, title: 'Edited in Plan', description: 'Approved **product** description' }, t.a);
    const note = await addSharedNote(f, t);
    const question = productToolDefinitions(f.app).find(definition => definition.name === 'decision_request')!;
    const run = f.execution(t.b);
    expect(await question.execute({ question: 'Choose the product approach', type: 'exclusive', options: [{ title: 'A', description: 'First approach' }, { title: 'B', description: 'Second approach' }] }, run)).toMatchObject({ kind: 'kanban.question-page', version: 1 });
    expect(run.deferContext).not.toHaveBeenCalled(); expect(run.concludeTurn).not.toHaveBeenCalled();
    expect(f.sessions.sent).toEqual([]);
    const histories = [...f.sessions.histories];
    f.sessions.busy.add(t.a);
    await f.app.command({ type: 'task.move', taskId: t.id, columnId: 'in_progress', mode: 'run', sessionId: t.b, expectedInstruction: approvedInstruction, worktree: { mode: 'new', path: f.tree, branchName: 'task/product-walkthrough', sourceBranch: 'main' } });
    expect(f.app.store.requireTask(t.id).operation?.phase).toBe('waiting');
    expect(f.app.store.requireTask(t.id).columnId).toBe('plan');
    expect(f.sessions.switches).toEqual([]);
    expect(f.sessions.dirs.get(t.a)).toBe(f.project.projectPath);
    expect(f.sessions.dirs.get(t.b)).toBe(f.project.projectPath);
    await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.sessions.sent).toEqual([]);
    f.sessions.busy.delete(t.a);
    await waitForReady(f, t.id);
    await expect.poll(() => f.sessions.sent.length, { timeout: 5000 }).toBe(1);
    const targetDirectory = path.join(f.tree, 'packages', 'api');
    expect(f.sessions.dirs.get(t.a)).toBe(targetDirectory);
    expect(f.sessions.dirs.get(t.b)).toBe(targetDirectory);
    expect(f.app.store.requireTask(t.id)).toMatchObject({ sessionIds: [t.a, t.b], columnId: 'in_progress', effectiveCwd: targetDirectory });
    expect(f.sessions.sent[0]).toMatchObject({ id: t.b });
    expect(f.sessions.sent[0]!.text).toBe(approvedInstruction);
    expect(f.sessions.sent.some(value => value.id === t.a)).toBe(false);
    expect([...f.sessions.histories]).toEqual(histories);
    const c = await f.app.createConversation(t.id);
    expect([t.a, t.b]).not.toContain(c);
    expect(f.sessions.origins.get(c)).toBe(f.project.projectPath);
    expect(f.sessions.dirs.get(c)).toBe(targetDirectory);
    expect(f.app.store.requireTask(t.id).sessionIds).toEqual([t.a, t.b, c]);
    expect(await f.tool('list_notes', {}, c)).toEqual([note]);
    expect(f.sessions.sent).toHaveLength(1);
    const preservedHistories = [...f.sessions.histories];
    await f.reopen();
    expect(f.app.store.requireTask(t.id)).toMatchObject({ sessionIds: [t.a, t.b, c], effectiveCwd: targetDirectory });
    expect(await f.tool('list_notes', {}, t.b)).toEqual([note]);
    expect(f.sessions.origins.get(t.a)).toBe(f.project.projectPath); expect(f.sessions.origins.get(t.b)).toBe(f.project.projectPath);
    expect(f.sessions.dirs.size).toBe(4); expect(f.sessions.sent).toHaveLength(1);
    expect((await stat(f.tree)).isDirectory()).toBe(true);
    expect(f.sessions.archived).toEqual([]);
    expect(f.app.store.snapshot().notes).toEqual([note]);
    expect([...f.sessions.histories]).toEqual(preservedHistories);
    await writeFile(path.join(targetDirectory, 'app.txt'), 'dirty product change\n');
    const beforeDecline = f.app.store.snapshot();
    await expect(f.app.command({ type: 'task.delete', taskId: t.id, confirmed: false, expectedWorktreePath: f.tree })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.app.store.snapshot()).toEqual(beforeDecline); expect(f.executor.removals).toEqual([]);
    await expect(f.app.command({ type: 'task.delete', taskId: t.id, confirmed: true, expectedWorktreePath: f.tree, discardChanges: false })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    expect(f.app.store.requireTask(t.id).operation).toMatchObject({ phase: 'failed', error: { code: 'DISCARD_REQUIRED' } });
    expect(f.executor.removals).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true);
    const unavailable = vi.spyOn(f.sessions, 'directories').mockRejectedValue(new KanbanError('SESSION_CONTEXT_UNAVAILABLE', 'Synthetic public directory catalog unavailable.'));
    await expect(f.app.command({ type: 'task.delete', taskId: t.id, confirmed: true, expectedWorktreePath: f.tree, discardChanges: true })).rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
    expect(f.app.store.requireTask(t.id).sessionIds).toEqual([t.a, t.b, c]);
    expect(f.app.store.snapshot().notes).toEqual([note]);
    expect(f.executor.removals).toEqual([]); expect(f.sessions.archived).toEqual([]);
    expect((await stat(f.tree)).isDirectory()).toBe(true);
    unavailable.mockRestore();
    await f.app.command({ type: 'task.delete', taskId: t.id, confirmed: true, expectedWorktreePath: f.tree, discardChanges: true });
    expect(f.executor.removals).toEqual([{ directories: [[t.a, f.project.projectPath], [t.b, f.project.projectPath], [c, f.project.projectPath]], archived: [] }]);
    expect(f.app.store.snapshot().tasks).toEqual([]); expect(f.app.store.snapshot().notes).toEqual([]);
    expect(f.sessions.archived).toEqual([t.a, t.b, c]);
    expect([...f.sessions.histories]).toEqual(preservedHistories);
    await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(f.project.projectPath, 'app.txt'), 'utf8')).toBe('initial\n');
    expect((await gitOk(f.project.gitRootPath, ['branch', '--list', 'task/product-walkthrough'])).trim()).toContain('task/product-walkthrough');
    expect((await gitOk(f.project.gitRootPath, ['branch', '--show-current'])).trim()).toBe('main');
    f.noNativeDestruction();
  }, 20000);

  // PW02 maps product tasks 3.2, 4.3/4.6, 5.4, 9.4: deferred delegation cancellation has no execution or isolation effect.
  it('PW02 cancels approved-but-waiting delegation without moving, creating a checkout, or messaging a tab', async () => {
    const f = await setup(); const t = await f.task(); const note = await addSharedNote(f, t);
    const histories = [...f.sessions.histories]; f.sessions.busy.add(t.a);
    await f.app.command({ type: 'task.move', taskId: t.id, columnId: 'in_progress', mode: 'run', sessionId: t.b, expectedInstruction: approvedInstruction, worktree: { mode: 'new', path: f.tree, branchName: 'task/cancelled-product', sourceBranch: 'main' } });
    expect(f.app.store.requireTask(t.id).pendingTransition?.status).toBe('waiting');
    await f.app.command({ type: 'operation.return', taskId: t.id });
    expect(f.app.store.requireTask(t.id).pendingTransition).toBeUndefined();
    expect(f.app.store.requireTask(t.id).operation?.phase).toBe('waiting');
    expect(f.sessions.sent).toEqual([]); expect(f.sessions.switches).toEqual([]);
    f.sessions.busy.delete(t.a); f.app.activityChanged();
    await expect.poll(() => f.app.store.requireTask(t.id).operation, { timeout: 5000 }).toBeNull();
    expect(f.app.store.requireTask(t.id)).toMatchObject({ columnId: 'backlog', sessionIds: [t.a, t.b], worktree: null, effectiveCwd: f.project.projectPath });
    expect(f.sessions.dirs.get(t.a)).toBe(f.project.projectPath); expect(f.sessions.dirs.get(t.b)).toBe(f.project.projectPath);
    expect(f.sessions.sent).toEqual([]); expect(f.sessions.archived).toEqual([]); expect([...f.sessions.histories]).toEqual(histories);
    expect(f.app.store.snapshot().notes).toEqual([note]);
    await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await gitOk(f.project.gitRootPath, ['branch', '--list', 'task/cancelled-product'])).trim()).toBe('');
    expect(f.executor.calls.some(args => args.includes('worktree') && args.includes('add'))).toBe(false);
    f.noNativeDestruction();
  }, 15000);

  // PW03 maps product tasks 4.7, 6.4, 8.4, 9.4: removing only isolation retains the task and shared notes.
  it('PW03 declines dirty worktree removal, then discards explicitly while preserving task, notes, branch, and histories', async () => {
    const f = await setup(); const t = await f.task(); const note = await addSharedNote(f, t); const histories = [...f.sessions.histories];
    await f.app.command({ type: 'worktree.create', taskId: t.id, mode: 'new', path: f.tree, branchName: 'task/remove-isolation', sourceBranch: 'main' });
    expect(f.app.store.requireTask(t.id).operation).toBeNull();
    const targetDirectory = path.join(f.tree, 'packages', 'api');
    expect(f.sessions.dirs.get(t.a)).toBe(targetDirectory); expect(f.sessions.dirs.get(t.b)).toBe(targetDirectory);
    await writeFile(path.join(targetDirectory, 'untracked.txt'), 'discard only after consent\n');
    await expect(f.app.command({ type: 'worktree.remove', taskId: t.id, confirmed: false, expectedWorktreePath: f.tree })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(f.app.command({ type: 'worktree.remove', taskId: t.id, confirmed: true, expectedWorktreePath: f.tree, discardChanges: false })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    expect(f.app.store.requireTask(t.id).operation).toMatchObject({ phase: 'failed', error: { code: 'DISCARD_REQUIRED' } });
    expect(f.executor.removals).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true);
    await f.app.command({ type: 'worktree.remove', taskId: t.id, confirmed: true, expectedWorktreePath: f.tree, discardChanges: true });
    expect(f.executor.removals).toEqual([{ directories: [[t.a, f.project.projectPath], [t.b, f.project.projectPath]], archived: [] }]);
    expect(f.app.store.requireTask(t.id)).toMatchObject({ sessionIds: [t.a, t.b], worktree: null, operation: null, effectiveCwd: f.project.projectPath });
    expect(await f.tool('list_notes', {}, t.a)).toEqual([note]); expect(await f.tool('list_notes', {}, t.b)).toEqual([note]);
    expect(f.sessions.archived).toEqual([]); expect(f.sessions.sent).toEqual([]); expect([...f.sessions.histories]).toEqual(histories);
    expect((await gitOk(f.project.gitRootPath, ['branch', '--list', 'task/remove-isolation'])).trim()).toContain('task/remove-isolation');
    expect(await readFile(path.join(f.project.projectPath, 'app.txt'), 'utf8')).toBe('initial\n');
    f.noNativeDestruction();
  }, 15000);


  // PW04 maps tasks 2.2/2.3, 6.2/6.4 and 8.1: ordinary and bound callers discover the same product metadata.
  it('PW04 checks canonical project metadata, scoped Git identity, discovery, and shared-note task isolation', async () => {
    const f = await setup();
    await f.app.command({ type: 'project.save', project: { id: 'root-project', name: 'Repository-root project', projectPath: f.project.gitRootPath, gitRootPath: f.project.gitRootPath, defaultBranch: 'main' } });
    await f.app.command({ type: 'project.save', project: { id: 'root-project', name: 'Repository-root project', projectPath: f.project.gitRootPath + '/.', gitRootPath: f.project.gitRootPath + '/packages/..', defaultBranch: 'main' } });
    expect(f.app.store.requireProject('root-project')).toMatchObject({ projectPath: f.project.gitRootPath, gitRootPath: f.project.gitRootPath });
    expect(f.executor.calls).toEqual([]); // Project metadata registration does not invent a Git participant or execute Git.
    const beforeInvalid = f.app.store.snapshot();
    await expect(f.app.command({ type: 'project.save', project: { id: 'escape', name: 'Escaping project', projectPath: f.root, gitRootPath: f.project.gitRootPath } })).rejects.toMatchObject({ code: 'INVALID_PROJECT_PATH' });
    await expect(f.app.command({ type: 'project.save', project: { id: 'missing', name: 'Missing project', projectPath: path.join(f.root, 'missing'), gitRootPath: f.project.gitRootPath } })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.app.store.snapshot()).toEqual(beforeInvalid);
    const a = await f.task(); const note = await addSharedNote(f, a);
    const b = await f.app.createTask({ projectId: 'root-project', title: 'Independent other task', description: 'Different shared-note collection' });
    expect(await f.tool('list_projects', {})).toEqual(f.app.store.snapshot().projects);
    expect(await f.tool('list_projects', {}, a.a)).toEqual(await f.tool('list_projects', {}));
    expect(await f.tool('list_boards', {})).toEqual([{ id: 'global', name: 'Kanban' }]);
    expect(await f.tool('list_boards', {}, a.b)).toEqual(await f.tool('list_boards', {}));
    expect(await f.tool('get_board_summary', {})).toMatchObject({ id: 'global', columns: expect.arrayContaining([expect.objectContaining({ id: 'backlog', count: 2 })]) });
    expect(await f.tool('get_board_summary', {}, a.a)).toEqual(await f.tool('get_board_summary', {}));
    expect(await f.tool('list_cards', { project_id: f.project.id, query: 'PRODUCT WALKTHROUGH', limit: 1 })).toEqual([f.app.store.requireTask(a.id)]);
    expect(await f.tool('list_cards', { project_id: 'root-project', limit: 1 }, a.b)).toEqual([b]);
    expect(await f.tool('list_cards', { query: 'does not match', limit: 1 })).toEqual([]);
    expect(await f.tool('list_cards', {})).toHaveLength(2); expect(await f.tool('list_cards', { limit: 1 })).toHaveLength(1);
    expect(await f.tool('get_card', { task_id: a.id })).toEqual({ task: f.app.store.requireTask(a.id), project: f.app.store.requireProject(f.project.id) });
    expect(await f.tool('get_card', { task_id: a.id }, a.b)).toEqual(await f.tool('get_card', { task_id: a.id }));
    expect(await f.tool('list_notes', { task_id: a.id })).toEqual([note]);
    expect(await f.tool('list_notes', {}, b.sessionIds[0]!)).toEqual([]);
    const beforeWrongNote = f.app.store.snapshot();
    await expect(f.tool('update_note', { id: note.id, content: 'Must not cross tasks' }, b.sessionIds[0]!)).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(f.tool('update_note', { task_id: b.id, id: note.id, content: 'Must not cross tasks' })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(f.tool('create_note', { content: 'Missing task context' })).rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    await expect(f.tool('list_notes', {})).rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    expect(f.app.store.snapshot()).toEqual(beforeWrongNote);
    // Git identity is verified only during a scoped Git action, not metadata registration.
    const wrong = { ...f.project, gitRootPath: f.project.projectPath };
    const git = new GitAdapter(f.executor);
    await expect(git.branches(wrong, [a.a, a.b])).rejects.toMatchObject({ code: 'INVALID_GIT_ROOT' });
    const wrongTree = path.join(f.root, 'wrong-configured-root-tree');
    await expect(git.create(wrong, { mode: 'new', path: wrongTree, branchName: 'task/wrong-configured-root', sourceBranch: 'main' }, [a.a, a.b])).rejects.toMatchObject({ code: 'INVALID_GIT_ROOT' });
    await expect(stat(wrongTree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await gitOk(f.project.gitRootPath, ['branch', '--list', 'task/wrong-configured-root'])).trim()).toBe('');
    expect(f.app.store.snapshot()).toEqual(beforeWrongNote);
    expect(f.sessions.sent).toEqual([]); expect(f.sessions.archived).toEqual([]); f.noNativeDestruction();
  }, 15000);

});
