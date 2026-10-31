import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { isValidElement, type ReactNode, type ReactElement } from 'react';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { HostSnapshot, ClientApi } from '../../src/shared/types.js';
import { TYPERT_REMOTE } from '../../src/remote.js';
import * as KanbanClient from '../../src/client.js';
const fibers: Fiber[] = [];
afterEach(async () => { for (const fiber of fibers.splice(0).reverse()) await fiber.dispose(); });
const board: HostSnapshot = { sequence: 0, conversations: {}, state: { hubs: [{ id: 'hub', name: 'Hub', revision: 0, projects: [], boards: [{ id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Default', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }], tasks: [], notes: [], createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }], settings: { revision: 0 } } };
async function runtime() {
  const root = new Context();
  const call = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: board } });
  const connection = {
    interactions: 'answer', isLoopback: true,
    generation: { getSnapshot: () => ({ id: 1, host: { home: '/home' } }), subscribe: () => () => {} },
    rpc: {
      call,
      open: (_channel: string, _endpoint: string, _payload: unknown, signal: AbortSignal) => ({
        async *[Symbol.asyncIterator]() { if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); },
      }),
    },
    registerGenerationSource: (_source: Parameters<ConnectionHandle['registerGenerationSource']>[0]) => () => {},
    start: () => ({ stop() {} }),
  } as unknown as ConnectionHandle;
  root.provide('connection', connection);
  const registry = root.plugin(TypertRegistry); fibers.push(registry); await registry;
  const gateway = root.plugin(Gateway); fibers.push(gateway); await gateway;
  return { root, call };
}

describe('real Cordis + real gateway namespace injection', () => {
  it('mounting a namespace does not grant its owner read permission; post-mount injection does', async () => {
    const { root, call } = await runtime();
    const owner = root.plugin({
      name: 'regression-remote-owner', inject: ['remote'],
      async apply(ctx) {
        const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
        expect(() => ctx.remote.kanban).toThrow('cannot get property "remote.kanban" without inject');
        const consumer = ctx.inject(['remote.kanban'], async scoped => {
          const result = await scoped.remote.kanban.snapshot();
          expect(result).toEqual({ ok: true, value: { ok: true, value: board } });
        });
        await consumer;
        return async () => { await consumer.dispose(); await unmount(); };
      },
    });
    fibers.push(owner); await owner;
    expect(call).toHaveBeenCalledWith('/api', 'kanban/snapshot', { args: {} }, expect.any(AbortSignal));
  });
  it('withdraws and restarts the injected consumer when the actual gateway namespace is replaced', async () => {
    const { root } = await runtime();
    let ownerContext!: Context; let withdraw!: () => Promise<void>;
    const started = vi.fn(); const stopped = vi.fn();
    const owner = root.plugin({
      name: 'regression-namespace-lifecycle', inject: ['remote'],
      async apply(ctx) {
        ownerContext = ctx; withdraw = await ctx.remote.$mount(TYPERT_REMOTE);
        const consumer = ctx.inject(['remote.kanban'], scoped => {
          expect(scoped.remote.kanban.snapshot).toBeTypeOf('function'); started();
          return () => stopped();
        });
        await consumer;
        return async () => { await consumer.dispose(); await withdraw(); };
      },
    });
    fibers.push(owner); await owner; expect(started).toHaveBeenCalledTimes(1);
    await withdraw(); await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    expect(() => ownerContext.remote.kanban).toThrow();
    withdraw = await ownerContext.remote.$mount(TYPERT_REMOTE);
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2));
    await owner.dispose(); expect(stopped).toHaveBeenCalledTimes(2);
  });
  it('loads the actual Kanban apply function in a permission-checked consumer fiber', async () => {
    const { root, call } = await runtime();
    const components = new Map<string, unknown>();
    const registrations = vi.fn((options: { name: string; key?: string; id?: string }, component: unknown) => {
      const key = options.name + ':' + (options.key ?? options.id ?? ''); components.set(key, component);
      return () => components.delete(key);
    });
    root.provide('slots', { inject(_name: string, install: () => unknown) { install(); }, register: registrations, entriesOfSlot: () => [], subscribe: () => () => {} });
    root.provide('sessions', {});
    root.provide('uiSession', { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } });
    root.provide('conversation', {});
    root.provide('layout', {});
    root.provide('locale', { bind: () => (key: string) => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} });
    root.provide('uiConversation', { events: { register: vi.fn(() => () => {}) } });
    const client = root.plugin(KanbanClient); fibers.push(client); await client;
    expect(registrations).toHaveBeenCalledTimes(7);
    expect(components.has('main:kanban')).toBe(true);
    expect(components.has('kanban.session.header:')).toBe(true);
    expect(components.has('conversation.chat.node:kanban-task-context')).toBe(true);
    // Invoke the page's own bridge API, not a separately authorized stand-in consumer.
    const Main = components.get('main:kanban') as (props: { usePanelInfo: (selector: (value: { activePanelId: string }) => boolean) => boolean }) => ReactNode;
    const page = Main({ usePanelInfo: selector => selector({ activePanelId: 'kanban' }) });
    if (!isValidElement<{ children: ReactNode }>(page)) throw new Error('Expected Kanban page element');
    const boardPage = React.Children.toArray(page.props.children).find(child => isValidElement<{ api?: ClientApi }>(child) && child.props.api) as ReactElement<{ api: ClientApi }> | undefined;
    expect(boardPage).toBeDefined(); await expect(boardPage!.props.api.snapshot()).resolves.toMatchObject({ sequence: 0, attention: {}, conversationAttention: {}, clientEpoch: 0 });
    expect(call).toHaveBeenCalledWith('/api', 'kanban/snapshot', { args: {} }, expect.any(AbortSignal));
    await client.dispose();
  });

  it('exposes the question dismissal endpoint through the mounted namespace', async () => {
    const { root, call } = await runtime();
    call.mockResolvedValueOnce({ ok: true, value: { ok: true, value: [] } });
    const owner = root.plugin({
      name: 'regression-dismiss-owner', inject: ['remote'],
      async apply(ctx) {
        const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
        const consumer = ctx.inject(['remote.kanban'], async scoped => {
          await expect(scoped.remote.kanban.dismissQuestions({ sessionId: 's', roundId: 'r' })).resolves.toEqual({ ok: true, value: { ok: true, value: [] } });
        });
        await consumer;
        return async () => { await consumer.dispose(); await unmount(); };
      },
    });
    fibers.push(owner); await owner;
    expect(call).toHaveBeenCalledWith('/api', 'kanban/dismissQuestions', { args: { request: { sessionId: 's', roundId: 'r' } } }, expect.any(AbortSignal));
  });
});
