import { describe, expect, it } from 'vitest';
import { BoardStateSchema, initialState } from '../../src/domain/schema.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { canonicalWorkflow, workflowMeaning } from '../../src/domain/schema-parts.js';
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

  it('accepts the shared auto-mode and transition-origin fields on the legacy aggregate', () => {
    const state = populatedState();
    state.tasks[0]!.autoMode = { enabled: true, pause: { reason: 'turn-blocked', at: '2026-10-21T10:00:00.000Z' } };
    state.tasks[0]!.pendingTransition = { id: 'p', fromColumnId: 'backlog', columnId: 'backlog', mode: 'move', status: 'waiting', origin: 'auto' };
    const parsed = BoardStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.autoMode?.pause?.reason).toBe('turn-blocked');
    expect(parsed.success && parsed.data.tasks[0]!.pendingTransition?.origin).toBe('auto');
  });

  it('accepts a task flow record and rejects an entry whose kind needs a field it lacks', () => {
    const state = populatedState();
    state.tasks[0]!.history = [{ kind: 'created', at: '2026-10-21T10:00:00.000Z', columnId: 'backlog' }];
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
    state.tasks[0]!.history = [{ kind: 'auto-mode', at: '2026-10-21T10:00:00.000Z', action: 'paused' }];
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
    state.tasks[0]!.history = [{ kind: 'worktree', at: '2026-10-21T10:00:00.000Z', action: 'created', path: '/trees/one' }];
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('normalizes a stored workflow written with bare transition identifiers', () => {
    const yaml = 'name: Flow\ncolumns:\n  - id: backlog\n    label: Backlog\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n';
    const state = populatedState();
    state.workflowYaml = yaml;
    state.workflow = parseWorkflow(yaml);
    // The shape a previous version persisted: bare identifiers, not entries.
    state.workflow.columns[0]!.allowedTransitions = ['done'] as never;
    const parsed = BoardStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.workflow.columns[0]!.allowedTransitions).toEqual([{ to: 'done' }]);
  });

  it('accepts a pause requested by the agent beside the diagnostic pause', () => {
    const state = populatedState();
    state.tasks[0]!.autoMode = {
      enabled: true,
      hold: { reason: 'Review the diff', at: '2026-10-21T10:00:00.000Z' },
      pause: { reason: 'turn-error', at: '2026-10-21T10:00:00.000Z' },
    };
    const parsed = BoardStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.autoMode?.hold?.reason).toBe('Review the diff');
    expect(parsed.success && parsed.data.tasks[0]!.autoMode?.pause?.reason).toBe('turn-error');
  });

  it('rejects an unknown pause reason and a hold without enabled auto mode', () => {
    const unknown = populatedState();
    unknown.tasks[0]!.autoMode = { enabled: true, pause: { reason: 'agent-requested' as never, at: '2026-10-21T10:00:00.000Z' } };
    expect(BoardStateSchema.safeParse(unknown).success).toBe(false);
    const disabled = populatedState();
    disabled.tasks[0]!.autoMode = { enabled: false, hold: { reason: 'Review', at: '2026-10-21T10:00:00.000Z' } };
    expect(BoardStateSchema.safeParse(disabled).success).toBe(false);
  });

  it('accepts a recorded transition and the transition-stale pause reason', () => {
    const state = populatedState();
    state.tasks[0]!.recordedTransition = { fromColumnId: 'backlog', columnId: 'done', at: '2026-10-21T10:00:00.000Z' };
    state.tasks[0]!.autoMode = { enabled: true, pause: { reason: 'transition-stale', at: '2026-10-21T10:00:00.000Z' } };
    const parsed = BoardStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.recordedTransition?.columnId).toBe('done');
    expect(parsed.success && parsed.data.tasks[0]!.autoMode?.pause?.reason).toBe('transition-stale');
  });

  it('accepts a recording whose target stage was removed from the workflow', () => {
    const state = populatedState();
    state.tasks[0]!.recordedTransition = { fromColumnId: 'backlog', columnId: 'missing', at: '2026-10-21T10:00:00.000Z' };
    // This is the state a workflow edit produces, and the advance reports it as a
    // stale recording instead of the save being refused.
    const parsed = BoardStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tasks[0]!.recordedTransition?.columnId).toBe('missing');
  });

  it('rejects a recording whose source stage is outside the workflow', () => {
    const state = populatedState();
    state.tasks[0]!.recordedTransition = { fromColumnId: 'missing', columnId: 'done', at: '2026-10-21T10:00:00.000Z' };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects an unknown pause reason', () => {
    const state = populatedState();
    state.tasks[0]!.autoMode = { enabled: true, pause: { reason: 'unknown' as never, at: '2026-10-21T10:00:00.000Z' } };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('accepts an optional project relocation journal and rejects an unknown phase', () => {
    const state = populatedState();
    state.projects[0]!.operation = {
      id: 'relocation',
      request: {
        from: { projectPath: '/repos/platform/services/api', gitRootPath: '/repos/platform' },
        to: { name: 'API', projectPath: '/moved/services/api', gitRootPath: '/moved' },
      },
      phase: 'waiting',
      migratedSessionIds: ['session-1'],
      started: true,
      createdAt: '2026-10-21T10:00:00.000Z',
    };
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
    state.projects[0]!.operation!.phase = 'unknown' as never;
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects missing required fields and unknown top-level data instead of silently dropping it', () => {
    const state = initialState() as unknown as Record<string, unknown>;
    delete state.schemaVersion;
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
    expect(BoardStateSchema.safeParse({ ...initialState(), engine: 'legacy' }).success).toBe(false);
  });

  it('persists the default presentation and authored stage positions', () => {
    const yaml = 'name: Flow\ndefault_view: workflow\ncolumns:\n  - id: todo\n    label: To do\n    position: {x: 10, y: 20}\n  - id: done\n    label: Done\n';
    const state = populatedState();
    state.tasks[0]!.columnId = 'todo';
    state.workflowYaml = yaml;
    state.workflow = parseWorkflow(yaml);
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });

  it('persists authored stage sizes', () => {
    const yaml = 'name: Flow\ncolumns:\n  - id: todo\n    label: To do\n    size: {width: 400, height: 300}\n  - id: done\n    label: Done\n';
    const state = populatedState();
    state.tasks[0]!.columnId = 'todo';
    state.workflowYaml = yaml;
    state.workflow = parseWorkflow(yaml);
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });

  it('rejects a stored stage size below the accepted minimum', () => {
    const yaml = 'name: Flow\ncolumns:\n  - id: todo\n    label: To do\n  - id: done\n    label: Done\n';
    const state = populatedState();
    state.tasks[0]!.columnId = 'todo';
    state.workflowYaml = yaml;
    state.workflow = parseWorkflow(yaml);
    (state.workflow.columns[0] as { size?: { width: number; height: number } }).size = { width: 10, height: 10 };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects a stored stage size that the authored YAML does not carry', () => {
    const state = initialState();
    state.workflow.columns[0]!.size = { width: 400, height: 300 };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects an unknown default presentation in the stored workflow', () => {
    const state = initialState();
    (state.workflow as { defaultView?: string }).defaultView = 'diagram';
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects a stored stage position that the authored YAML does not carry', () => {
    const state = initialState();
    state.workflow.columns[0]!.position = { x: 1, y: 2 };
    expect(BoardStateSchema.safeParse(state).success).toBe(false);
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

describe('workflow connection layout identity', () => {
  const columns = 'columns:' + String.fromCharCode(10) + '  - id: todo' + String.fromCharCode(10) + '    label: To do' + String.fromCharCode(10) + '  - id: done' + String.fromCharCode(10) + '    label: Done' + String.fromCharCode(10);

  it('persists an authored connection layout', () => {
    const yaml = 'name: Flow' + String.fromCharCode(10) + columns + 'connections:' + String.fromCharCode(10) + '  - from: todo' + String.fromCharCode(10) + '    to: done' + String.fromCharCode(10) + '    source: {side: top, at: 4}' + String.fromCharCode(10) + '    segments: [{axis: x, offset: 32}]' + String.fromCharCode(10);
    const state = populatedState();
    state.tasks[0]!.columnId = 'todo';
    state.workflowYaml = yaml;
    state.workflow = parseWorkflow(yaml);
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });

  it('treats a connection adjustment as layout, not as workflow meaning', () => {
    const plain = parseWorkflow('name: Flow' + String.fromCharCode(10) + columns);
    const adjusted = parseWorkflow('name: Flow' + String.fromCharCode(10) + columns + 'connections:' + String.fromCharCode(10) + '  - from: todo' + String.fromCharCode(10) + '    to: done' + String.fromCharCode(10) + '    target: {side: bottom, at: 1}' + String.fromCharCode(10));
    expect(workflowMeaning(adjusted)).toBe(workflowMeaning(plain));
    expect(canonicalWorkflow(adjusted)).not.toBe(canonicalWorkflow(plain));
  });

  it('keeps the workflow identity independent of the authored entry order', () => {
    const forward = parseWorkflow('name: Flow' + String.fromCharCode(10) + columns + 'connections:' + String.fromCharCode(10) + '  - from: todo' + String.fromCharCode(10) + '    to: done' + String.fromCharCode(10) + '  - from: done' + String.fromCharCode(10) + '    to: todo' + String.fromCharCode(10));
    const reversed = parseWorkflow('name: Flow' + String.fromCharCode(10) + columns + 'connections:' + String.fromCharCode(10) + '  - from: done' + String.fromCharCode(10) + '    to: todo' + String.fromCharCode(10) + '  - from: todo' + String.fromCharCode(10) + '    to: done' + String.fromCharCode(10));
    expect(canonicalWorkflow(forward)).toBe(canonicalWorkflow(reversed));
  });
});
