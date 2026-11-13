import { describe, expect, it } from 'vitest';
import {
  HOLD_BACKGROUND_LIMIT, HOLD_LABEL_LIMIT, boundHoldLabel, evaluateDeterministicHold, sameDeterministicHold,
  type DeterministicHoldInput, type HoldConversation,
} from '../../src/domain/deterministic-hold.js';
import type { DeterministicHold } from '../../src/shared/deterministic.js';

const at = '2026-11-13T10:00:00.000Z';
const capture = { directory: 'task' as const, executionDirectory: '/project' };
const result = { id: 'result', deliveryId: 'delivery', deliveryStatus: 'pending' as const, exit: 'approved', message: 'ok', at };

function input(overrides: Partial<DeterministicHoldInput> = {}): DeterministicHoldInput {
  return {
    task: {
      operation: null, worktree: null, sessionIds: [], closedSessionIds: [], effectiveCwd: '/project',
      stageEntry: { id: 'entry' }, deterministic: { entryId: 'entry', executionId: 'execution', attemptId: 'attempt', phase: 'delivering', capture, result },
    },
    project: { projectPath: '/project' },
    request: { control: { entryId: 'entry', executionId: 'execution', attemptId: 'attempt', phase: 'delivering' }, result: { id: 'result', deliveryId: 'delivery' } },
    reserved: false, pending: [], conversations: [], at,
    ...overrides,
  };
}
function withTask(change: (task: DeterministicHoldInput['task']) => void): DeterministicHoldInput {
  const value = input(); change(value.task); return value;
}
function conversation(idle: boolean, blockers: HoldConversation['blockers']): HoldConversation {
  return { sessionId: 'session', idle, blockers };
}

describe('deterministic delivery hold evaluation', () => {
  it('reports no hold when every guard passes', () => {
    expect(evaluateDeterministicHold(input())).toBeUndefined();
  });

  it('names a stale request instead of inventing a user-facing wait', () => {
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic = undefined; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.entryId = 'other'; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.executionId = 'other'; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.attemptId = 'other'; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.phase = 'result-ready'; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.result = { ...result, id: 'other' }; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.result = { ...result, deliveryId: 'other' }; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.deterministic!.result = { ...result, deliveryStatus: 'accepted' }; }))?.code).toBe('stale-authority');
    expect(evaluateDeterministicHold(withTask(task => { task.stageEntry = { id: 'other' }; }))?.code).toBe('stale-authority');
  });

  it.each([
    ['task-operation', (task: DeterministicHoldInput['task']) => { task.operation = { phase: 'waiting' }; }],
    ['project-operation', (task: DeterministicHoldInput['task']) => { task.operation = null; }],
    ['pending-transition', (task: DeterministicHoldInput['task']) => { task.pendingTransition = { id: 'transition' }; }],
    ['worktree-not-ready', (task: DeterministicHoldInput['task']) => { task.worktree = { status: 'preparing' }; }],
    ['auto-mode-hold', (task: DeterministicHoldInput['task']) => { task.autoMode = { hold: { reason: 'Review' } }; }],
  ] as const)('names %s', (code, change) => {
    const value = code === 'project-operation' ? input({ project: { projectPath: '/project', operation: { phase: 'waiting' } } }) : withTask(change);
    expect(evaluateDeterministicHold(value)?.code).toBe(code);
  });

  it('names a missing project directory and a changed execution directory', () => {
    expect(evaluateDeterministicHold(input({ project: {} }))?.code).toBe('project-directory-missing');
    expect(evaluateDeterministicHold(withTask(task => { task.effectiveCwd = '/elsewhere'; }))?.code).toBe('execution-directory-changed');
    const projectScope = withTask(task => { task.deterministic!.capture = { directory: 'project', executionDirectory: '/project' }; });
    expect(evaluateDeterministicHold(projectScope)).toBeUndefined();
    expect(evaluateDeterministicHold({ ...projectScope, project: { projectPath: '/other' } })?.code).toBe('execution-directory-changed');
  });

  it('names a reserved context admission', () => {
    expect(evaluateDeterministicHold(input({ reserved: true }))?.code).toBe('context-reserved');
  });

  it('names pending user work before any conversation activity', () => {
    const hold = evaluateDeterministicHold(input({ pending: ['approval', 'decision-question'], conversations: [conversation(false, [{ family: 'turn' }])] }));
    expect(hold).toMatchObject({ code: 'pending-user-work', pending: ['approval', 'decision-question'] });
  });

  it('names background work with bounded job and schedule facts', () => {
    const long = 'x'.repeat(HOLD_LABEL_LIMIT + 50);
    const hold = evaluateDeterministicHold(input({ conversations: [conversation(false, [
      { family: 'job', id: 'bash-1', label: long },
      { family: 'job', id: 'bash-2', label: 'second' },
      { family: 'schedule', label: 'nightly' },
      { family: 'job', id: 'bash-4', label: 'dropped' },
    ])] }));
    expect(hold?.code).toBe('background-work');
    expect(hold?.background).toHaveLength(HOLD_BACKGROUND_LIMIT);
    expect(hold?.background?.[0]).toEqual({ kind: 'job', id: 'bash-1', label: boundHoldLabel(long) });
    expect(hold?.background?.[0]?.label).toHaveLength(HOLD_LABEL_LIMIT);
    expect(hold?.background?.[2]).toEqual({ kind: 'schedule', label: 'nightly' });
  });

  it('names an active turn and a pending native question', () => {
    expect(evaluateDeterministicHold(input({ conversations: [conversation(false, [{ family: 'turn' }])] }))?.code).toBe('conversation-active');
    expect(evaluateDeterministicHold(input({ conversations: [conversation(false, [{ family: 'inbox' }])] }))?.code).toBe('conversation-active');
    expect(evaluateDeterministicHold(input({ conversations: [conversation(false, [{ family: 'question' }])] }))).toMatchObject({ code: 'pending-user-work', pending: ['native-question'] });
    expect(evaluateDeterministicHold(input({ conversations: [conversation(false, [{ family: 'approval' }])] }))).toMatchObject({ code: 'pending-user-work', pending: ['approval'] });
  });

  it('ignores idle conversations and prefers the first refused one', () => {
    expect(evaluateDeterministicHold(input({ conversations: [conversation(true, []), conversation(true, [])] }))).toBeUndefined();
    expect(evaluateDeterministicHold(input({ conversations: [conversation(true, []), conversation(false, [{ family: 'job', id: 'j', label: 'find' }])] }))?.code).toBe('background-work');
  });

  it('compares observations without their timestamps', () => {
    const left: DeterministicHold = { code: 'background-work', at, background: [{ kind: 'job', id: 'j', label: 'find' }] };
    expect(sameDeterministicHold(left, { ...left, at: '2026-11-13T11:00:00.000Z' })).toBe(true);
    expect(sameDeterministicHold(left, { ...left, code: 'conversation-active' })).toBe(false);
    expect(sameDeterministicHold(left, { ...left, background: [{ kind: 'job', id: 'j', label: 'find ' }] })).toBe(false);
    expect(sameDeterministicHold(undefined, undefined)).toBe(true);
    expect(sameDeterministicHold(left, undefined)).toBe(false);
  });
});
