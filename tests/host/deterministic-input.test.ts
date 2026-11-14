import { describe, expect, it } from 'vitest';
import { buildDeterministicInput } from '../../src/host/deterministic/input.js';
import type { DeterministicCapture, DeterministicControl } from '../../src/shared/deterministic.js';
import type { Board, HubState, HubTask, Project } from '../../src/shared/types.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';

const at = '2026-11-12T07:00:00.000Z';
const capture: DeterministicCapture = { sourceRef: 'ref', fingerprint: 'fp', language: 'typescript', directory: 'task', executionDirectory: '/repo/wt', source: { kind: 'inline' }, env: [], params: ['pipeline', 'app'], exits: {} };
const control: DeterministicControl = { entryId: 'entry', executionId: 'execution', stageIdentity: 'wait-key', definition: { language: 'typescript', code: 'return null', directory: 'task', exits: {} }, parameters: { pipeline: 'ci-main', app: 'checkout', extra: 'ignored' }, phase: 'active', startedAt: at, attempt: 1, attemptId: 'attempt', restartCount: 0 };

function located(overrides: { task?: Partial<HubTask>; projectPath?: string } = {}): LocatedTask {
  const task: HubTask = { id: 'task', boardId: 'board', projectId: 'project', title: 'Count CI', description: 'data only', columnId: 'wait', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/wt', worktree: null, operation: null, createdAt: at, updatedAt: at,
    stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'wait-key', enteredAt: at }, ...overrides.task };
  const board = { id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Flow', initialColumnId: 'wait', groups: [], columns: [{ id: 'wait', name: 'Wait', key: 'wait-key' }, { id: 'done', name: 'Done', key: 'done-key' }] }, createdAt: at, updatedAt: at } as Board;
  const project = { id: 'project', projectKey: 'project-key', name: 'Project', projectPath: 'projectPath' in overrides ? overrides.projectPath : '/repo' } as Project;
  const hub: HubState = { id: 'hub', name: 'Hub', revision: 0, tasks: [task], boards: [board], projects: [project], notes: [], createdAt: at, updatedAt: at };
  return { hubId: hub.id, hub, task, board, project };
}

describe('deterministic program input', () => {
  it('builds the typed context with exactly the declared values', () => {
    const input = buildDeterministicInput(located(), control, capture);
    expect(input).toMatchObject({ task: { id: 'task', title: 'Count CI' }, hub: { id: 'hub' }, board: { id: 'board' }, stage: { id: 'wait', identity: 'wait-key' },
      project: { id: 'project', directory: '/repo' }, directory: '/repo/wt', worktree: null, entryId: 'entry', executionId: 'execution', startedAt: at, attempt: 1, attemptId: 'attempt', restartCount: 0 });
    expect(input.params).toEqual({ pipeline: 'ci-main', app: 'checkout' });
  });
  it('passes worktree metadata and only the handoff bound to this entry', () => {
    const task = { worktree: { path: '/repo/wt', branch: 'feature/ci', owned: true, status: 'ready' as const },
      deterministicHandoff: { id: 'handoff', entryId: 'entry', executionId: 'source', fromColumnId: 'before', columnId: 'wait', exit: 'ready', message: 'incoming', at } };
    expect(buildDeterministicInput(located({ task }), control, capture)).toMatchObject({ worktree: { path: '/repo/wt', branch: 'feature/ci' }, handoff: { id: 'handoff' } });
    expect(buildDeterministicInput(located({ task: { ...task, deterministicHandoff: { ...task.deterministicHandoff, entryId: 'other-entry' } } }), control, capture)).not.toHaveProperty('handoff');
  });
  it('keeps the raw sent map out of the handoff while preserving declared values', () => {
    const task = { deterministicHandoff: { id: 'handoff', entryId: 'entry', executionId: 'source', fromColumnId: 'before', columnId: 'wait', exit: 'ready', message: 'incoming', at, params: { pipeline: 'incoming', extra: 'context-only' } } };
    const input = buildDeterministicInput(located({ task }), control, capture);
    expect(input.params).toEqual({ pipeline: 'ci-main', app: 'checkout' });
    expect(input.handoff).toMatchObject({ id: 'handoff', exit: 'ready', message: 'incoming' });
    expect(input.handoff).not.toHaveProperty('params');
  });

  it('keeps the same boundary for a destination that declares no parameters', () => {
    const task = { deterministicHandoff: { id: 'handoff', entryId: 'entry', executionId: 'source', fromColumnId: 'before', columnId: 'wait', exit: 'ready', message: 'incoming', at, params: { pipeline: 'incoming' } } };
    const input = buildDeterministicInput(located({ task }), { ...control, parameters: undefined }, { ...capture, params: [] });
    expect(input.params).toEqual({});
    expect(input.handoff).not.toHaveProperty('params');
  });

  it('omits a stored value the capture no longer declares and a missing declared value', () => {
    const input = buildDeterministicInput(located(), { ...control, parameters: { pipeline: 'ci-main', extra: 'ignored' } }, capture);
    expect(input.params).toEqual({ pipeline: 'ci-main' });
  });
  it('fails closed when the project has no directory', () => {
    expect(() => buildDeterministicInput(located({ projectPath: undefined }), control, capture)).toThrow(/Adopt the project directory/);
  });
});
