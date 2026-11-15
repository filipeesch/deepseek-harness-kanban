import { describe, expect, it } from 'vitest';
import {
  classifyNavigation, isOwnedDescendant, mainViewSession, openConversationIds, subagentTarget, taskConversationScope,
  type DrawerSessionList,
} from '../../src/client/drawer-navigation.js';

const scope = { sessionIds: ['root', 'other-root', 'closed-root'], closedSessionIds: ['closed-root'] };

const list: DrawerSessionList = {
  byId: {
    root: { retainedBy: { mainView: 1 } },
    'other-root': {},
    'closed-root': {},
    child: { origin: 'subagent', parentId: 'root' },
    grandchild: { origin: 'subagent', parentId: 'child' },
    fork: { parentId: 'root' },
    'fork-of-child': { parentId: 'child' },
    'closed-child': { origin: 'subagent', parentId: 'closed-root' },
    'foreign-child': { origin: 'subagent', parentId: 'outside' },
    outside: {},
  },
};

describe('navigation classification', () => {
  it('lists the open conversations of the scope', () => {
    expect(openConversationIds(scope)).toEqual(['root', 'other-root']);
    expect(taskConversationScope({ sessionIds: ['a'], closedSessionIds: ['a'] })).toEqual({ sessionIds: ['a'], closedSessionIds: ['a'] });
  });

  it('selects an open conversation of the task', () => {
    expect(classifyNavigation(list, scope, 'root')).toEqual({ kind: 'conversation', sessionId: 'root' });
    expect(classifyNavigation(list, scope, 'other-root')).toEqual({ kind: 'conversation', sessionId: 'other-root' });
  });

  it('keeps a closed conversation foreign and reports an uncatalogued Session as unclassified', () => {
    expect(classifyNavigation(list, scope, 'closed-root')).toEqual({ kind: 'foreign' });
    expect(classifyNavigation(list, scope, 'missing')).toEqual({ kind: 'unclassified' });
    // An ordinary chat is listed without lineage until a refresh proves otherwise.
    expect(classifyNavigation(list, scope, 'outside')).toEqual({ kind: 'unclassified' });
  });

  it('keeps a Session whose parent is not an open conversation foreign', () => {
    const foreign: DrawerSessionList = { byId: { child: { parentId: 'outside' }, outside: {} } };
    expect(classifyNavigation(foreign, scope, 'child')).toEqual({ kind: 'foreign' });
  });

  it('peeks a direct and a nested subagent descendant', () => {
    expect(classifyNavigation(list, scope, 'child')).toEqual({ kind: 'descendant', target: { parentSessionId: 'root', sessionId: 'child', mode: 'unknown' } });
    expect(classifyNavigation(list, scope, 'grandchild')).toEqual({ kind: 'descendant', target: { parentSessionId: 'child', sessionId: 'grandchild', mode: 'unknown' } });
  });

  it('does not own a descendant of a closed conversation or of a foreign Session', () => {
    expect(classifyNavigation(list, scope, 'closed-child')).toEqual({ kind: 'foreign' });
    expect(classifyNavigation(list, scope, 'foreign-child')).toEqual({ kind: 'foreign' });
  });

  it('claims a fork of an open conversation and keeps other forks foreign', () => {
    expect(classifyNavigation(list, scope, 'fork')).toEqual({ kind: 'fork', parentSessionId: 'root', sessionId: 'fork' });
    expect(classifyNavigation(list, scope, 'fork-of-child')).toEqual({ kind: 'foreign' });
  });

  it('fails closed on a cycle', () => {
    const cyclic: DrawerSessionList = { byId: { a: { origin: 'subagent', parentId: 'b' }, b: { origin: 'subagent', parentId: 'a' } } };
    expect(isOwnedDescendant(cyclic, ['root'], 'a')).toBe(false);
    expect(classifyNavigation(cyclic, scope, 'a')).toEqual({ kind: 'foreign' });
  });

  it('walks only subagent edges', () => {
    expect(isOwnedDescendant(list, ['root'], 'child')).toBe(true);
    expect(isOwnedDescendant(list, ['root'], 'grandchild')).toBe(true);
    expect(isOwnedDescendant(list, ['root'], 'fork')).toBe(false);
    expect(isOwnedDescendant(list, ['root'], 'root')).toBe(false);
    expect(isOwnedDescendant(list, ['root'], 'missing')).toBe(false);
    expect(subagentTarget(list, 'fork')).toBeUndefined();
    expect(subagentTarget(list, 'child')).toEqual({ parentSessionId: 'root', sessionId: 'child', mode: 'unknown' });
  });

  it('finds the Session the host retains as mainView', () => {
    expect(mainViewSession(list)).toBe('root');
    expect(mainViewSession({ byId: { a: { retainedBy: { mainView: 0 } } } })).toBeUndefined();
    expect(mainViewSession({ byId: {} })).toBeUndefined();
    expect(mainViewSession({ byId: { a: { retainedBy: { kanbanTaskDrawer: 1 } }, b: { retainedBy: { mainView: 1 } } } })).toBe('b');
  });
});
