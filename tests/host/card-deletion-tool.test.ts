import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { KanbanError } from '../../src/shared/errors.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanApp } from '../../src/host/app.js';
import path from 'node:path';
import { fixture, taskWithConversation } from './helpers.js';
import { NativeExecutionOwnership } from '../../src/host/scripted/ownership.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const active: Fixture[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<Fixture> {
  const f = await fixture();
  active.push(f);
  return f;
}

function context(sessionId: string): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id: sessionId }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

function definition(f: Fixture, name: string): ToolDefinition {
  const found = productToolDefinitions(f.app).find(candidate => candidate.name === name);
  if (!found) throw new Error('Missing tool ' + name);
  return found;
}

async function run(f: Fixture, args: Record<string, unknown>, sessionId = 'ordinary-session'): Promise<any> {
  return definition(f, 'delete_card').execute(args, context(sessionId));
}

describe('the delete_card tool surface', () => {
  it('declares no worktree path, discard, or force parameter', async () => {
    const f = await setup();
    const parameters = definition(f, 'delete_card').parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(parameters.properties).sort()).toEqual(['confirmed', 'hub_id', 'task_id']);
    // The confirmation is deliberately not schema-required: an omitted flag must reach
    // the product refusal instead of being rejected by the argument validator first.
    expect(parameters.required ?? []).not.toContain('confirmed');
  });

  it('is declared as a card write, not as a concurrency-safe read', async () => {
    const f = await setup();
    // The declaration must be present and false: an absent predicate would read as
    // concurrency-safe on hosts that default to it.
    expect(definition(f, 'delete_card').isConcurrencySafe?.({ task_id: 'x', confirmed: true })).toBe(false);
  });

  it('states the explicit-request rule in its description', async () => {
    const f = await setup();
    const description = definition(f, 'delete_card').description;
    expect(description).toContain('explicitly requests');
    expect(description).toContain('stage instruction');
    expect(description).toContain('another card');
    expect(description).toContain('confirmed:true');
  });
});

describe('admitting a deletion through the tool', () => {
  it('reports the card, the Hub, the phase, and the consequences', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Delete me', description: '' });
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.card.id).toBe(target.id);
    expect(value.hubId).toBe(f.hub.id);
    expect(value.operation).toMatchObject({ kind: 'delete' });
    // The receipt reports the admission phase, not a later reading of the journal.
    expect(value.operation.phase).toBe('queued');
    expect(value.consequences.conversations.total).toBe(target.sessionIds.length);
    expect(value.consequences.checkout).toBeUndefined();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
  });

  it('removes the card in the background instead of claiming it is gone', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Eventually gone', description: '' });
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.card.id).toBe(target.id);
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(true);
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
  });

  it('resolves its own card when a task conversation names none', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Delete myself', description: '' });
    const value = await run(f, { confirmed: true }, target.sessionIds[0]!);
    expect(value.card.id).toBe(target.id);
    expect(value.hubId).toBe(f.hub.id);
    await f.app.worktrees.settle();
    // The card is removed once its own conversation is idle, exactly as the drawer deletes it.
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
  });
});

