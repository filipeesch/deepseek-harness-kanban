import { describe, expect, it } from 'vitest';
import { NO_PENDING_USER_WORK, type Attention, type Column } from '../../src/shared/types.js';
import { draftChanged, draftProblems, duplicateNameWarning, stageDraft, stagePatch, stageRenameBlock, transitionChoices } from '../../src/client/stage/stage-editor-draft.js';

const columns: Column[] = [
  { id: 'plan', name: 'Plan', onEnterPrompt: 'Read the brief.' },
  { id: 'done', name: 'Done', allowedTransitions: [{ to: 'plan', when: 'needs work' }] },
];

describe('stage editor draft', () => {
  it('opens on the stored stage', () => {
    const draft = stageDraft(columns[1]!);
    expect(draft).toEqual({ name: 'Done', onEnterPrompt: '', mode: 'restricted', transitions: [{ to: 'plan', when: 'needs work' }], initial: false, id: 'done' });
    expect(draftChanged(draft, columns[1]!)).toBe(false);
  });

  it('reports an empty name, an empty id, and an unsafe id', () => {
    const blank = { ...stageDraft(columns[0]!), name: '   ', id: '' };
    expect(draftProblems(blank, new Set(['done'])).map(problem => problem.field)).toEqual(['name', 'id']);
    expect(draftProblems({ ...blank, id: 'not safe' }, new Set(['done'])).some(problem => problem.field === 'id')).toBe(true);
    // A duplicate identifier is a field problem, so the editor never sends a command the host would reject.
    expect(draftProblems({ ...stageDraft(columns[0]!), id: 'done' }, new Set(['done']))).toEqual([{ field: 'id', message: 'Another stage already uses this id.' }]);
  });

  it('reports an empty restricted set, a duplicate destination, and its own stage', () => {
    const empty = { ...stageDraft(columns[0]!), mode: 'restricted' as const, transitions: [] };
    expect(draftProblems(empty, new Set(['done']))).toHaveLength(1);
    const twice = { ...empty, transitions: [{ to: 'done', when: '' }, { to: 'done', when: '' }] };
    expect(draftProblems(twice, new Set(['done'])).some(problem => /once/.test(problem.message))).toBe(true);
    const self = { ...empty, transitions: [{ to: 'plan', when: '' }] };
    expect(draftProblems(self, new Set(['done'])).some(problem => /own destination/.test(problem.message))).toBe(true);
  });

  it('warns about a duplicate name without blocking it', () => {
    const draft = { ...stageDraft(columns[0]!), name: 'Done' };
    expect(duplicateNameWarning(draft, columns, 'plan')).toContain('Done');
    expect(duplicateNameWarning({ ...draft, name: 'Plan' }, columns, 'plan')).toBeNull();
  });

  it('patches only the fields that changed', () => {
    const base = stageDraft(columns[1]!);
    expect(stagePatch(base, columns[1]!)).toEqual({});
    expect(stagePatch({ ...base, name: 'Shipped ' }, columns[1]!)).toEqual({ name: 'Shipped' });
    expect(stagePatch({ ...base, onEnterPrompt: '   ' }, columns[1]!)).toEqual({ onEnterPrompt: null });
    expect(stagePatch({ ...base, id: 'shipped' }, columns[1]!)).toEqual({ id: 'shipped' });
    expect(stagePatch({ ...base, initial: true }, columns[1]!)).toEqual({ initial: true });
    expect(stagePatch({ ...base, mode: 'any' }, columns[1]!)).toEqual({ allowedTransitions: null });
    expect(stagePatch({ ...base, transitions: [{ to: 'plan', when: 'needs review' }] }, columns[1]!)).toEqual({ allowedTransitions: [{ to: 'plan', when: 'needs review' }] });
  });

  it('distinguishes the stage that permits nothing from the one that permits anything', () => {
    const terminal: Column = { id: 'done', name: 'Done', allowedTransitions: [] };
    const draft = stageDraft(terminal);
    expect(draft.mode).toBe('none');
    expect(draft.transitions).toEqual([]);
    expect(draftChanged(draft, terminal)).toBe(false);
    expect(stagePatch(draft, terminal)).toEqual({});
    // Choosing no destinations authors the empty list, not an absence.
    expect(stagePatch({ ...stageDraft({ id: 'todo', name: 'Todo' }), mode: 'none' }, { id: 'todo', name: 'Todo' })).toEqual({ allowedTransitions: [] });
    // Making it unrestricted is a real change the save must author as an absence.
    expect(stagePatch({ ...draft, mode: 'any' }, terminal)).toEqual({ allowedTransitions: null });
    // A stage with no authored list is the unrestricted one.
    expect(stageDraft({ id: 'todo', name: 'Todo' }).mode).toBe('any');
  });

  it('reports a restricted draft with no destination by naming the no-destinations mode', () => {
    const empty = { ...stageDraft(columns[0]!), mode: 'restricted' as const, transitions: [] };
    expect(draftProblems(empty, new Set(['done']))).toEqual([{ field: 'transitions', message: 'Choose at least one destination, or choose "No destinations".' }]);
  });

  it('offers every other stage as a destination', () => {
    expect(transitionChoices(columns, 'plan').map(column => column.id)).toEqual(['done']);
  });

  it('blocks a rename while any task of the board is busy', () => {
    const busyAt = (attention: Record<string, Attention>) => stageRenameBlock([{ id: 'task', columnId: 'plan' } as never], attention);
    const idle: Attention = { running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK };
    expect(busyAt({})).toBeNull();
    expect(busyAt({ task: { ...idle, running: true } })).toContain('running conversation');
    expect(busyAt({ task: { ...idle, background: [{ kind: 'job', label: 'Run tests' }] } })).not.toBeNull();
    expect(stageRenameBlock([{ id: 'task', columnId: 'plan', autoMode: { enabled: true } } as never], {})).toContain('auto mode');
  });
});
