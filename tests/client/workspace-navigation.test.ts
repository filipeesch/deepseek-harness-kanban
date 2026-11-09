// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceNavigation } from '../../src/client/settings/schedules/workspace-navigation.js';

const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('createWorkspaceNavigation', () => {
  it('unarchives before opening the conversation', async () => {
    const order: string[] = [];
    const open = createWorkspaceNavigation({
      openSession: () => { order.push('open'); },
      unarchiveSession: async () => { order.push('unarchive'); },
    });
    open!('session-1');
    await tick();
    expect(order).toEqual(['unarchive', 'open']);
  });

  it('still opens when unarchiving fails', async () => {
    const order: string[] = [];
    const open = createWorkspaceNavigation({
      openSession: () => { order.push('open'); },
      unarchiveSession: async () => { throw new Error('already visible'); },
    });
    open!('session-1');
    await tick();
    expect(order).toEqual(['open']);
  });

  it('offers no navigation on a host without the workspace surface', () => {
    expect(createWorkspaceNavigation(undefined)).toBeUndefined();
    expect(createWorkspaceNavigation({ openSession: undefined as never })).toBeUndefined();
    expect(createWorkspaceNavigation({ openSession: vi.fn() })).toBeTypeOf('function');
  });
});
