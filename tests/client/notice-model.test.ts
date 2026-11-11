import { describe, expect, it } from 'vitest';
import type { ContextOperation, HubTask, Project, ProjectRelocation, RetainedCheckout } from '../../src/shared/types.js';
import { boardNotices, commandFailureNotice, dismissible, operationNotices, relocationNotices, retainedNotices, type NoticeHandlers } from '../../src/client/notices/model.js';

const handlers: NoticeHandlers = {
  openTask: () => undefined,
  retryOperation: () => undefined,
  forceOperation: () => undefined,
  returnToProject: () => undefined,
  retryRelocation: () => undefined,
};

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 't1', boardId: 'board-1', projectId: 'p1', title: 'Alpha task', description: '', columnId: 'intake', position: 1,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo/apps/api', worktree: null, operation: null,
    createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z', ...overrides,
  };
}

function operation(overrides: Partial<ContextOperation> = {}): ContextOperation {
  return {
    id: 'op-1', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null },
    phase: 'queued', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [],
    gitCompleted: false, createdAt: '2026-10-21T12:00:00Z', ...overrides,
  } as ContextOperation;
}

const project: Project = { id: 'p1', projectKey: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo' };
const retained: RetainedCheckout[] = [
  { path: '/trees/plain', projectId: 'p1', taskTitle: 'Alpha task', reason: 'folder' },
  { path: '/trees/gone', projectId: 'p1', taskTitle: 'Beta task', reason: 'unresolved' },
];

describe('retained checkout notices', () => {
  it('reports the path and the reason each checkout was kept, and is dismissible', () => {
    const [plain, unresolved] = retainedNotices(retained, () => undefined);
    expect(plain!.group).toBe('retained');
    expect(plain!.segments).toEqual([
      { text: 'Task deleted. The checkout at ' },
      { code: '/trees/plain' },
      { text: ' was left on disk because the project is not Git-managed.' },
    ]);
    expect(unresolved!.segments[2]).toEqual({ text: ' was left on disk because its project path or Git root could not be resolved.' });
    expect(plain!.dismiss?.label).toBe('Dismiss the retained checkout at /trees/plain');
    expect(unresolved!.dismiss?.label).toBe('Dismiss the retained checkout at /trees/gone');
  });
});

describe('command failure notice', () => {
  it('is absent while the board has no failure and dismissible when it has one', () => {
    expect(commandFailureNotice(null, () => undefined)).toBeNull();
    const notice = commandFailureNotice({ code: 'MOVE_FAILED', message: 'The move could not be completed.' }, () => undefined)!;
    expect(notice.group).toBe('failure');
    expect(notice.title).toBe('MOVE_FAILED');
    expect(notice.segments).toEqual([{ text: 'The move could not be completed.' }]);
    expect(notice.dismiss?.label).toBe('Dismiss the board failure notice');
  });
});

describe('destructive operation notices', () => {
  it('summarizes a queued operation with its task and state and carries no dismissal', () => {
    const [notice] = operationNotices([task({ operation: operation() })], handlers);
    expect(notice!.group).toBe('operations');
    expect(notice!.title).toBe('1 destructive operation');
    expect(notice!.items).toEqual([{ id: 't1', label: 'Alpha task', suffix: 'Queued', run: expect.any(Function) }]);
    expect(notice!.dismiss).toBeUndefined();
  });

  it('presents a failed operation with its recovery actions and no dismissal', () => {
    const failed = operation({ phase: 'failed', targetPath: '/trees/shared', error: { code: 'SHARED_WORKTREE', message: 'Another conversation is using this checkout.' } });
    const [notice] = operationNotices([task({ operation: failed })], handlers);
    expect(notice!.tone).toBe('failure');
    expect(notice!.title).toBe('Task deletion needs attention: Alpha task');
    expect(notice!.hint).toBe('Another conversation is using this checkout.');
    expect(notice!.actions.map(action => action.id)).toEqual(['force', 'retry', 'return', 'open']);
    expect(notice!.actions[0]?.tone).toBe('danger');
    expect(notice!.dismiss).toBeUndefined();
  });
});

function relocation(overrides: Partial<ProjectRelocation> = {}): ProjectRelocation {
  const location = { projectPath: '/old/api', gitRootPath: '/old' };
  return {
    id: 'r1', request: { from: location, to: { ...location, projectPath: '/new/api', gitRootPath: '/new', name: 'API' } },
    phase: 'waiting', migratedSessionIds: [], started: false, createdAt: '2026-10-21T12:00:00Z', ...overrides,
  };
}

describe('project relocation notices', () => {
  it('offers retry only for a failed relocation and is never dismissible', () => {
    const waiting = relocationNotices([{ ...project, operation: relocation() }], handlers);
    expect(waiting[0]?.title).toBe('Project relocation: API');
    expect(waiting[0]?.actions).toEqual([]);
    expect(waiting[0]?.dismiss).toBeUndefined();
    const failed = relocationNotices([{ ...project, operation: relocation({ phase: 'failed', error: { code: 'RELOCATION_FAILED', message: 'The relocation failed.' } }) }], handlers);
    expect(failed[0]?.tone).toBe('failure');
    expect(failed[0]?.title).toBe('Project relocation needs attention: API');
    expect(failed[0]?.actions.map(action => action.id)).toEqual(['retry-relocation']);
  });
});

describe('notice composition', () => {
  it('keeps the group order and exposes only the dismissible notices', () => {
    const notices = boardNotices({
      commandFailure: commandFailureNotice({ code: 'FAILED', message: 'Failed.' }, () => undefined),
      operations: operationNotices([task({ operation: operation() })], handlers),
      relocations: relocationNotices([{ ...project, operation: relocation() }], handlers),
      retained: retainedNotices(retained, () => undefined),
    });
    expect(notices.map(notice => notice.group)).toEqual(['failure', 'relocation', 'operations', 'retained', 'retained']);
    expect(dismissible(notices).map(notice => notice.id)).toEqual(['command-failure', 'retained:/trees/plain', 'retained:/trees/gone']);
  });
});
