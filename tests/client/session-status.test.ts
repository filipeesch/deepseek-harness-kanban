import { describe, expect, it, vi } from 'vitest';
import {
  createSessionStatusPort,
  type NativeSessionStatusSnapshot,
  type NativeSessionStatusSource,
  type SessionStatusHost,
} from '../../src/client/session-status.js';

/** One host status table with the publisher the tests drive. */
function table(initial: Array<[string, { running: boolean | undefined; pendingInteraction: unknown }]>) {
  let value: NativeSessionStatusSnapshot = new Map(initial);
  const listeners = new Set<() => void>();
  const source: NativeSessionStatusSource = {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    source,
    listeners,
    publish(next: Array<[string, { running: boolean | undefined; pendingInteraction: unknown }]>) {
      value = new Map(next);
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('native Session status port', () => {
  it('reads the status service a current host publishes under uiSession', () => {
    const host = table([['s1', { running: true, pendingInteraction: undefined }]]);
    const port = createSessionStatusPort({ get: name => name === 'uiSession.sessionStatus' ? host.source : undefined });
    expect(port.status.getSnapshot().get('s1')).toMatchObject({ running: true });
    const seen = vi.fn();
    port.status.subscribe(seen);
    host.publish([['s1', { running: false, pendingInteraction: undefined }]]);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(port.status.getSnapshot().get('s1')).toMatchObject({ running: false });
    port.dispose();
    expect(host.listeners.size).toBe(0);
  });

  it('reads the table an older release keeps as a member of uiSession', () => {
    const host = table([['s1', { running: false, pendingInteraction: undefined }]]);
    const port = createSessionStatusPort({ get: () => undefined, uiSession: { sessionStatus: host.source } });
    expect(port.status.getSnapshot().get('s1')).toMatchObject({ running: false });
    const seen = vi.fn();
    port.status.subscribe(seen);
    host.publish([['s2', { running: true, pendingInteraction: undefined }]]);
    expect(seen).toHaveBeenCalledTimes(1);
    port.dispose();
  });

  it('stays empty instead of failing when the newer host refuses the member read', () => {
    const ctx = {
      get: () => undefined,
      uiSession: { get sessionStatus(): unknown { throw new Error('cannot get property "uiSession.sessionStatus" without inject'); } },
    } as unknown as SessionStatusHost;
    const port = createSessionStatusPort(ctx);
    expect(port.status.getSnapshot().size).toBe(0);
    port.dispose();
  });

  it('binds the sub-service once the activation gate sees it', () => {
    const host = table([['s1', { running: true, pendingInteraction: { kind: 'permission' } }]]);
    let initialize: ((scoped: SessionStatusHost) => unknown) | undefined;
    const dispose = vi.fn();
    const port = createSessionStatusPort({
      get: () => undefined,
      inject: (_dependencies, start) => { initialize = start; return { dispose }; },
    });
    expect(port.status.getSnapshot().size).toBe(0);
    const seen = vi.fn();
    port.status.subscribe(seen);
    const stop = initialize!({ get: () => host.source }) as () => void;
    expect(port.status.getSnapshot().get('s1')).toMatchObject({ running: true });
    expect(seen).toHaveBeenCalledTimes(1);
    port.dispose();
    expect(stop).toBeTypeOf('function');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.listeners.size).toBe(0);
  });
});