describe('refusals and deferred outcomes', () => {
  it('refuses a call with no confirmation flag at all', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'No flag', description: '' });
    await expect(run(f, { task_id: target.id, hub_id: f.hub.id })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.store.requireTask(target.id).operation).toBeNull();
  });

  it('refuses a call whose confirmation is false', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Needs consent', description: '' });
    await expect(run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.store.requireTask(target.id).operation).toBeNull();
  });

  it('refuses a card of another Hub than the selected scope', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Other hub card', description: '' });
    await f.app.command({ type: 'hub.create', name: 'Second' });
    const second = f.hubs.list().find(hub => hub.name === 'Second')!;
    await expect(run(f, { task_id: target.id, confirmed: true, hub_id: second.id })).rejects.toMatchObject({ code: 'TASK_OUTSIDE_HUB' });
    expect(f.store.requireTask(target.id).operation).toBeNull();
  });

  it('refuses a call that names no card outside a task conversation', async () => {
    const f = await setup();
    await expect(run(f, { confirmed: true })).rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
  });

  it('refuses a card identifier that names no task', async () => {
    const f = await setup();
    await expect(run(f, { task_id: 'ghost', confirmed: true })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });
});
describe('deferred outcomes of an admitted deletion', () => {
  it('reports pending local changes and never discards them', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Dirty card', description: '' });
    const root = path.join(f.root, 'trees', 'dirty-card');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/dirty-card', sourceBranch: 'main' });
    f.git.trees.set(root, { path: root, branch: 'task/dirty-card', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.consequences.checkout.localChanges).toBe('changes');
    await f.app.worktrees.settle();
    // The preflight records the failure on the card and removes nothing.
    expect(f.store.requireTask(target.id).operation?.error?.code).toBe('DISCARD_REQUIRED');
    expect(f.git.removed).toEqual([]);
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(true);
  });

  it('waits for a running conversation instead of stopping it', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Busy card', description: '' });
    f.sessions.busy.add(target.sessionIds[0]!);
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.operation.phase).toBe('queued');
    await f.app.worktrees.settle();
    expect(f.store.requireTask(target.id).operation?.phase).toBe('waiting');
    expect(f.sessions.archived).toEqual([]);
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(true);
    // The conversation keeps running; the deletion resumes only after it settles.
    expect(f.sessions.busy.has(target.sessionIds[0]!)).toBe(true);
    // Once it is idle, the same journal finishes: the conversation is archived and the
    // card leaves the board, with no new confirmation asked.
    f.sessions.busy.delete(target.sessionIds[0]!);
    await f.app.worktrees.resumePending();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
    expect(f.sessions.archived).toEqual(target.sessionIds);
  });
});

