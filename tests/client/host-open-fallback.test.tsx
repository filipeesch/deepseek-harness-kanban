// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HostOpenFallback, drawerConversationSession, installHostOpenFallback, openServiceOf,
} from '../../src/client/host-open-fallback.js';
import { createBoardPageState, taskPageState } from '../../src/client/page-state.js';
import { openPeek, selectConversation } from '../../src/client/drawer-view.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NO_SURFACE = 'sidebarRight: no session surface is mounted';
const ADDRESS = 'dsh-resource://file/session/s-1/src/a.ts';
const SESSION = 's-1';

/** A supported service whose target-less opens fail the way a collapsed panel fails. */
function collapsedService() {
  const openResource = vi.fn((_address?: string, _options?: unknown): void => { throw new Error(NO_SURFACE); });
  const openTab = vi.fn((_kind?: string, _options?: unknown): void => { throw new Error(NO_SURFACE); });
  const openResourceIn = vi.fn();
  const openTabIn = vi.fn();
  const service = {
    capabilities: { embeddedPanel: true },
    openResource,
    openTab,
    openResourceIn,
    openTabIn,
  };
  return { service, openResource, openTab, openResourceIn, openTabIn };
}

describe('openServiceOf', () => {
  it('narrows a service that reports the capability and both per-Session opens', () => {
    expect(openServiceOf(collapsedService().service)).toBeDefined();
  });

  it('rejects a value that is not a service', () => {
    expect(openServiceOf(undefined)).toBeUndefined();
    expect(openServiceOf('sidebarRight')).toBeUndefined();
    expect(openServiceOf({})).toBeUndefined();
  });

  it('rejects a host without the embedded-panel capability', () => {
    expect(openServiceOf({ ...collapsedService().service, capabilities: {} })).toBeUndefined();
    expect(openServiceOf({ ...collapsedService().service, capabilities: { embeddedPanel: 'yes' } })).toBeUndefined();
  });

  it('rejects a host without a per-Session open', () => {
    const { service } = collapsedService();
    const withoutResource = {
      capabilities: service.capabilities, openResource: service.openResource, openTab: service.openTab, openTabIn: service.openTabIn,
    };
    const withoutPage = {
      capabilities: service.capabilities, openResource: service.openResource, openTab: service.openTab, openResourceIn: service.openResourceIn,
    };
    expect(openServiceOf(withoutResource)).toBeUndefined();
    expect(openServiceOf(withoutPage)).toBeUndefined();
  });
});

describe('installHostOpenFallback', () => {
  it('leaves an open the host can settle untouched', () => {
    const { service, openResourceIn } = collapsedService();
    service.openResource = vi.fn();
    installHostOpenFallback({ service, drawerSession: () => SESSION });
    service.openResource(ADDRESS);
    expect(openResourceIn).not.toHaveBeenCalled();
  });

  it('re-issues a failed resource open for the drawer Session with the same arguments', () => {
    const { service, openResourceIn } = collapsedService();
    const installation = installHostOpenFallback({ service, drawerSession: () => SESSION });
    expect(installation.installed).toBe(true);
    const options = { params: { line: 7 } };
    expect(() => service.openResource(ADDRESS, options)).not.toThrow();
    expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, ADDRESS, options);
    installation.dispose();
  });

  it('re-issues a failed page open for the drawer Session with the same arguments', () => {
    const { service, openTabIn } = collapsedService();
    const installation = installHostOpenFallback({ service, drawerSession: () => SESSION });
    const options = { params: { url: 'https://example.test' } };
    expect(() => service.openTab('browser', options)).not.toThrow();
    expect(openTabIn).toHaveBeenCalledExactlyOnceWith(SESSION, 'browser', options);
    installation.dispose();
  });

  it('rethrows the original error when the drawer presents no conversation', () => {
    const { service, openResourceIn } = collapsedService();
    const installation = installHostOpenFallback({ service, drawerSession: () => undefined });
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    expect(openResourceIn).not.toHaveBeenCalled();
    installation.dispose();
  });

  it('rethrows the original error when the fallback fails, and reports the attempt', () => {
    const { service, openResourceIn } = collapsedService();
    openResourceIn.mockImplementation(() => { throw new Error('no tab type claims it'); });
    const report = vi.fn();
    const installation = installHostOpenFallback({ service, drawerSession: () => SESSION, report });
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    expect(report).toHaveBeenCalledOnce();
    installation.dispose();
  });

  it('rethrows the original error when the drawer Session cannot be read', () => {
    const { service } = collapsedService();
    const installation = installHostOpenFallback({ service, drawerSession: () => { throw new Error('broken provider'); } });
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    installation.dispose();
  });

  it('installs nothing when the capability is not reported', () => {
    const { service, openResource } = collapsedService();
    const installation = installHostOpenFallback({ service: { ...service, capabilities: {} }, drawerSession: () => SESSION });
    expect(installation.installed).toBe(false);
    expect(service.openResource).toBe(openResource);
  });

  it('installs nothing when a per-Session open is absent at install time', () => {
    const { service, openResource, openResourceIn, openTab, openTabIn } = collapsedService();
    const withoutResource = { capabilities: service.capabilities, openResource, openTab, openTabIn };
    const withoutPage = { capabilities: service.capabilities, openResource, openTab, openResourceIn };
    expect(installHostOpenFallback({ service: withoutResource, drawerSession: () => SESSION }).installed).toBe(false);
    expect(installHostOpenFallback({ service: withoutPage, drawerSession: () => SESSION }).installed).toBe(false);
    expect(withoutResource.openResource).toBe(openResource);
    expect(withoutPage.openResource).toBe(openResource);
  });

  it('installs nothing when the service refuses the write', () => {
    const frozen = Object.freeze(collapsedService().service);
    const installation = installHostOpenFallback({ service: frozen, drawerSession: () => SESSION });
    expect(installation.installed).toBe(false);
    expect(() => frozen.openResource(ADDRESS)).toThrow(NO_SURFACE);
  });

  it('shares one installation and restores the service on the last release', () => {
    const { service, openResource, openResourceIn } = collapsedService();
    const first = installHostOpenFallback({ service, drawerSession: () => SESSION });
    const second = installHostOpenFallback({ service, drawerSession: () => SESSION });
    expect(first.installed).toBe(true);
    expect(second.installed).toBe(true);
    first.dispose();
    // One holder is gone, the other still owns the wrappers.
    expect(() => service.openResource(ADDRESS)).not.toThrow();
    expect(openResourceIn).toHaveBeenCalledOnce();
    second.dispose();
    expect(service.openResource).toBe(openResource);
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    expect(openResourceIn).toHaveBeenCalledOnce();
  });

  it('does not release another holder twice, and the last release restores', () => {
    const { service, openResource, openResourceIn } = collapsedService();
    const first = installHostOpenFallback({ service, drawerSession: () => SESSION });
    const second = installHostOpenFallback({ service, drawerSession: () => SESSION });
    first.dispose();
    first.dispose();
    expect(service.openResource).not.toBe(openResource);
    second.dispose();
    expect(service.openResource).toBe(openResource);
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    expect(openResourceIn).not.toHaveBeenCalled();
  });

  it('keeps the most recently installed holder authoritative until the last release', () => {
    const { service, openResource, openResourceIn } = collapsedService();
    const first = installHostOpenFallback({ service, drawerSession: () => 's-first' });
    const second = installHostOpenFallback({ service, drawerSession: () => 's-second' });
    expect(() => service.openResource(ADDRESS)).not.toThrow();
    expect(openResourceIn).toHaveBeenLastCalledWith('s-second', ADDRESS);
    // A holder that leaves does not resurrect an older seat's Session: the newest
    // mounted seat stays authoritative while any holder keeps the wrappers.
    second.dispose();
    expect(() => service.openResource(ADDRESS)).not.toThrow();
    expect(openResourceIn).toHaveBeenLastCalledWith('s-second', ADDRESS);
    first.dispose();
    expect(service.openResource).toBe(openResource);
  });
});

