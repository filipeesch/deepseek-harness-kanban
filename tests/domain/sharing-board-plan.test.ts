import { describe, expect, it } from 'vitest';
import { boardChanges, evaluateBoard, orphanedColumns, type BoardMirrorView } from '../../src/domain/sharing/board-plan.js';
import type { LocalSharedBoard } from '../../src/domain/sharing/projection.js';

const NL = String.fromCharCode(10);
const BASE = ['name: Delivery', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);

function local(overrides: Partial<LocalSharedBoard> = {}): LocalSharedBoard {
  return { boardId: 'board', name: 'Delivery', workflow: BASE, projectKeys: null, tasks: 0, taskColumns: [], ...overrides };
}
function mirror(overrides: Partial<BoardMirrorView> = {}): BoardMirrorView {
  return { cursor: 0, present: true, workflow: BASE, name: 'Delivery', projectKeys: null, rank: 'i', updates: 0, removal: false, incoming: null, conflict: null, problem: null, ...overrides };
}

describe('per-board evaluation', () => {
  it('reports a local board that is not published as a draft', () => {
    expect(evaluateBoard({ local: local(), mirror: null, orphaned: false, rank: 'i' })).toMatchObject({ boardId: 'board', state: 'draft', draft: true });
  });

  it('reports a board the team removed as an orphan', () => {
    expect(evaluateBoard({ local: local(), mirror: null, orphaned: true, rank: null }).state).toBe('orphan');
  });

  it('reports a bound board whose log is absent as a draft, never as removed', () => {
    const evaluation = evaluateBoard({ local: local({ key: 'delivery' }), mirror: { ...mirror(), cursor: -1, present: false, workflow: null, name: null, rank: null }, orphaned: false, rank: 'i' });
    expect(evaluation.state).toBe('draft');
    expect(evaluation.draft).toBe(true);
  });

  it('reports an identical board as in sync', () => {
    const evaluation = evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror(), orphaned: false, rank: 'i' });
    expect(evaluation.state).toBe('in-sync');
    expect(evaluation.draft).toBe(false);
  });

  it('reports a workflow, name, scope, or position difference as a draft', () => {
    expect(evaluateBoard({ local: local({ key: 'delivery', workflow: BASE.replace('label: Plan', 'label: Planning') }), mirror: mirror(), orphaned: false, rank: 'i' }).state).toBe('draft');
    expect(evaluateBoard({ local: local({ key: 'delivery', name: 'Renamed' }), mirror: mirror(), orphaned: false, rank: 'i' }).state).toBe('draft');
    expect(evaluateBoard({ local: local({ key: 'delivery', projectKeys: ['app'] }), mirror: mirror(), orphaned: false, rank: 'i' }).state).toBe('draft');
    expect(evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror(), orphaned: false, rank: 'n' }).state).toBe('draft');
  });

  it('retains description-only local drafts while team updates wait', () => {
    for (const workflow of [BASE.replace('name: Delivery', 'name: Delivery\ndescription: Local'), BASE.replace('label: Plan', 'label: Plan\n    description: Local')]) {
      const evaluation = evaluateBoard({ local: local({ key: 'delivery', workflow }), mirror: mirror({ updates: 1 }), orphaned: false, rank: 'i' });
      expect(evaluation).toMatchObject({ state: 'updates-available', draft: true });
      expect(boardChanges({ local: local({ key: 'delivery', workflow }), mirror: mirror(), rank: 'i' })).not.toEqual([]);
    }
  });

  it('compares the recorded default choice instead of counting it as pending work', () => {
    // A board that records the same choice the installation applied is up to date.
    expect(evaluateBoard({ local: local({ key: 'delivery', defaultPresetMode: 'operator' }), mirror: mirror({ presetMode: 'operator' }), orphaned: false, rank: 'i' }))
      .toMatchObject({ state: 'in-sync', draft: false });
    // A different choice, a recorded one with no applied counterpart, and a cleared one
    // are all local work.
    expect(evaluateBoard({ local: local({ key: 'delivery', defaultPresetMode: 'host' }), mirror: mirror({ presetMode: 'operator' }), orphaned: false, rank: 'i' }))
      .toMatchObject({ state: 'draft', draft: true });
    expect(evaluateBoard({ local: local({ key: 'delivery', defaultPresetMode: 'operator' }), mirror: mirror(), orphaned: false, rank: 'i' }))
      .toMatchObject({ state: 'draft', draft: true });
    expect(evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror({ presetMode: 'operator' }), orphaned: false, rank: 'i' }))
      .toMatchObject({ state: 'draft', draft: true });
  });

  it('does not treat an authored blank description as a change', () => {
    expect(evaluateBoard({ local: local({ key: 'delivery', workflow: BASE.replace('name: Delivery', 'name: Delivery\ndescription: ""') }), mirror: mirror(), orphaned: false, rank: 'i' }))
      .toMatchObject({ state: 'in-sync', draft: false });
  });

  it('is a draft exactly when a publish would append a change', () => {
    // A document that omits its authored identity lines is the same board: the publish
    // derivation matches identities, so the state rule must not count them as a change.
    const withoutIdentities = BASE.split(NL).filter(line => !line.trim().startsWith('key:')).join(NL);
    const rekeyed = BASE.replace('key: s2', 'key: authored-2');
    const cases: Array<{ local: LocalSharedBoard; mirror: BoardMirrorView | null; rank: string }> = [
      { local: local({ key: 'delivery', workflow: withoutIdentities }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', workflow: rekeyed }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery' }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', name: 'Renamed' }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', projectKeys: ['app'] }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', workflow: BASE.replace('label: Plan', 'label: Planning') }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', workflow: BASE.replace('label: Plan', 'label: Plan\n    description: Details') }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery', defaultPresetMode: 'operator' }), mirror: mirror({ presetMode: 'operator' }), rank: 'i' },
      { local: local({ key: 'delivery', defaultPresetMode: 'host' }), mirror: mirror({ presetMode: 'operator' }), rank: 'i' },
      { local: local({ key: 'delivery', workflow: BASE.replace('name: Delivery', 'name: Delivery\ndescription: ""') }), mirror: mirror(), rank: 'i' },
      { local: local({ key: 'delivery' }), mirror: mirror(), rank: 'n' },
    ];
    for (const scenario of cases) {
      const draft = evaluateBoard({ ...scenario, orphaned: false }).draft;
      const changes = boardChanges(scenario);
      expect({ draft, appended: changes.length > 0 }).toEqual({ draft: changes.length > 0, appended: changes.length > 0 });
    }
  });

  it('reports the events a member has not applied', () => {
    const evaluation = evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror({ updates: 2 }), orphaned: false, rank: 'i' });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.updates).toBe(2);
    expect(evaluation.draft).toBe(false);
  });

  it('records local work even while team updates wait', () => {
    const evaluation = evaluateBoard({ local: local({ key: 'delivery', workflow: BASE.replace('label: Plan', 'label: Planning') }), mirror: mirror({ updates: 2 }), orphaned: false, rank: 'i' });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.draft).toBe(true);
  });

  it('reports an observed removal event as an orphan with its pending update', () => {
    const evaluation = evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror({ removal: true, updates: 1 }), orphaned: false, rank: 'i' });
    expect(evaluation.state).toBe('orphan');
    expect(evaluation.updates).toBe(1);
  });

  it('reports a needed choice and a required plugin update', () => {
    expect(evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror({ conflict: 'identity' }), orphaned: false, rank: 'i' }).state).toBe('needs-review');
    expect(evaluateBoard({ local: local({ key: 'delivery' }), mirror: mirror({ problem: { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'x' } }), orphaned: false, rank: 'i' }).state).toBe('update-required');
  });

  it('names the stages that hold tasks and the resulting workflow drops', () => {
    expect(orphanedColumns(BASE, local({ tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }))).toEqual([]);
    const withoutPlan = BASE.replace('  - id: plan' + NL + '    key: s2' + NL + '    label: Plan' + NL, '');
    expect(orphanedColumns(withoutPlan, local({ tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }))).toEqual(['plan']);
  });
});

