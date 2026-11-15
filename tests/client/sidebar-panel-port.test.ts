import { describe, expect, it, vi } from 'vitest';
import { createSidebarPanelPort, type HostObservable } from '../../src/client/sidebar-panel-port.js';

function observable<T>(initial: T): HostObservable<T> & { set(value: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (next) => { value = next; for (const listener of [...listeners]) listener(); },
  };
}

function hostSession(sessionId: string, expanded = false, setExpanded = vi.fn()) {
  return { sessionId, expanded: observable(expanded), setExpanded };
}

describe('createSidebarPanelPort', () => {
  it('reads the capability and exposes one Session face', () => {
    const face = hostSession('s1', true);
    const service = { capabilities: { embeddedPanel: true }, forSession: vi.fn(() => face) };
    const port = createSidebarPanelPort(service);
    expect(port).toBeDefined();
    const held = port!.forSession('s1');
    expect(held).toBeDefined();
    expect(held!.sessionId).toBe('s1');
    expect(held!.expanded.getSnapshot()).toBe(true);
    expect(service.forSession).toHaveBeenCalledWith('s1');
  });

  it('answers collapsed before any occurrence mounts', () => {
    const setExpanded = vi.fn();
    const service = { capabilities: { embeddedPanel: true }, forSession: () => hostSession('s1', false, setExpanded) };
    const face = createSidebarPanelPort(service)!.forSession('s1');
    expect(face!.expanded.getSnapshot()).toBe(false);
    face!.setExpanded(true);
    expect(setExpanded).toHaveBeenCalledWith(true);
  });

  it('keeps one stable face and one observable per Session', () => {
    const service = { capabilities: { embeddedPanel: true }, forSession: vi.fn((id: string) => hostSession(id)) };
    const port = createSidebarPanelPort(service)!;
    const first = port.forSession('s1');
    const second = port.forSession('s1');
    expect(first).toBe(second);
    expect(service.forSession).toHaveBeenCalledTimes(1);
  });

  it('follows the host observable', () => {
    const face = hostSession('s1', false);
    const port = createSidebarPanelPort({ capabilities: { embeddedPanel: true }, forSession: () => face })!;
    const listener = vi.fn();
    port.forSession('s1')!.expanded.subscribe(listener);
    face.expanded.set(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(port.forSession('s1')!.expanded.getSnapshot()).toBe(true);
  });

  it('is absent on an older host without the capability', () => {
    expect(createSidebarPanelPort({ capabilities: {}, forSession: () => hostSession('s1') })).toBeUndefined();
    expect(createSidebarPanelPort({ forSession: () => hostSession('s1') })).toBeUndefined();
    expect(createSidebarPanelPort({ capabilities: { embeddedPanel: false }, forSession: () => hostSession('s1') })).toBeUndefined();
  });

  it('is absent for malformed or missing services', () => {
    expect(createSidebarPanelPort(undefined)).toBeUndefined();
    expect(createSidebarPanelPort(null)).toBeUndefined();
    expect(createSidebarPanelPort('sidebarRight')).toBeUndefined();
    expect(createSidebarPanelPort({ capabilities: { embeddedPanel: true } })).toBeUndefined();
  });

  it('answers no face for a Session the host cannot describe', () => {
    const malformed = createSidebarPanelPort({ capabilities: { embeddedPanel: true }, forSession: () => ({ sessionId: 's1' }) })!;
    expect(malformed.forSession('s1')).toBeUndefined();
    const throwing = createSidebarPanelPort({ capabilities: { embeddedPanel: true }, forSession: () => { throw new Error('not mounted'); } })!;
    expect(throwing.forSession('s1')).toBeUndefined();
    const unobservable = createSidebarPanelPort({ capabilities: { embeddedPanel: true }, forSession: () => ({ expanded: true, setExpanded: () => {} }) })!;
    expect(unobservable.forSession('s1')).toBeUndefined();
  });
});
