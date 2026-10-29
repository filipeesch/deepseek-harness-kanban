import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GitExecutor, CommandResult, SessionPort } from '../../src/shared/ports.js';
import type { GitProject, HubState, Project, SessionFacts } from '../../src/shared/types.js';
import { KanbanError } from '../../src/shared/errors.js';

const exec = promisify(execFile);
const prefix = 'dsh-kanban-worktrees-';
const cleanupRoots = new Set<string>();
export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<CommandResult> {
  try { const result = await exec('git', args, { cwd, signal, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } }); return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error) { const value = error as Error & { code?: number; stdout?: string; stderr?: string }; if (typeof value.code !== 'number') throw error; return { exitCode: value.code, stdout: value.stdout ?? '', stderr: value.stderr ?? '' }; }
}
export async function gitOk(cwd: string, args: string[]): Promise<string> { const result = await git(cwd, args); if (result.exitCode !== 0) throw new Error(result.stderr); return result.stdout; }
export async function fixture(): Promise<{ root: string; project: GitProject; tree: string }> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanupRoots.add(root);
  const repo = path.join(root, 'repo');
  const projectPath = path.join(repo, 'packages', 'api');
  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, 'app.txt'), 'initial\n');
  await writeFile(path.join(repo, 'root.txt'), 'root\n');
  await gitOk(repo, ['init', '--initial-branch=main']);
  await gitOk(repo, ['config', 'user.email', 'worktree-test@example.invalid']);
  await gitOk(repo, ['config', 'user.name', 'Worktree Test']);
  await gitOk(repo, ['config', 'commit.gpgsign', 'false']);
  await gitOk(repo, ['add', '.']);
  await gitOk(repo, ['commit', '-m', 'Initial fixture']);
  return { root, project: { id: 'project', name: 'API', gitRootPath: repo, projectPath, defaultBranch: 'main' }, tree: path.join(root, 'trees', 'feature') };
}
export async function cleanup(): Promise<void> {
  const temporaryRoot = await realpath(tmpdir());
  for (const root of cleanupRoots) {
    // Verify the resolved absolute target before every recursive test cleanup.
    if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith(prefix) || await realpath(root) !== root) throw new Error('Unsafe test cleanup path: ' + root);
    await rm(root, { recursive: true, force: true });
    cleanupRoots.delete(root);
  }
}
export class LocalExecutor implements GitExecutor {
  calls: string[][] = [];
  policies: Array<{ paths: string[]; ids: string[]; write: boolean }> = [];
  deny: ((paths: string[], write: boolean) => boolean) | undefined;
  fail: ((args: string[]) => CommandResult | undefined) | undefined;
  async run(project: GitProject, args: string[], _ids: string[], signal?: AbortSignal): Promise<CommandResult> {
    this.calls.push([...args]);
    return this.fail?.(args) ?? git(project.gitRootPath, args, signal);
  }
  async assertPolicy(_project: GitProject, paths: string[], ids: string[], write: boolean): Promise<void> {
    this.policies.push({ paths, ids, write });
    if (this.deny?.(paths, write)) throw new KanbanError('FS_SANDBOX_DENIED', 'Injected sandbox denial.');
  }
}
export class MemoryStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(public state: HubState) {}
  snapshot(): HubState { return structuredClone(this.state); }
  transact(change: (draft: HubState) => void): Promise<void> {
    const result = this.chain.then(() => { const next = this.snapshot(); change(next); next.revision++; this.state = next; });
    this.chain = result.catch(() => {});
    return result;
  }
  locate(taskId: string) {
    const state = this.snapshot();
    const task = state.tasks.find(value => value.id === taskId);
    if (!task) throw new KanbanError('TASK_NOT_FOUND', 'The task does not exist.');
    const project = state.projects.find(value => value.id === task.projectId);
    if (!project) throw new KanbanError('PROJECT_NOT_FOUND', 'The task project does not exist.');
    return { hubId: state.id, hub: state, task, project };
  }
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T> {
    let value!: T;
    return this.transact(draft => { value = change(draft); }).then(() => value);
  }
  allTasks() { return this.snapshot().tasks; }
}
export function board(project: Project): HubState {
  const now = new Date().toISOString();
  return { id: 'hub', name: 'Test Hub', revision: 0, projects: [project], boards: [{ id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Default', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: now, updatedAt: now }], notes: [{ id: 'note', taskId: 'task', content: 'Retained note', createdAt: '', updatedAt: '' }], tasks: [{ id: 'task', boardId: 'board', projectId: project.id, title: 'Task', description: '', columnId: 'backlog', position: 0, sessionIds: ['a', 'b'], closedSessionIds: [], effectiveCwd: project.projectPath, worktree: null, operation: null, createdAt: '', updatedAt: '' }], createdAt: now, updatedAt: now };
}
export class Sessions implements SessionPort {
  active = new Set<string>();
  dirs = new Map<string, string>();
  lineage = new Map<string, { parentSessionId?: string; origin?: 'subagent' }>();
  setCalls: Array<{ id: string; directory: string }> = [];
  archiveCalls: string[] = [];
  beforeSet: ((id: string, directory: string, signal?: AbortSignal) => void | Promise<void>) | undefined;
  beforeArchive: ((id: string) => void | Promise<void>) | undefined;
  constructor(base: string) { this.dirs.set('a', base); this.dirs.set('b', base); }
  async create(base: string): Promise<string> { const id = 'session-' + this.dirs.size; this.dirs.set(id, base); return id; }
  async directory(id: string): Promise<string> { const value = this.dirs.get(id); if (!value) throw new Error('Unknown session ' + id); return value; }
  async validateDirectory(id: string, expected: string): Promise<void> {
    const target = await realpath(expected);
    if (await realpath(await this.directory(id)) !== target || !(await stat(target)).isDirectory()) throw new KanbanError('CONTEXT_MISMATCH', 'The recorded test session directory is not the expected directory.');
  }
  async setDirectory(id: string, directory: string, signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); this.setCalls.push({ id, directory }); await this.beforeSet?.(id, directory, signal); signal?.throwIfAborted(); this.dirs.set(id, directory); }
  async isIdle(id: string): Promise<boolean> { return !this.active.has(id); }
  async send(): Promise<void> {}
  async archive(id: string): Promise<void> { await this.beforeArchive?.(id); this.archiveCalls.push(id); }
  async facts(): Promise<SessionFacts> { return { turn: false, background: [], awaitingReply: false, failed: false }; }
  async directories(): Promise<Array<{ sessionId: string; directory: string }>> { return [...this.dirs].map(([sessionId, directory]) => ({ sessionId, directory })); }
  /** Add a real-child-like session for ownership tests. Pass `origin: undefined` for a fork. */
  seedSubagent(parent: string, child: string, directory: string, origin: 'subagent' | undefined = 'subagent'): string {
    this.dirs.set(child, directory);
    this.lineage.set(child, { parentSessionId: parent, ...(origin ? { origin } : {}) });
    return child;
  }
  async topology(within?: string) {
    const related = within === undefined ? [] : [...this.dirs]
      .filter(([, directory]) => inside(within, directory))
      .map(([sessionId, directory]) => ({ sessionId, directory }));
    return {
      related,
      lineage: [...this.dirs.keys()].map(sessionId => ({
        sessionId,
        ...(this.lineage.get(sessionId) ?? {}),
      })),
    };
  }
}
function inside(root: string, candidate: string): boolean {
  const part = path.relative(root, candidate);
  return part === '' || (!path.isAbsolute(part) && part !== '..' && !part.startsWith('..' + path.sep));
}