describe('the calling scope boundary', () => {
  it('refuses a card of another Hub from a task conversation', async () => {
    const f = await setup();
    const mine = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Mine', description: '' });
    await f.app.command({ type: 'hub.create', name: 'Second' });
    const second = f.hubs.list().find(hub => hub.name === 'Second')!;
    await f.hubs.hub(second.id).addBoard('Other');
    const project = await f.hubs.hub(second.id).saveProject({ name: 'Other', projectPath: f.projectPath, gitRootPath: f.gitRoot });
    const foreign = await f.hubs.hub(second.id).createTask({ projectId: project.id, title: 'Foreign', description: '' });
    await expect(run(f, { task_id: foreign.id, confirmed: true }, mine.sessionIds[0]!)).rejects.toMatchObject({ code: 'TASK_OUTSIDE_HUB' });
    await expect(run(f, { task_id: foreign.id, hub_id: second.id, confirmed: true }, mine.sessionIds[0]!)).rejects.toMatchObject({ code: 'TASK_OUTSIDE_HUB' });
    expect(f.hubs.requireTask(foreign.id).task.operation).toBeNull();
  });

  it('deletes another card of the same Hub from a task conversation', async () => {
    const f = await setup();
    const mine = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Mine', description: '' });
    const other = await f.app.createTask({ projectId: f.project.id, title: 'Sibling', description: '' });
    const value = await run(f, { task_id: other.id, confirmed: true }, mine.sessionIds[0]!);
    expect(value.card.id).toBe(other.id);
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(card => card.id === other.id)).toBe(false);
    expect(f.store.snapshot().tasks.some(card => card.id === mine.id)).toBe(true);
  });

  it('requires a Hub outside a task conversation', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Needs a Hub', description: '' });
    await expect(run(f, { task_id: target.id, confirmed: true })).rejects.toMatchObject({ code: 'HUB_CONTEXT_REQUIRED' });
    expect(f.store.requireTask(target.id).operation).toBeNull();
  });

  it('refuses a blank task identifier instead of deleting the caller own card', async () => {
    const f = await setup();
    const mine = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Mine', description: '' });
    await expect(run(f, { task_id: '   ', confirmed: true }, mine.sessionIds[0]!)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.store.requireTask(mine.id).operation).toBeNull();
  });
});


  it('changes nothing in a live Hub or on the Git port', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Preview only', description: '' });
    const root = path.join(f.root, 'trees', 'preview-only');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/preview-only', sourceBranch: 'main' });
    const before = JSON.stringify(f.hubs.requireHub(f.hub.id));
    const removed = [...f.git.removed];
    const preview = await f.app.preview({ hub: f.hubs.requireHub(f.hub.id), task: f.store.requireTask(target.id), project: f.project });
    expect(preview.checkout?.disposition).toBe('remove');
    // A consequence read reports; it never mutates the Hub or removes anything.
    expect(JSON.stringify(f.hubs.requireHub(f.hub.id))).toBe(before);
    expect(f.git.removed).toEqual(removed);
  });

  it('finishes the whole cleanup in the background for an agent-admitted deletion', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Full cleanup', description: '' });
    const sibling = await f.app.createTask({ projectId: f.project.id, title: 'Sibling kept', description: '' });
    const root = path.join(f.root, 'trees', 'full-cleanup');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/full-cleanup', sourceBranch: 'main' });
    await f.store.saveNote(target.id, { content: 'Goes with the card' });
    await f.store.createRelations([{ type: 'epic', from: target.id, to: sibling.id }]);
    f.sessions.busy.delete(target.sessionIds[0]!);
    // The fake Git only knows the branches it is told about, so the created branch is
    // registered here; the assertion then means what it says.
    f.git.branchNames.push('task/full-cleanup');
    const branchesBefore = [...f.git.branchNames];
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.consequences).toMatchObject({ notes: 1, relations: 1 });
    await f.app.worktrees.settle();
    const stored = f.hubs.requireHub(f.hub.id);
    expect(stored.tasks.some(card => card.id === target.id)).toBe(false);
    expect(stored.tasks.some(card => card.id === sibling.id)).toBe(true);
    expect(stored.notes).toEqual([]);
    // The relation lost its endpoint, so it had to go with the card.
    expect(stored.relations).toEqual([]);
    // The conversations are archived with their histories kept, and the checkout is
    // removed while the branch list is untouched: the deletion never deletes a branch.
    expect(f.sessions.archived).toEqual([target.sessionIds[0]]);
    expect(f.git.removed).toEqual([root]);
    expect(f.git.branchNames).toEqual(branchesBefore);
  });

  it('resumes an agent-admitted deletion after a restart', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Resume after restart', description: '' });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const archive = f.sessions.archive.bind(f.sessions);
    f.sessions.archive = async (id: string) => { await gate; return archive(id); };
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.operation.phase).toBe('queued');
    await expect.poll(() => f.store.requireTask(target.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
    const closing = f.app.close();
    release();
    await closing;
    // The journal survives the close, so a restart resumes the same deletion without
    // asking the person to confirm it again.
    expect(f.store.requireTask(target.id).operation?.phase).toBe('queued');
    f.sessions.archive = archive;
    const reopened = new KanbanApp(await HubRepository.open(f.storage), f.sessions, f.git, { probe: f.probe }, f.workspaces);
    await reopened.initialize();
    await reopened.worktrees.settle();
    expect(reopened.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
    await reopened.close();
  });


describe('the interface refusals reach the tool', () => {
  it('refuses a card another context operation holds', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Held', description: '' });
    const root = path.join(f.root, 'trees', 'held');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/held', sourceBranch: 'main' });
    // A recorded operation holds the card: the command lane refuses a second context
    await f.store.transact(draft => {
      draft.tasks.find(card => card.id === target.id)!.operation = {
        id: 'held-op', request: { kind: 'create', mode: 'new', path: root, branchName: 'task/held' },
        phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false,
        createdAt: new Date().toISOString(),
      };
    });
    const before = JSON.stringify(f.store.requireTask(target.id).operation);
    await expect(run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true }))
      .rejects.toMatchObject({ code: 'CONTEXT_OPERATION_PENDING' });
    expect(JSON.stringify(f.store.requireTask(target.id).operation)).toBe(before);
  });

  it('refuses a confirmed target that no longer matches the binding', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Rebound', description: '' });
    const root = path.join(f.root, 'trees', 'rebound');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/rebound', sourceBranch: 'main' });
    // The binding moves between the read and the command, as a concurrent rebind would.
    const located = f.store.requireTask(target.id);
    await f.store.transact(draft => {
      draft.tasks.find(card => card.id === target.id)!.worktree = { ...located.worktree!, path: path.join(f.root, 'trees', 'moved') };
    });
    await expect(f.app.requestDeletion({ hubId: f.hub.id, taskId: target.id, expectedWorktreePath: root, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
  });

  it('records nothing when the caller is cancelled before the journal is written', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Cancelled in lane', description: '' });
    // The per-task lane is the last gate before the journal, so an already-cancelled
    // caller must be refused there even when every earlier check passed.
    const controller = new AbortController();
    controller.abort();
    await expect(f.app.worktrees.request(target.id, { kind: 'delete', discardChanges: false, expectedWorktreePath: null }, { background: true, signal: controller.signal, freshDestructive: true }))
      .rejects.toThrow();
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
    expect(f.git.removed).toEqual([]);
  });
});

