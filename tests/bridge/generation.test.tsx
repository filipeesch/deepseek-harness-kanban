// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { RemoteStream, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { BoardSnapshot, Outcome } from '../../src/shared/types.js';
import { ClientBridge, type BridgeRemote } from '../../src/client-bridge.js';
import { BoardView } from '../../src/client/board.js';

class Feed implements RemoteStreamHandle<BoardSnapshot, never>, AsyncIterator<BoardSnapshot> {
  private values: BoardSnapshot[] = []; private done = false;
  private pending: ((value: IteratorResult<BoardSnapshot>) => void) | undefined;
  push(value: BoardSnapshot) { if (this.pending) { this.pending({ done: false, value }); this.pending = undefined; } else this.values.push(value); }
  send(_value: never): void { throw new Error('No uplink'); }
  end(): void { this.dispose(); }
  dispose(): void { this.done = true; this.pending?.({ done: true, value: undefined }); this.pending = undefined; }
  next(): Promise<IteratorResult<BoardSnapshot>> {
    if (this.values.length) return Promise.resolve({ done: false, value: this.values.shift()! });
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise(resolve => { this.pending = resolve; });
  }
  return(): Promise<IteratorResult<BoardSnapshot>> { this.dispose(); return Promise.resolve({ done: true, value: undefined }); }
  [Symbol.asyncIterator](): AsyncIterator<BoardSnapshot> { return this; }
}
function snapshot(sequence: number, title: string): BoardSnapshot {
  return { sequence, attention: {}, questionRounds: [], state: { schemaVersion: 2, revision: 0, workflowYaml: '', workflow: { name: 'Workflow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, projects: [], notes: [], tasks: [{ id: 'task', title, description: '', projectId: 'p', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: '', updatedAt: '' }] } };
}
const success = (value: BoardSnapshot): RemoteResult<Outcome<BoardSnapshot>> => ({ ok: true, value: { ok: true, value } });
const bridges: ClientBridge[] = [];
afterEach(async () => { cleanup(); for (const bridge of bridges.splice(0)) await bridge.dispose(); });
function fixture() {
  const feeds: Feed[] = [];
  const remote: BridgeRemote = {
    kanban: {
      snapshot: vi.fn().mockResolvedValue(success(snapshot(7, 'Before restart'))),
      command: vi.fn().mockResolvedValue(success(snapshot(7, 'Before restart'))),
      branches: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
      worktreeDefault: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { branchName: 'task', path: '' } } }),
      inferProject: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { projectPath: '/repo', gitRootPath: '/repo' } } }),
      questions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
      dismissQuestions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
      follow: (signal?: AbortSignal) => { const feed = new Feed(); feeds.push(feed); signal?.addEventListener('abort', () => feed.dispose(), { once: true }); return feed; },
    },
    $stream<Item>(options: RemoteStreamOptions<Item>) { return new RemoteStream({ generation: { getSnapshot: () => ({ id: 1, host: { home: '/home' } }), subscribe: () => () => {} } }, options); },
  };
  const bridge = new ClientBridge(remote, { getSnapshot: () => new Map(), subscribe: () => () => {} }); bridges.push(bridge);
  return { bridge, remote, feeds };
}
describe('combined native bridge + actual BoardView generation ordering', () => {
  it.each(['snapshot', 'command'] as const)('renders a reset baseline and rejects an old in-flight %s with a higher old sequence', async method => {
    const f = fixture(); const accepted: BoardSnapshot[] = [];
    f.bridge.api.subscribe(value => accepted.push(value));
    render(<BoardView api={f.bridge.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Before restart' });
    f.bridge.start(); await waitFor(() => expect(f.feeds).toHaveLength(1));
    await act(async () => f.feeds[0]!.push(snapshot(7, 'Before restart')));
    await waitFor(() => expect(accepted.at(-1)?.clientEpoch).toBe(1));
    let resolveOld!: (value: RemoteResult<Outcome<BoardSnapshot>>) => void;
    const oldResponse = new Promise<RemoteResult<Outcome<BoardSnapshot>>>(resolve => { resolveOld = resolve; });
    vi.mocked(f.remote.kanban[method]).mockReturnValueOnce(oldResponse);
    const inFlight = method === 'snapshot' ? f.bridge.api.snapshot() : f.bridge.api.command({ type: 'task.edit', taskId: 'task', title: 'Changed' });
    f.bridge.retry(); await waitFor(() => expect(f.feeds).toHaveLength(2));
    await act(async () => f.feeds[1]!.push(snapshot(0, 'After restart')));
    await screen.findByRole('button', { name: 'Open task After restart' });
    expect(screen.queryByRole('button', { name: 'Open task Before restart' })).toBeNull();
    expect(accepted.at(-1)).toMatchObject({ sequence: 0, clientEpoch: 2 });
    await act(async () => { resolveOld(success(snapshot(9, 'Late obsolete response'))); await inFlight; });
    expect(screen.getByRole('button', { name: 'Open task After restart' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open task Late obsolete response' })).toBeNull();
    await expect(inFlight).resolves.toMatchObject({ sequence: 0, clientEpoch: 2 });
    expect(accepted.at(-1)?.state.tasks[0]?.title).toBe('After restart');
  });
});
