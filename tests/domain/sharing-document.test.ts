import { describe, expect, it } from 'vitest';
import { sameSharedDocument, parseSharedDocument, serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { buildPublishDocument, compareSharing, displayState, buildUpdatePlan, publishIsDirty } from '../../src/domain/sharing/plan.js';
import { projectSharingBoards } from '../../src/domain/sharing/projection.js';
import { boardKeyFromName, normalizeBoardName } from '../../src/domain/sharing/identity.js';
import { documentOf, flow, hubWith } from '../support/sharing-fixtures.js';


describe('shared document', () => {
  it('round-trips authored workflow text without normalization', () => {
    const workflow = 'name: Flow\n\n# a comment\ninitial_column: a\ncolumns:\n  - id: a\n    label: A   \n';
    const parsed = parseSharedDocument(serializeSharedDocument(documentOf([{ key: 'flow', name: 'Flow', workflow }])));
    expect(parsed.boards[0]!.workflow).toBe(workflow);
  });

  it('preserves workflows without a trailing newline and with several', () => {
    for (const workflow of ['name: Flow\ninitial_column: a\ncolumns:\n  - id: a\n    label: A', 'name: Flow\ninitial_column: a\ncolumns:\n  - id: a\n    label: A\n\n']) {
      const text = serializeSharedDocument(documentOf([{ key: 'flow', name: 'Flow', workflow }]));
      expect(parseSharedDocument(text).boards[0]!.workflow).toBe(workflow);
    }
  });

  it('rejects duplicate keys, duplicate names, unsafe keys, and invalid workflows', () => {
    expect(() => parseSharedDocument(serializeSharedDocument(documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'a', name: 'B', workflow: flow() }])))).toThrow(/repeats a board key/);
    expect(() => parseSharedDocument(serializeSharedDocument(documentOf([{ key: 'a', name: 'Same', workflow: flow() }, { key: 'b', name: ' same ', workflow: flow() }])))).toThrow(/repeats a board name/);
    expect(() => parseSharedDocument('version: 1\nboards:\n  - key: "Bad Key!"\n    name: A\n    workflow: "name: x"\n')).toThrow(/invalid/i);
    expect(() => parseSharedDocument(serializeSharedDocument(documentOf([{ key: 'a', name: 'A', workflow: 'columns: []' }])))).toThrow(/invalid workflow/);
    expect(() => parseSharedDocument('version: 3\nboards: []\n')).toThrow(/newer plugin version/i);
  });

  it('keys documents by meaning, not by formatting', () => {
    const one = documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]);
    const same = documentOf([{ key: 'a', name: 'A ', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]);
    expect(sharedDocumentToken(one)).toBe(sharedDocumentToken(same));
    expect(sameSharedDocument(one, same)).toBe(true);
    expect(publishIsDirty({ ...one, boards: [{ ...one.boards[0]!, name: 'Renamed' }, one.boards[1]!] }, one)).toBe(true);
    expect(publishIsDirty({ ...one, boards: [{ ...one.boards[0]!, workflow: flow(['a']) }, one.boards[1]!] }, one)).toBe(true);
    expect(publishIsDirty({ ...one, boards: [...one.boards].reverse() }, one)).toBe(true);
  });

  it('projects only boards and board order, with no local records or Hub name', () => {
    const hub = hubWith([{ id: 'board-1', name: 'Delivery', tasks: [{ columnId: 'backlog' }] }]);
    const boards = projectSharingBoards(hub, { 'board-1': 'delivery' });
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ boardId: 'board-1', name: 'Delivery', key: 'delivery', tasks: 1, taskColumns: [{ columnId: 'backlog', tasks: 1 }] });
    expect(JSON.stringify(boards)).not.toContain('My Hub');
    expect(JSON.stringify(boards)).not.toContain('project');
  });

  it('defines the status matrix for Hub and board states', () => {
    const base = documentOf([{ key: 'a', name: 'A', workflow: flow() }]);
    const input = {
      base,
      published: base,
      local: [
        { boardId: 'a', name: 'A', workflow: flow(), key: 'a', tasks: 0, taskColumns: [] },
        { boardId: 'b', name: 'B', workflow: flow(), tasks: 0, taskColumns: [] },
      ],
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [] as string[],
    };
    expect(compareSharing(input).boards.map(board => board.decision).sort()).toEqual(['draft', 'in-sync']);
    expect(compareSharing({ ...input, base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]), published: documentOf([{ key: 'a', name: 'A', workflow: flow(['x']) }]) }).boards.find(board => board.boardId === 'a')?.decision).toBe('updates-available');
    expect(compareSharing({ ...input, base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]), published: documentOf([{ key: 'a', name: 'A', workflow: flow(['y']) }]), local: [{ boardId: 'a', name: 'A', workflow: flow(['x']), key: 'a', tasks: 0, taskColumns: [] }, { boardId: 'b', name: 'B', workflow: flow(), tasks: 0, taskColumns: [] }] }).boards.find(board => board.boardId === 'a')?.decision).toBe('needs-review');
    expect(displayState('create')).toBe('updates-available');
    expect(displayState('remove')).toBe('updates-available');
  });

  it('negotiates keys for new boards and preserves locally removed entries', () => {
    const base = documentOf([{ key: 'kept', name: 'Kept', workflow: flow() }, { key: 'removed', name: 'Removed here', workflow: flow() }]);
    const local = [
      { boardId: 'kept', name: 'Kept', workflow: flow(), key: 'kept', tasks: 0, taskColumns: [] },
      { boardId: 'new', name: 'A New Board', workflow: flow(), tasks: 0, taskColumns: [] },
    ];
    const result = buildPublishDocument({ base, local, bindings: { kept: 'kept' }, orphans: {}, pendingRemovals: [] });
    expect(result.document.boards.map(board => board.key)).toEqual(['kept', 'removed', 'a-new-board']);
    expect(result.bindings.new).toBe('a-new-board');
    expect(result.document.boards.find(board => board.key === 'removed')?.workflow).toBe(flow());
    const withRemoval = buildPublishDocument({ base, local, bindings: { kept: 'kept' }, orphans: {}, pendingRemovals: ['kept'] });
    expect(withRemoval.document.boards.map(board => board.key)).not.toContain('kept');
  });

  it('refuses to publish a board name that a locally removed entry still holds', () => {
    const base = documentOf([{ key: 'gone', name: 'Gone', workflow: flow() }]);
    const local = [{ boardId: 'b', name: 'Gone', workflow: flow(), tasks: 0, taskColumns: [] as Array<{ columnId: string; tasks: number }> }];
    expect(() => buildPublishDocument({ base, local, bindings: {}, orphans: {}, pendingRemovals: [] })).toThrow(/duplicate the board name/);
  });

  it('publishes the local board order and preserves a locally removed entry position', () => {
    const base = documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'c', name: 'C', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]);
    const local = [
      { boardId: 'b', name: 'B', workflow: flow(), key: 'b', tasks: 0, taskColumns: [] as Array<{ columnId: string; tasks: number }> },
      { boardId: 'a', name: 'A', workflow: flow(), key: 'a', tasks: 0, taskColumns: [] as Array<{ columnId: string; tasks: number }> },
    ];
    const result = buildPublishDocument({ base, local, bindings: { a: 'a', b: 'b' }, orphans: {}, pendingRemovals: [] });
    expect(result.document.boards.map(board => board.key)).toEqual(['b', 'a', 'c']);
    const twoBoards = documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]);
    const comparison = compareSharing({ base: twoBoards, published: twoBoards, local, bindings: { a: 'a', b: 'b' }, orphans: {}, removed: {}, pendingRemovals: [] });
    expect(comparison.drafts).toBe(1);
    expect(comparison.updates).toBe(0);
  });

  it('keeps a bound board key across a rename', () => {
    const base = documentOf([{ key: 'delivery', name: 'Delivery', workflow: flow() }]);
    const local = [{ boardId: 'b', name: 'Delivery Renamed', workflow: flow(), key: 'delivery', tasks: 0, taskColumns: [] }];
    const result = buildPublishDocument({ base, local, bindings: { b: 'delivery' }, orphans: {}, pendingRemovals: [] });
    expect(result.document.boards[0]).toMatchObject({ key: 'delivery', name: 'Delivery Renamed' });
  });

  it('does not recreate a published board whose binding survived a deletion in flight', () => {
    const published = documentOf([{ key: 'delivery', name: 'Delivery', workflow: flow() }]);
    const comparison = compareSharing({ base: published, published, local: [], bindings: { deleted: 'delivery' }, orphans: {}, removed: {}, pendingRemovals: [] });
    expect(comparison.boards).toEqual([]);
    expect(comparison.updates).toBe(0);
  });

  it('ignores an orphan anchor whose board no longer exists', () => {
    const published = documentOf([{ key: 'delivery', name: 'Delivery', workflow: flow() }]);
    const comparison = compareSharing({ base: documentOf([{ key: 'delivery', name: 'Delivery', workflow: flow() }]), published, local: [], bindings: {}, orphans: { missing: { lastKey: 'delivery', lastPublishedName: 'Delivery' } }, removed: {}, pendingRemovals: [] });
    expect(comparison.boards[0]).toMatchObject({ decision: 'create', key: 'delivery' });
    expect(() => compareSharing({ base: null, published, local: [], bindings: {}, orphans: { missing: { lastKey: 'delivery', lastPublishedName: 'Delivery' } }, removed: {}, pendingRemovals: [] })).not.toThrow();
  });

  it('counts pending removals and orphans as team updates but not applied orphans', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', tasks: [{ columnId: 'backlog' }] }]);
    const pending = compareSharing({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }, { key: 'b', name: 'B', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a', b: 'b' }),
      bindings: { a: 'a', b: 'b' }, orphans: {}, removed: {}, pendingRemovals: [],
    });
    expect(pending.updates).toBe(1);
    expect(pending.boards.find(board => board.boardId === 'b')).toMatchObject({ decision: 'orphan', pending: true });
    const applied = compareSharing({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' }, orphans: { b: { lastKey: 'b', lastPublishedName: 'B' } }, removed: {}, pendingRemovals: [],
    });
    expect(applied.updates).toBe(0);
    expect(applied.boards.find(board => board.boardId === 'b')).toMatchObject({ decision: 'orphan', pending: false });
  });

  it('allocates stable keys and normalizes names', () => {
    expect(boardKeyFromName('Delivery Flow', [])).toBe('delivery-flow');
    expect(boardKeyFromName('Delivery Flow', ['delivery-flow'])).toBe('delivery-flow-2');
    expect(boardKeyFromName('  ', [])).toBe('board');
    expect(normalizeBoardName(' Delivery FLOW ')).toBe('delivery flow');
  });

  it('builds an update plan that refuses orphaned task columns', () => {
    const hub = hubWith([{ id: 'a', name: 'A', tasks: [{ columnId: 'plan' }] }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow(['backlog', 'plan', 'done']) }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(['backlog', 'done']) }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(plan.comparison.blockers).toMatchObject([{ code: 'SHARING_ORPHAN_COLUMNS', boardId: 'a', columnId: 'plan', tasks: 1 }]);
  });

  it('adopts a same-name local board only on the first connection', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    const published = documentOf([{ key: 'team-a', name: 'A', workflow: flow() }]);
    const local = projectSharingBoards(hub, {});
    const first = compareSharing({ base: null, published, local, bindings: {}, orphans: {}, removed: {}, pendingRemovals: [] });
    expect(first.boards[0]).toMatchObject({ boardId: 'a', key: 'team-a', decision: 'adopt' });
    const later = compareSharing({ base: documentOf([]), published, local, bindings: {}, orphans: {}, removed: {}, pendingRemovals: [] });
    expect(later.boards[0]).toMatchObject({ boardId: 'a', decision: 'needs-review' });
    expect(later.blockers[0]?.code).toBe('SHARING_NAME_COLLISION');
  });

  it('reconnects an orphan by key first and by name second', () => {
    const hub = hubWith([{ id: 'orphan', name: 'Old Board' }]);
    const local = projectSharingBoards(hub, {});
    const published = documentOf([{ key: 'old-board', name: 'Old Board', workflow: flow() }]);
    const byKey = compareSharing({ base: documentOf([{ key: 'old-board', name: 'Old Board', workflow: flow() }]), published, local, bindings: {}, orphans: { orphan: { lastKey: 'old-board', lastPublishedName: 'Old Board' } }, removed: {}, pendingRemovals: [] });
    expect(byKey.boards[0]?.decision).toBe('reconnect');
    const byName = compareSharing({ base: documentOf([{ key: 'old-board', name: 'Old Board', workflow: flow() }]), published: documentOf([{ key: 'new-key', name: 'Old Board', workflow: flow() }]), local, bindings: {}, orphans: { orphan: { lastKey: 'gone', lastPublishedName: 'Old Board' } }, removed: {}, pendingRemovals: [] });
    expect(byName.boards[0]).toMatchObject({ boardId: 'orphan', key: 'new-key', decision: 'reconnect' });
  });
});