describe('recovery stays an interface decision', () => {



  it('admits a deletion whose checkout cannot be resolved, leaving the outcome to the preflight', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Unresolved checkout', description: '' });
    const root = path.join(f.root, 'trees', 'unresolved-checkout');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/unresolved-checkout', sourceBranch: 'main' });
    // Only the consequence read fails; the queued preflight keeps its own authority.
    const directory = f.git.projectDirectory.bind(f.git);
    let calls = 0;
    f.git.projectDirectory = async (...callArgs) => { calls += 1; if (calls === 1) throw new KanbanError('INVALID_DIRECTORY', 'Not a directory.'); return directory(...callArgs); };
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.consequences.checkout).toMatchObject({ disposition: 'unavailable', localChanges: 'unavailable' });
    expect(value.operation.phase).toBe('queued');
    // The admission is real: the queued work still owns the outcome.
    expect(f.store.requireTask(target.id).operation?.request.kind).toBe('delete');
    await f.app.worktrees.settle();
  });

  it('does not admit a deletion when the call is cancelled during the consequence read', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Cancelled', description: '' });
    const root = path.join(f.root, 'trees', 'cancelled');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/cancelled', sourceBranch: 'main' });
    // The consequence read is the slow part; cancellation lands between it and admission.
    const controller = new AbortController();
    const localChanges = f.git.localChanges.bind(f.git);
    f.git.localChanges = async (...callArgs) => { controller.abort(); return localChanges(...callArgs); };
    const exec = { signal: controller.signal, agent: { id: 'ordinary-session' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    await expect(definition(f, 'delete_card').execute({ task_id: target.id, hub_id: f.hub.id, confirmed: true }, exec)).rejects.toThrow();
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
    expect(f.git.removed).toEqual([]);
  });


  it('records nothing when the caller is cancelled while the Hub write queue is busy', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Queued behind storage', description: '' });
    // Hold the Hub mutation queue from the test itself, so the deletion journal write is
    // known to be waiting inside the repository when the signal fires.
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const holder = f.app.store.transact(() => { entered(); return gate; });
    await holding;
    const controller = new AbortController();
    // The journal transaction is submitted eagerly and then waits on the queue, so the
    // spy is the deterministic proof that the write is queued when the signal fires.
    const submitted = vi.spyOn(f.hubs, 'transact');
    const pending = f.app.worktrees.request(target.id, { kind: 'delete', discardChanges: false, expectedWorktreePath: null }, { background: true, signal: controller.signal, freshDestructive: true });
    await expect.poll(() => submitted.mock.calls.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    controller.abort();
    release();
    await holder;
    await expect(pending).rejects.toThrow();
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
    expect(f.git.removed).toEqual([]);
  });


  it('leaves the card pending transition in place when the cancelled write never records a journal', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Keeps its transition', description: '' });
    await f.store.transact(draft => {
      draft.tasks.find(card => card.id === target.id)!.pendingTransition = {
        // A failed transition is the one the pending runner does not dispatch away, so it
        // still holds the card when the cancelled write is attempted.
        id: 'transition-1', fromColumnId: target.columnId, columnId: 'done', mode: 'move',
        reason: 'Ready to finish.', status: 'failed',
      };
    });
    const seeded = JSON.stringify(f.store.requireTask(target.id).pendingTransition);
    expect(seeded, 'the seeded transition must persist').toContain('transition-1');
    // Hold the Hub queue so the journal write cannot land, then cancel the caller.
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const holder = f.app.store.transact(() => { entered(); return gate; });
    await holding;
    const controller = new AbortController();
    // The journal transaction is submitted eagerly and then waits on the queue, so the
    // spy proves the write is queued when the signal fires.
    const submitted = vi.spyOn(f.hubs, 'transact');
    const pending = f.app.requestDeletion({ hubId: f.hub.id, taskId: target.id, expectedWorktreePath: null, signal: controller.signal });
    await expect.poll(() => submitted.mock.calls.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    controller.abort();
    release();
    await holder;
    await expect(pending).rejects.toThrow();
    // The transition is cleared only in the same write that records the journal, so a
    // refused admission leaves the card exactly as it was.
    expect(JSON.stringify(f.store.requireTask(target.id).pendingTransition)).toBe(seeded);
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
  });



  it('records nothing when the caller is cancelled while another command holds the lane', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Cancelled in lane', description: '' });
    // The test owns the storage gate, so the deletion is provably queued behind an
    // unrelated command, and only the test releases it.
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const saveHub = f.storage.saveHub.bind(f.storage);
    let held = 0;
    f.storage.saveHub = async (value: any) => { if (held === 0) { held = 1; entered(); await gate; } return saveHub(value); };
    const holder = f.app.command({ type: 'note.save', taskId: target.id, content: 'Hold the lane' });
    await holding;
    const controller = new AbortController();
    // Cancellation must stop the request before the coordinator is asked at all, so the
    // coordinator call is the observable boundary of this window.
    const request = vi.spyOn(f.app.worktrees, 'request');
    const pending = f.app.requestDeletion({ hubId: f.hub.id, taskId: target.id, expectedWorktreePath: null, signal: controller.signal });
    try {
      // Let the request reach its wait on the command lane before cancelling.
      await new Promise(resolve => setTimeout(resolve, 10));
      controller.abort();
    } finally {
      release();
    }
    await holder;
    await expect(pending).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
    expect(f.sessions.archived).toEqual([]);
    expect(f.git.removed).toEqual([]);
  });


  it('clears the pending transition in the same write that re-arms an existing journal', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Reconfirmed', description: '' });
    const root = path.join(f.root, 'trees', 'reconfirmed');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/reconfirmed', sourceBranch: 'main' });
    f.git.trees.set(root, { path: root, branch: 'task/reconfirmed', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await f.app.command({ type: 'task.delete', taskId: target.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(target.id).operation!;
    expect(failed.phase).toBe('failed');
    // A pending transition may coexist with that failed journal; the reconfirmation
    // must clear it in the same write that re-arms the journal.
    await f.store.transact(draft => {
      draft.tasks.find(card => card.id === target.id)!.pendingTransition = {
        id: 'transition-1', fromColumnId: target.columnId, columnId: 'done', mode: 'move',
        reason: 'Ready to finish.', status: 'failed',
      };
    });
    // Reconfirming without the discard consent re-arms the journal and fails again in
    // the preflight, so the card stays on the board and its journal remains observable.
    await f.app.command({ type: 'task.delete', taskId: target.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const current = f.store.requireTask(target.id);
    expect(current.operation?.phase).toBe('failed');
    // The transition went with the same write that re-armed the journal; it never
    // survives beside a journal that replaced the one it belonged to.
    expect(current.pendingTransition).toBeUndefined();
  });


  it('does not interrupt a deletion once the write is handed to storage', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Delivered write', description: '' });
    // The storage write is the point of no return: an abort that lands after the handoff
    // cannot call it back, so the journal is recorded and the queue owns the outcome.
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const saveHub = f.storage.saveHub.bind(f.storage);
    let held = 0;
    f.storage.saveHub = async (value: any) => { if (held === 0 && value.tasks?.some((card: any) => card.operation?.request?.kind === 'delete')) { held = 1; entered(); await gate; } return saveHub(value); };
    const controller = new AbortController();
    const pending = f.app.requestDeletion({ hubId: f.hub.id, taskId: target.id, expectedWorktreePath: null, signal: controller.signal });
    await holding;
    controller.abort();
    release();
    const admission = await pending;
    expect(admission.phase).toBe('queued');
    await f.app.worktrees.settle();
    // The deletion finishes through its own surfaces instead of vanishing.
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
  });

  it('refuses at the coordinator lane when the failure lands after the tool checked', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Lane guard', description: '' });
    const root = path.join(f.root, 'trees', 'lane-guard');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/lane-guard', sourceBranch: 'main' });
    f.git.trees.set(root, { path: root, branch: 'task/lane-guard', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(target.id).operation!;
    expect(failed.phase).toBe('failed');
    // The second boundary: a request that reaches the per-task lane on a failed
    // journal is refused there too, so the guard does not depend on the caller.
    await expect(f.app.worktrees.request(target.id, { kind: 'delete', discardChanges: true, expectedWorktreePath: root, force: true }, { background: true, freshDestructive: true }))
      .rejects.toMatchObject({ code: 'DELETION_RECOVERY_REQUIRED' });
    expect(f.store.requireTask(target.id).operation?.phase).toBe('failed');
    expect(f.git.removed).toEqual([]);
  });


  it('refuses before the coordinator for a journal that already carries stronger consent', async () => {
    const f = await setup();
    const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Consent recorded', description: '' });
    const root = path.join(f.root, 'trees', 'consent-recorded');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/consent-recorded', sourceBranch: 'main' });
    // A real failure first, then the person grants force and discard in the interface.
    f.git.trees.set(root, { path: root, branch: 'task/consent-recorded', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await f.app.command({ type: 'task.delete', taskId: target.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(target.id).operation!;
    expect(failed.phase).toBe('failed');
    expect(failed.error?.code).toBe('DISCARD_REQUIRED');
    await f.store.transact(draft => {
      const journal = draft.tasks.find(card => card.id === target.id)!.operation!;
      if (journal.request.kind === 'delete') {
        journal.request.force = true;
        journal.request.discardChanges = true;
      }
    });
    const before = JSON.stringify(f.store.requireTask(target.id).operation);
    // The coordinator is where the journal would be reused, so it must never be asked.
    const request = vi.spyOn(f.app.worktrees, 'request');
    await expect(run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true }))
      .rejects.toMatchObject({ code: 'DELETION_RECOVERY_REQUIRED' });
    // The app refused on its own: the coordinator was never asked, and the journal that
    // holds the stronger consent is byte-for-byte unchanged.
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(f.store.requireTask(target.id).operation)).toBe(before);
    expect(f.git.removed).toEqual([]);
  });

  it('refuses to re-admit a failed deletion that may carry stronger consent', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Failed before', description: '' });
    const root = path.join(f.root, 'trees', 'failed-before');
    await f.app.command({ type: 'worktree.create', taskId: target.id, mode: 'new', path: root, branchName: 'task/failed-before', sourceBranch: 'main' });
    f.git.trees.set(root, { path: root, branch: 'task/failed-before', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(target.id).operation!;
    expect(failed.phase).toBe('failed');
    // The whole journal is the evidence: a re-admission would requeue it, and the
    // identity alone survives a retry, so everything recorded is compared.
    const before = JSON.stringify(f.store.requireTask(target.id).operation);
    await expect(run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true })).rejects.toMatchObject({ code: 'DELETION_RECOVERY_REQUIRED' });
    expect(JSON.stringify(f.store.requireTask(target.id).operation)).toBe(before);
    // Nothing was removed and the registered checkout is still there to recover.
    expect(f.git.removed).toEqual([]);
    expect(f.git.trees.has(root)).toBe(true);
  });
});
describe('a lease left by another host still blocks agent deletion', () => {
  it('refuses the tool with no runtime attached, no journal, and no checkout removal', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Lease without runtime', description: '' });
    // A lease survives the host that wrote it, and a replaced stage entry can leave the
    // task with no scripted control. Only the filesystem reader can see it here.
    const ownership = new NativeExecutionOwnership(path.join(f.root, 'kanban-private', 'scripted'));
    const scope = { hubId: f.hub.id, boardId: f.board.id, projectId: f.project.id, stageIdentity: 'unbound' };
    const lease = await ownership.acquire(scope, 'execution-from-previous-host', target.id);
    try {
      expect(f.store.requireTask(target.id).scripted).toBeUndefined();
      await expect(run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true }))
        .rejects.toMatchObject({ code: 'OWNERSHIP_EXISTS' });
      expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
      expect(f.sessions.archived).toEqual([]);
      expect(f.git.removed).toEqual([]);
    } finally {
      // The lease belongs to this test; it is never left for the fixture teardown.
      await lease().catch(() => undefined);
    }
  });

  it('still deletes an ordinary card when no execution provider is attached', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'No lease', description: '' });
    const value = await run(f, { task_id: target.id, hub_id: f.hub.id, confirmed: true });
    expect(value.operation.phase).toBe('queued');
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(card => card.id === target.id)).toBe(false);
  });
});

