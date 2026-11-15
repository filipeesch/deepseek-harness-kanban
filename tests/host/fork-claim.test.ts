import { describe, expect, it } from 'vitest';
import { ForkAdopter } from '../../src/host/conversation-adoption.js';
import { createForkClaim, type ForkClaimPort } from '../../src/host/fork-claim.js';
import { fixture, taskWithConversation } from './helpers.js';

/** The same native ports the plugin entry composes for adoption. */
function adopterFor(app: Awaited<ReturnType<typeof fixture>>['app']): ForkAdopter {
  return new ForkAdopter({
    locate: sessionId => {
      const located = app.locator.bySession(sessionId);
      return located === undefined ? undefined : { hubId: located.hubId, taskId: located.task.id, effectiveCwd: located.task.effectiveCwd };
    },
    directory: sessionId => app.sessions.directory(sessionId),
    setDirectory: (sessionId, directory) => app.sessions.setDirectory(sessionId, directory),
    attach: (hubId, taskId, sessionId, expectedEffectiveCwd) => app.hubs.hub(hubId).addSession(taskId, sessionId, expectedEffectiveCwd).then(() => undefined),
    sleep: async () => undefined,
  });
}

function claimFor(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<{ lineage: (sessionId: string) => Promise<{ parentSessionId?: string; origin?: 'subagent' }> }> = {}): ForkClaimPort {
  const adopter = adopterFor(f.app);
  return createForkClaim({
    adopter,
    lineage: overrides.lineage ?? (async sessionId => f.sessions.lineage.get(sessionId) ?? {}),
    taskOfSession: sessionId => f.app.locator.bySession(sessionId)?.task.id,
  });
}

describe('fork claim command', () => {
  it('attaches a branch of a task conversation and keeps it open', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Claim task', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      const claim = claimFor(f);
      f.app.attachForkClaim(claim);
      const result = await f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork });
      expect(result.commandReceipt).toEqual({ kind: 'conversation', id: fork });
      const stored = f.app.hubs.requireTask(task.id).task;
      expect(stored.sessionIds).toEqual([parent, fork]);
      expect(stored.closedSessionIds).not.toContain(fork);
      expect(await f.sessions.directory(fork)).toBe(task.effectiveCwd);
    } finally { await f.close(); }
  });

  it('treats an already attached branch as a success', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Twice', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', task.effectiveCwd);
      f.app.attachForkClaim(claimFor(f));
      await f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork });
      const again = await f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork });
      expect(again.commandReceipt).toEqual({ kind: 'conversation', id: fork });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent, fork]);
    } finally { await f.close(); }
  });

  it('refuses a branch whose recorded parent is not the claimed conversation', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Mismatch', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork('someone-else', 'fork', f.root);
      f.app.attachForkClaim(claimFor(f));
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork }))
        .rejects.toMatchObject({ code: 'FORK_LINEAGE_MISMATCH' });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
    } finally { await f.close(); }
  });

  it('refuses a branch taken from a subagent descendant', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Subagent fork', description: '' });
      const parent = task.sessionIds[0]!;
      const child = f.sessions.seedSubagent(parent, 'child', task.effectiveCwd);
      const fork = f.sessions.seedFork(child, 'fork', f.root);
      f.app.attachForkClaim(claimFor(f));
      // The source is a descendant, not a conversation of the task.
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: child, sessionId: fork }))
        .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
    } finally { await f.close(); }
  });

  it('refuses a claim whose recorded Session is a subagent descendant', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Descendant lineage', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      const claim = createForkClaim({
        adopter: adopterFor(f.app),
        lineage: async () => ({ parentSessionId: parent, origin: 'subagent' }),
        taskOfSession: sessionId => f.app.locator.bySession(sessionId)?.task.id,
      });
      await expect(claim.claim({ taskId: task.id, parentSessionId: parent, sessionId: fork }))
        .rejects.toMatchObject({ code: 'FORK_LINEAGE_MISMATCH' });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
    } finally { await f.close(); }
  });

  it('refuses a parent that is not a conversation of the task', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No parent', description: '' });
      const other = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Other', description: '' });
      const fork = f.sessions.seedFork(other.sessionIds[0]!, 'fork', f.root);
      f.app.attachForkClaim(claimFor(f));
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: other.sessionIds[0]!, sessionId: fork }))
        .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    } finally { await f.close(); }
  });

  it('refuses the claim when the host has no claim port', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No port', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork }))
        .rejects.toMatchObject({ code: 'FORK_CLAIM_UNAVAILABLE' });
    } finally { await f.close(); }
  });

  it('refuses when the branch directory cannot be aligned', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Unavailable', description: '' });
      const parent = task.sessionIds[0]!;
      // Seeded without a directory, so alignment cannot read the branch.
      f.sessions.lineage.set('fork', { parentSessionId: parent });
      f.app.attachForkClaim(claimFor(f));
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: 'fork' }))
        .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
    } finally { await f.close(); }
  });

  it('reports a claim that exhausts the busy retry with the claim wording', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Busy', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      // One attempt, and the host keeps refusing the attach while a context operation runs.
      const claim = createForkClaim({
        adopter: new ForkAdopter({
          locate: sessionId => {
            const located = f.app.locator.bySession(sessionId);
            return located === undefined ? undefined : { hubId: located.hubId, taskId: located.task.id, effectiveCwd: located.task.effectiveCwd };
          },
          directory: sessionId => f.app.sessions.directory(sessionId),
          setDirectory: (sessionId, directory) => f.app.sessions.setDirectory(sessionId, directory),
          attach: async () => { throw Object.assign(new Error('Cannot add a conversation during a context operation.'), { code: 'TASK_BUSY' }); },
          sleep: async () => undefined,
        }, { attempts: 1 }),
        lineage: async sessionId => f.sessions.lineage.get(sessionId) ?? {},
        taskOfSession: sessionId => f.app.locator.bySession(sessionId)?.task.id,
        signal: undefined,
      });
      f.app.attachForkClaim(claim);
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork }))
        .rejects.toMatchObject({ code: 'TASK_BUSY', message: expect.stringContaining('stayed busy') });
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
    } finally { await f.close(); }
  });

  it('reports the branch as unavailable when its history cannot be read', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Unreadable', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      const claim = createForkClaim({
        adopter: adopterFor(f.app),
        lineage: async () => { throw new Error('unreadable'); },
        taskOfSession: () => undefined,
      });
      f.app.attachForkClaim(claim);
      await expect(f.app.command({ type: 'conversation.attach', taskId: task.id, parentSessionId: parent, sessionId: fork }))
        .rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
    } finally { await f.close(); }
  });
});