describe('board change summary', () => {
  it('is empty for a board that matches what was applied', () => {
    expect(boardChanges({ local: local({ key: 'delivery' }), mirror: mirror(), rank: 'i' })).toEqual([]);
  });

  it('describes a rename, a scope change, and a position change', () => {
    const changes = boardChanges({
      local: local({ key: 'delivery', name: 'Renamed', projectKeys: ['app'] }),
      mirror: mirror(),
      rank: 'n',
    });
    expect(changes).toContainEqual({ kind: 'board.renamed', name: 'Renamed' });
    expect(changes).toContainEqual({ kind: 'board.scope-changed', projects: 1, closed: false });
    expect(changes).toContainEqual({ kind: 'board.rank-changed' });
  });

  it('describes a workflow edit without carrying the authored text', () => {
    const changes = boardChanges({
      local: local({ key: 'delivery', workflow: BASE.replace('label: Plan', 'label: Planning') }),
      mirror: mirror(),
      rank: 'i',
    });
    expect(changes).toEqual([{ kind: 'stage.field-changed', stage: 's2', field: 'name' }]);
    expect(JSON.stringify(changes)).not.toContain('Planning');
  });

  it('describes the whole workflow for a board with no applied version', () => {
    expect(boardChanges({ local: local(), mirror: null, rank: 'i' })).toEqual([{ kind: 'board.created' }]);
  });
});