describe('the final cancellation hook', () => {
  it('refuses the write after the change returns and before storage receives it', async () => {
    const f = await setup();
    const target = await f.app.createTask({ projectId: f.project.id, title: 'Stopped at handoff', description: '' });
    await f.store.transact(draft => {
      draft.tasks.find(card => card.id === target.id)!.pendingTransition = {
        id: 'transition-1', fromColumnId: target.columnId, columnId: 'done', mode: 'move',
        reason: 'Ready to finish.', status: 'failed',
      };
    });
    const revision = f.store.snapshot().revision;
    const transition = JSON.stringify(f.store.requireTask(target.id).pendingTransition);
    const controller = new AbortController();
    // The abort lands exactly where the last hook runs: the change callback returned and
    // nothing has been handed to storage yet.
    const saved: any[] = [];
    const saveHub = f.storage.saveHub.bind(f.storage);
    f.storage.saveHub = async (value: any) => { saved.push(value); return saveHub(value); };
    const transact = f.hubs.transact.bind(f.hubs);
    f.hubs.transact = ((hubId: string, change: any, expectedRevision?: number, validate?: any, beforeCommit?: any) => transact(
      hubId,
      async (draft: any) => { const out = await change(draft); if (draft.tasks.some((card: any) => card.operation?.request?.kind === 'delete')) controller.abort(); return out; },
      expectedRevision, validate, beforeCommit,
    )) as typeof f.hubs.transact;
    const pending = f.app.requestDeletion({ hubId: f.hub.id, taskId: target.id, expectedWorktreePath: null, signal: controller.signal });
    await expect(pending).rejects.toThrow();
    // Storage never saw the journal draft, and the live Hub is exactly as it was.
    const wroteJournal = saved.some((value: any) => value.tasks?.some((card: any) => card.operation?.request?.kind === 'delete'));
    expect(wroteJournal).toBe(false);
    expect(f.store.snapshot().revision).toBe(revision);
    expect(f.store.requireTask(target.id).operation ?? null).toBeNull();
    expect(JSON.stringify(f.store.requireTask(target.id).pendingTransition)).toBe(transition);
  });
});
