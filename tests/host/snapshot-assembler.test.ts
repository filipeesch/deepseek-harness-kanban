import { describe, expect, it, vi } from 'vitest';
import { SnapshotAssembler, type SnapshotAssemblerOptions } from '../../src/host/snapshot-assembler.js';
import type { ConversationFacts, HubState, KanbanState, SharingAuthView } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';

const now = '2026-11-08T00:00:00Z';
function state(mutate?: (hub: HubState) => void): KanbanState {
  const hub: HubState = {
    id: 'hub', name: 'Hub', revision: 1,
    projects: [{ id: 'p', projectKey: 'p', name: 'Project', projectPath: '/project', gitRootPath: '/project' }],
    boards: [{ id: 'b', name: 'Board', workflowYaml: 'name: Flow', workflow: { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: now, updatedAt: now }],
    tasks: [
      { id: 't1', boardId: 'b', projectId: 'p', title: 'One', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: now, updatedAt: now },
      { id: 't2', boardId: 'b', projectId: 'p', title: 'Two', description: '', columnId: 'backlog', position: 1, sessionIds: [], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: now, updatedAt: now },
    ],
    notes: [], createdAt: now, updatedAt: now,
  };
  mutate?.(hub);
  return { hubs: [hub], settings: { revision: 0 } };
}
const conversations: Record<string, ConversationFacts> = {};
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function authFixture() {
  let view: SharingAuthView = { status: 'not-connected' };
  const refresh = vi.fn(async () => {});
  const coordinator = { refresh, view: () => view } as unknown as NonNullable<SnapshotAssemblerOptions['sharingAuth']>;
  return { coordinator, refresh, setView: (next: SharingAuthView) => { view = next; } };
}

describe('snapshot assembler', () => {
  it('reuses the state object until the repository changes and bumps the revision once per change', async () => {
    let current = state();
    const hubs = { snapshot: vi.fn(() => current) };
    const assembler = new SnapshotAssembler({ hubs });
    const first = await assembler.assemble(conversations);
    const second = await assembler.assemble(conversations);
    expect(second.state).toBe(first.state);
    expect(second.stateRevision).toBe(first.stateRevision);
    current = state(hub => { hub.revision = 2; });
    assembler.invalidateState();
    const third = await assembler.assemble(conversations);
    expect(third.state).not.toBe(first.state);
    expect(third.stateRevision).toBe(first.stateRevision + 1);
  });

  it('keeps team-sharing views for a change that cannot alter the sharing projection', async () => {
    let current = state();
    const sharing = vi.fn(() => ({ hub: { boards: [], incoming: [], removed: [], blockers: [], removing: [] } as never }));
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => current }, sharing });
    const first = await assembler.assemble(conversations);
    expect(sharing).toHaveBeenCalledOnce();
    // An auto-mode flag is not part of the sharing projection.
    current = state(hub => { hub.tasks[0]!.autoMode = { enabled: true }; });
    assembler.invalidateState();
    const second = await assembler.assemble(conversations);
    expect(second.sharing).toBe(first.sharing);
    expect(sharing).toHaveBeenCalledOnce();
    // A stage change is part of the projection.
    current = state(hub => { hub.tasks[0]!.columnId = 'other'; });
    assembler.invalidateState();
    const third = await assembler.assemble(conversations);
    expect(third.sharing).not.toBe(first.sharing);
    expect(sharing).toHaveBeenCalledTimes(2);
  });

  it('reuses cached views until the sharing state changes', async () => {
    const sharing = vi.fn(() => ({ hub: {} as never }));
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() }, sharing });
    const first = await assembler.assemble(conversations);
    assembler.invalidateSharing();
    const second = await assembler.assemble(conversations);
    expect(second.sharing).not.toBe(first.sharing);
    expect(sharing).toHaveBeenCalledTimes(2);
  });

  it('never makes a snapshot wait for a stale authorization view', async () => {
    const auth = authFixture();
    let clock = 0;
    const onChange = vi.fn();
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() }, sharingAuth: auth.coordinator, authTtlMs: 1_000, now: () => clock, onChange });
    auth.setView({ status: 'connected', email: 'owner@example.com' });
    const first = await assembler.assemble(conversations);
    expect(first.sharingAuth).toEqual({ status: 'connected', email: 'owner@example.com' });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    clock = 500;
    await assembler.assemble(conversations);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    clock = 2_000;
    auth.setView({ status: 'connected', email: 'new@example.com' });
    const stale = await assembler.assemble(conversations);
    expect(stale.sharingAuth).toEqual({ status: 'connected', email: 'owner@example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(auth.refresh).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledOnce();
    await assembler.assemble(conversations, { refreshAuth: true });
    expect(auth.refresh).toHaveBeenCalledTimes(3);
  });
});

