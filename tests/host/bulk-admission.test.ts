import { afterEach, describe, expect, it } from 'vitest';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

describe('bulk deletion admission', () => {
  it('admits ten selected deletions while the repository lane is busy', async () => {
    const f = await setup();
    const blocker = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Lane blocker', description: '' });
    let releaseArchive!: () => void;
    const archiveGate = new Promise<void>(resolve => { releaseArchive = resolve; });
    const archive = f.sessions.archive.bind(f.sessions);
    f.sessions.archive = async (id: string) => { await archiveGate; return archive(id); };
    await f.app.command({ type: 'task.delete', taskId: blocker.id, confirmed: true, expectedWorktreePath: null });
    await expect.poll(() => f.store.requireTask(blocker.id).operation?.phase, { timeout: 5000 }).toBe('archiving');

    const tasks = await Promise.all(Array.from({ length: 10 }, (_, index) => f.app.createTask({ projectId: f.project.id, title: 'Bulk ' + index, description: '' })));
    const started = performance.now();
    await Promise.all(tasks.map(task => f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null })));
    const elapsed = performance.now() - started;

    for (const task of tasks) expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    expect(f.sessions.archived).toEqual([]);
    console.log('[measurement] ten concurrent deletion admissions completed in ' + elapsed.toFixed(1) + 'ms');
    expect(elapsed).toBeLessThan(2000);

    f.sessions.archive = archive;
    releaseArchive();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks).toHaveLength(0);
  });
});