describe('installHostOpenFallback on a class instance', () => {
  /** The host's service is a class instance: the opens live on its prototype. */
  class HostService {
    readonly capabilities = { embeddedPanel: true };
    readonly resourceIn: unknown[][] = [];
    openResource(_address: string): void { throw new Error(NO_SURFACE); }
    openTab(_kind: string): void { throw new Error(NO_SURFACE); }
    openResourceIn(...args: unknown[]): void { this.resourceIn.push(args); }
    openTabIn(..._args: unknown[]): void {}
  }

  it('wraps the prototype method and deletes the own wrapper on release', () => {
    const service = new HostService();
    const installation = installHostOpenFallback({ service, drawerSession: () => SESSION });
    expect(installation.installed).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(service, 'openResource')).toBe(true);
    expect(() => service.openResource(ADDRESS)).not.toThrow();
    expect(service.resourceIn).toEqual([[SESSION, ADDRESS]]);
    installation.dispose();
    expect(Object.prototype.hasOwnProperty.call(service, 'openResource')).toBe(false);
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
    expect(service.resourceIn).toHaveLength(1);
  });
});

describe('HostOpenFallback', () => {
  it('installs while the seat is mounted and restores it on unmount', () => {
    const { service, openResource, openResourceIn } = collapsedService();
    const view = render(<HostOpenFallback service={service} drawerSession={() => SESSION} />);
    act(() => { expect(() => service.openResource(ADDRESS)).not.toThrow(); });
    expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, ADDRESS);
    view.unmount();
    expect(service.openResource).toBe(openResource);
    expect(() => service.openResource(ADDRESS)).toThrow(NO_SURFACE);
  });

  it('renders nothing and leaves an unsupported host alone', () => {
    const { service, openResource } = collapsedService();
    const view = render(<HostOpenFallback service={{ ...service, capabilities: {} }} drawerSession={() => SESSION} />);
    expect(view.container.innerHTML).toBe('');
    expect(service.openResource).toBe(openResource);
    view.unmount();
  });
});

describe('drawerConversationSession', () => {
  it('names no Session while no drawer is open', () => {
    const pageState = createBoardPageState();
    expect(drawerConversationSession(pageState)).toBeUndefined();
  });

  it('names the presented conversation', () => {
    const pageState = createBoardPageState();
    pageState.selectedTaskId = 't1';
    taskPageState(pageState, 't1').view = selectConversation(taskPageState(pageState, 't1').view, SESSION);
    expect(drawerConversationSession(pageState)).toBe(SESSION);
  });

  it('keeps the conversation an open task presents while a peek is shown', () => {
    const pageState = createBoardPageState();
    pageState.selectedTaskId = 't1';
    const page = taskPageState(pageState, 't1');
    page.view = openPeek(selectConversation(page.view, SESSION), {
      parentSessionId: SESSION, sessionId: 's-child', mode: 'continuable',
    });
    expect(drawerConversationSession(pageState)).toBe(SESSION);
  });

  it('creates no page state for a task the drawer never presented', () => {
    const pageState = createBoardPageState();
    pageState.selectedTaskId = 't-unopened';
    expect(drawerConversationSession(pageState)).toBeUndefined();
    expect(Object.keys(pageState.drawers)).toEqual([]);
  });
});
