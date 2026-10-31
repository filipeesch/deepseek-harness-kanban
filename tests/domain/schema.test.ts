import { describe, expect, it } from 'vitest';
import { BoardStateSchema, initialState } from '../../src/domain/schema.js';
import { populatedState, sampleTask } from './helpers.js';

describe('persisted board schema', () => {
  it('provides independent valid initial snapshots', () => {
    const first = initialState();
    first.workflow.columns[0]!.name = 'Changed';
    expect(initialState().workflow.columns[0]!.name).toBe('Backlog');
    expect(BoardStateSchema.safeParse(initialState()).success).toBe(true);
    expect(BoardStateSchema.safeParse(populatedState()).success).toBe(true);
  });

  it.each([-1, 1.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', revision => {
    expect(BoardStateSchema.safeParse({ ...initialState(), revision }).success).toBe(false);
  });

  it.each([0, 3, '1', null])('rejects unsupported schema version %s', schemaVersion => {
    expect(BoardStateSchema.safeParse({ ...initialState(), schemaVersion }).success).toBe(false);
  });

  it('rejects missing required fields and unknown top-level data instead of silently dropping it', () => {
    const state = initialState() as unknown as Record<string, unknown>;
    delete state.schemaVersion;
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
    expect(BoardStateSchema.safeParse({ ...initialState(), engine: 'legacy' }).success).toBe(false);
  });

  it('accepts reordered object keys without confusing them with workflow changes', () => {
    const state = initialState();
    state.workflow = { groups: state.workflow.groups, columns: state.workflow.columns, initialColumnId: state.workflow.initialColumnId, name: state.workflow.name };
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    ['duplicate project IDs', (state: ReturnType<typeof populatedState>) => { state.projects.push({ ...state.projects[0]! }); }],
    ['duplicate task IDs', (state: ReturnType<typeof populatedState>) => { state.tasks.push({ ...sampleTask(), sessionIds: ['other-session'] }); }],
    ['duplicate note IDs', (state: ReturnType<typeof populatedState>) => { state.notes.push({ ...state.notes[0]! }); }],
    ['missing task project', (state: ReturnType<typeof populatedState>) => { state.tasks[0]!.projectId = 'missing'; }],
    ['orphan column', (state: ReturnType<typeof populatedState>) => { state.tasks[0]!.columnId = 'missing'; }],
    ['orphan note', (state: ReturnType<typeof populatedState>) => { state.notes[0]!.taskId = 'missing'; }],
    ['session shared by tasks', (state: ReturnType<typeof populatedState>) => { state.tasks.push(sampleTask('task-2')); }],
    ['duplicate task session', (state: ReturnType<typeof populatedState>) => { state.tasks[0]!.sessionIds.push('session-1'); }],
    ['closed foreign session', (state: ReturnType<typeof populatedState>) => { state.tasks[0]!.closedSessionIds.push('missing'); }],
    ['relative project path', (state: ReturnType<typeof populatedState>) => { state.projects[0]!.projectPath = 'relative/path'; }],
    ['invalid ID', (state: ReturnType<typeof populatedState>) => { state.notes[0]!.id = '../file'; }],
    ['workflow mismatch', (state: ReturnType<typeof populatedState>) => { state.workflow.columns[0]!.name = 'Unpersisted change'; }],
  ] as const)('rejects %s', (_label, mutate) => {
    const state = populatedState();
    mutate(state);
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });


  it('accepts a task without an initial native session and with a persisted base choice', () => {
    const state = populatedState(); state.tasks[0]!.sessionIds = []; state.tasks[0]!.worktreeDismissed = true;
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });

  it.each(['remove', 'delete'] as const)('preserves an optional captured worktree confirmation target for %s', kind => {
    for (const target of [undefined, null, '/worktrees/confirmed-target']) {
      const state = populatedState();
      state.tasks[0]!.operation = {
        id: 'operation-confirmation', request: { kind, discardChanges: false, ...(target === undefined ? {} : { expectedWorktreePath: target }) },
        phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T10:00:00.000Z',
      };
      expect(BoardStateSchema.parse(state).tasks[0]?.operation?.request).toEqual(state.tasks[0]!.operation.request);
    }
  });

  it.each(['relative/path', 12, true])('rejects an invalid captured confirmation path %s', target => {
    const state = populatedState();
    state.tasks[0]!.operation = {
      id: 'operation-confirmation', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: target as string },
      phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T10:00:00.000Z',
    };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it.each([
    { mode: 'new', path: 'relative', branchName: 'feature' },
    { mode: 'new', path: '/worktrees/feature', branchName: '' },
    { mode: 'existing', path: '/worktrees/feature', branchName: 'feature', engine: 'unsupported' },
  ])('validates pending worktree prerequisites with the strict creation shape %#', request => {
    const state = populatedState();
    state.tasks[0]!.pendingTransition = { id: 'transition-tree', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', status: 'waiting', worktreeRequest: request as never };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('preserves optional transition override consent on pending transitions', () => {
    const withOverride = populatedState();
    withOverride.tasks[0]!.pendingTransition = { id: 'transition-override', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'move', status: 'waiting', transitionOverride: true };
    expect(BoardStateSchema.parse(withOverride).tasks[0]!.pendingTransition).toEqual(withOverride.tasks[0]!.pendingTransition);

    const legacy = populatedState();
    legacy.tasks[0]!.pendingTransition = { id: 'transition-legacy', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'move', status: 'waiting' };
    expect(BoardStateSchema.safeParse(legacy).success).toBe(true);

    const unknown = populatedState();
    unknown.tasks[0]!.pendingTransition = { id: 'transition-unknown', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'move', status: 'waiting', override: true } as never;
    expect(BoardStateSchema.safeParse(unknown).success).toBe(false);
  });

  it('accepts optional board settings and a stored board without them', () => {
    expect(BoardStateSchema.safeParse(initialState()).success).toBe(true);
    const withBase = initialState();
    withBase.settings = { worktreeBasePath: '/worktrees' };
    expect(BoardStateSchema.safeParse(withBase).success).toBe(true);
    const legacy = initialState() as unknown as Record<string, unknown>;
    delete legacy.settings;
    expect(BoardStateSchema.safeParse(legacy).success).toBe(true);
  });

  it.each([
    { worktreeBasePath: 'relative/path' },
    { worktreeBasePath: '' },
    { worktreeBasePath: 12 },
    { worktreeBasePath: null },
    { worktreeBasePath: '/worktrees', engine: 'legacy' },
  ])('rejects invalid board settings %#', settings => {
    const state = initialState();
    state.settings = settings as never;
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects operation bookkeeping for another native conversation', () => {
    const state = populatedState();
    state.tasks[0]!.operation = {
      id: 'operation-1', request: { kind: 'return' }, phase: 'failed', previousDirectories: { 'foreign-session': '/wrong' },
      switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T10:00:00.000Z',
    };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });
});