describe('state and revision consistency', () => {
  it('captures the state after an awaited authorization refresh', async () => {
    const gate = deferred<void>();
    let view: SharingAuthView = { status: 'not-connected' };
    const auth = { refresh: vi.fn(() => gate.promise), view: () => view } as unknown as NonNullable<SnapshotAssemblerOptions['sharingAuth']>;
    let current = state();
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => current }, sharingAuth: auth });
    const pending = assembler.assemble(conversations);
    current = state(hub => { hub.revision = 2; hub.name = 'Renamed'; });
    assembler.invalidateState();
    gate.resolve();
    view = { status: 'connected' };
    const parts = await pending;
    expect(parts.state.hubs[0]!.name).toBe('Renamed');
    expect(parts.stateRevision).toBe(1);
    expect(parts.sharingAuth).toEqual({ status: 'connected' });
  });
});

describe('authorization generation', () => {
  it('serializes physical refreshes so a superseded read cannot overwrite a newer status', async () => {
    const gate = deferred<void>();
    let view: SharingAuthView = { status: 'connected', email: 'old@example.com' };
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      if (calls === 1) { await gate.promise; view = { status: 'connected', email: 'old@example.com' }; }
      else view = { status: 'connected', email: 'new@example.com' };
    });
    const coordinator = { refresh, view: () => view } as unknown as NonNullable<SnapshotAssemblerOptions['sharingAuth']>;
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() }, sharingAuth: coordinator });
    const first = assembler.assemble(conversations);
    await Promise.resolve();
    assembler.invalidateAuth();
    const second = assembler.assemble(conversations, { refreshAuth: true });
    await Promise.resolve();
    // The newer generation must wait for the old physical read instead of racing it.
    expect(refresh).toHaveBeenCalledTimes(1);
    gate.resolve();
    const [firstParts, secondParts] = await Promise.all([first, second]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(secondParts.sharingAuth).toEqual({ status: 'connected', email: 'new@example.com' });
    expect(view).toEqual({ status: 'connected', email: 'new@example.com' });
    // The superseded caller may observe the newer applied view, never the stale one.
    expect(firstParts.sharingAuth).not.toEqual({ status: 'connected', email: 'old@example.com' });
  });
});

describe('cache-only assembly for command responses', () => {
  it('never reads authorization and reports the cached view', async () => {
    const auth = authFixture();
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() }, sharingAuth: auth.coordinator });
    await assembler.assemble(conversations);
    auth.refresh.mockClear();
    const cached = await assembler.assemble(conversations, { allowAuthRefresh: false });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(cached.sharingAuth).toEqual({ status: 'not-connected' });
  });

  it('omits authorization instead of reading it when the cache is empty', async () => {
    const auth = authFixture();
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() }, sharingAuth: auth.coordinator });
    const parts = await assembler.assemble(conversations, { allowAuthRefresh: false });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(parts.sharingAuth).toBeUndefined();
  });
});

describe('conversation-fact snapshot payload', () => {
  it('includes only the conversations it was given', async () => {
    const assembler = new SnapshotAssembler({ hubs: { snapshot: () => state() } });
    const facts: ConversationFacts = { running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null };
    const parts = await assembler.assemble({ s1: facts });
    expect(parts.conversations).toEqual({ s1: facts });
  });
});
