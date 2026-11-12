import { describe, expect, it } from 'vitest';
import type { SharedBoardEntry } from '../../src/domain/sharing/manifest.js';
import { evaluateBoard, publishedWorkflow, wouldOrphanTasks, type LocalBoardView } from '../../src/domain/sharing/board-plan.js';
import { appendEvents, compactBoardLog, createBoardLog } from '../../src/domain/journal/log.js';

const NL = String.fromCharCode(10);
const AT = '2026-01-01T00:00:00.000Z';
const BASE = ['name: Delivery', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);

function local(overrides: Partial<LocalBoardView> = {}): LocalBoardView {
  return { boardId: 'board', name: 'Delivery', workflow: BASE, tasks: 0, taskColumns: [], ...overrides };
}
const entry: SharedBoardEntry = { key: 'delivery', name: 'Delivery' };

describe('per-board evaluation', () => {
  it('reports a local board that is not published as a draft', () => {
    const evaluation = evaluateBoard({ entry: undefined, local: local(), log: null, cursor: 0 });
    expect(evaluation).toMatchObject({ boardId: 'board', state: 'draft', draft: true });
    expect(evaluation.apply).toEqual({ kind: 'nothing' });
  });

  it('reports a published board with no log yet as having updates', () => {
    const evaluation = evaluateBoard({ entry, local: local(), log: null, cursor: 0 });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.draft).toBe(true);
  });

  it('reports an identical board as in sync', () => {
    const evaluation = evaluateBoard({ entry, local: local(), log: createBoardLog(BASE), cursor: 0 });
    expect(evaluation.state).toBe('in-sync');
    expect(evaluation.draft).toBe(false);
    expect(evaluation.apply).toEqual({ kind: 'nothing' });
  });

  it('reports the events a member has not applied', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], AT);
    const evaluation = evaluateBoard({ entry, local: local(), log, cursor: 0 });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.apply).toMatchObject({ kind: 'applies', events: 1 });
  });

  it('reports no update once the member applied the events', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], AT);
    const applied = evaluateBoard({ entry, local: local(), log, cursor: 0 });
    if (applied.apply.kind !== 'applies') throw new Error('expected an application');
    const after = evaluateBoard({ entry, local: local({ workflow: applied.apply.text }), log, cursor: 1 });
    expect(after.state).toBe('in-sync');
    expect(after.draft).toBe(false);
  });

  it('reports an unapplied compacted snapshot even when its event tail is empty', () => {
    const changed = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Compacted update' }], AT);
    const log = compactBoardLog(changed, 0); expect(log.events).toEqual([]);
    const evaluation = evaluateBoard({ entry, local: local(), log, cursor: 0 });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.apply).toMatchObject({ kind: 'applies', events: 1, text: expect.stringContaining('Compacted update') });
  });

  it('reports a local draft beside team events', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], AT);
    const evaluation = evaluateBoard({ entry, local: local({ workflow: BASE.replace('label: Plan', 'label: Planning') }), log, cursor: 0 });
    expect(evaluation.state).toBe('updates-available');
    expect(evaluation.draft).toBe(true);
  });

  it('reports a divergent local rename as needing a review', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], AT);
    const renamed = BASE.replace('initial_column: backlog', 'initial_column: todo').replace('  - id: backlog', '  - id: todo');
    const evaluation = evaluateBoard({ entry, local: local({ workflow: renamed }), log, cursor: 0 });
    expect(evaluation.state).toBe('needs-review');
    expect(evaluation.apply).toMatchObject({ kind: 'conflict', conflict: 'identity' });
  });

  it('previews migrated tasks across sequential team renames without a false orphan refusal', () => {
    const log = appendEvents(createBoardLog(BASE), [
      { kind: 'stage.id-changed', key: 's2', from: 'plan', id: 'review' },
      { kind: 'stage.id-changed', key: 's2', from: 'review', id: 'ready' },
    ], AT);
    const evaluation = evaluateBoard({ entry, local: local({ tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }), log, cursor: 0 });
    expect(evaluation.apply).toMatchObject({ kind: 'applies' }); expect(evaluation.refuses).toBe(false);
  });

  it('previews named deterministic exits after a destination identity rename', () => {
    const source = BASE.replace('    label: Backlog', '    label: Backlog\n    deterministic: {language: bash, code: "printf ready", exits: {passed: plan}}');
    const log = appendEvents(createBoardLog(source), [{ kind: 'stage.id-changed', key: 's2', from: 'plan', id: 'review' }], AT);
    const evaluation = evaluateBoard({ entry, local: local({ workflow: source, tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }), log, cursor: 0 });
    expect(evaluation.refuses).toBe(false); expect(evaluation.apply).toMatchObject({ kind: 'applies' });
    if (evaluation.apply.kind !== 'applies') throw new Error('Expected team update.');
    expect(evaluation.apply.text).toContain('passed: review');
  });

  it('refuses an application that would leave a task in an undefined stage', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'stage.removed', key: 's2' }], AT);
    const evaluation = evaluateBoard({
      entry,
      local: local({ tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }),
      log,
      cursor: 0,
    });
    expect(evaluation.apply).toMatchObject({ kind: 'applies' });
    expect(evaluation.refuses).toBe(true);
  });

  it('describes the published workflow from the log', () => {
    const log = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], AT);
    expect(publishedWorkflow(log)).toContain('name: Renamed');
    expect(publishedWorkflow(null)).toBeNull();
  });

  it('treats a task whose stage exists as not orphaned', () => {
    expect(wouldOrphanTasks(BASE, local({ tasks: 1, taskColumns: [{ columnId: 'plan', tasks: 1 }] }))).toBe(false);
  });
});
