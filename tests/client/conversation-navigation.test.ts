import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../src/shared/types.js';
import { createConversationNavigation, isOwnedSubagent, type ConversationLineagePort, type ConversationSessionList } from '../../src/client/conversation-navigation.js';

const task = { id: 'task', sessionIds: ['root', 'other-root'] } as Task;
const child = { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' as const };
const grandchild = { parentSessionId: 'child', childSessionId: 'grandchild', mode: 'one-shot' as const };
const sessions: ConversationSessionList = {
  byId: {
    root: {},
    'other-root': {},
    child: { origin: 'subagent', parentId: 'root' },
    grandchild: { origin: 'subagent', parentId: 'child' },
    fork: { parentId: 'root' },
  },
};

function lineage(owned = true): ConversationLineagePort {
  return {
    subagentAddress: sessionId => sessionId === 'child' ? child : sessionId === 'grandchild' ? grandchild : undefined,
    isOwnedDescendant: (_roots, sessionId) => owned && (sessionId === 'child' || sessionId === 'grandchild'),
  };
}

describe('conversation navigation', () => {
  it('follows only native subagent edges to a task root', () => {
    expect(isOwnedSubagent(sessions, task.sessionIds, 'child')).toBe(true);
    expect(isOwnedSubagent(sessions, task.sessionIds, 'grandchild')).toBe(true);
    expect(isOwnedSubagent(sessions, task.sessionIds, 'fork')).toBe(false);
    expect(isOwnedSubagent(sessions, task.sessionIds, 'missing')).toBe(false);
    expect(isOwnedSubagent({ byId: { a: { origin: 'subagent', parentId: 'b' }, b: { origin: 'subagent', parentId: 'a' } } }, task.sessionIds, 'a')).toBe(false);
  });

  it('selects task roots and peeks owned subagent ancestors in the drawer', () => {
    const selectRoot = vi.fn(); const setPeek = vi.fn();
    const navigation = createConversationNavigation({ task, selectRoot, setPeek, lineage: lineage() });
    expect(navigation.openSession('root')).toBe(true);
    expect(selectRoot).toHaveBeenCalledWith('root');
    expect(navigation.openSession('child')).toBe(true);
    expect(setPeek).toHaveBeenCalledWith(child);
    expect(navigation.openSession('foreign')).toBe(false);
    expect(navigation.openSubagent(grandchild)).toBe(true);
    expect(setPeek).toHaveBeenLastCalledWith(grandchild);
  });

  it('fails closed without a lineage or for a foreign target', () => {
    const selectRoot = vi.fn(); const setPeek = vi.fn();
    const noLineage = createConversationNavigation({ task, selectRoot, setPeek });
    expect(noLineage.openSession('child')).toBe(false);
    expect(noLineage.openSubagent(child)).toBe(false);
    const foreign = createConversationNavigation({ task, selectRoot, setPeek, lineage: lineage(false) });
    expect(foreign.openSession('child')).toBe(false);
    expect(foreign.openSubagent(child)).toBe(false);
    expect(selectRoot).not.toHaveBeenCalled();
  });
});
