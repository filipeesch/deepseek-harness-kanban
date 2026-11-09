import { describe, expect, it } from 'vitest';
import type { Board, Column, HubState, HubTask, Workflow } from '../../src/shared/types.js';
import { admitStageInstruction, type StageInstructionDeps } from '../../src/host/stage-instruction.js';
import { transitions } from '../support/transition-rules.js';

const now = '2026-01-01T00:00:00.000Z';
const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });

function board(workflow: Workflow): Board {
  return { id: 'board', name: 'Board', workflowYaml: '', workflow, createdAt: now, updatedAt: now };
}

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'review', position: 0,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    instructionPending: { columnId: 'review', enteredAt: 1 }, createdAt: now, updatedAt: now, ...overrides,
  };
}

function fixture(value: HubTask, workflow: Workflow) {
  const target = board(workflow);
  const draft = { tasks: [value] } as unknown as HubState;
  const sent: Array<{ sessionId: string; text: string; requestId?: string }> = [];
  const deps: StageInstructionDeps = {
    locate: () => ({ hubId: 'hub', task: value, board: target }),
    transact: async (_hubId, change) => { change(draft); },
    resolveSession: async () => 's1',
    assertExecutionContext: async () => {},
    send: async (sessionId, text, requestId) => { sent.push({ sessionId, text, ...(requestId === undefined ? {} : { requestId }) }); },
  };
  return { deps, sent };
}

const twoTargets = () => flow(
  column('review', { onEnterPrompt: 'Review it.', allowedTransitions: transitions('done', 'rework') }),
  column('rework'),
  column('done'),
);

describe('stage instruction composition', () => {
  it('appends the transition briefing after the instruction', async () => {
    const f = fixture(task(), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.text.startsWith('Review it.\n\nWorkflow transitions from REVIEW:')).toBe(true);
    expect(f.sent[0]!.text).toContain('set_next_transition');
  });

  it('sends the instruction alone when the stage configures one target', async () => {
    const workflow = flow(column('review', { onEnterPrompt: 'Review it.', allowedTransitions: transitions('done') }), column('done'));
    const f = fixture(task(), workflow);
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.sent[0]!.text).toBe('Review it.');
  });

  it('sends the instruction alone when the stage configures no transitions', async () => {
    const f = fixture(task(), flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.sent[0]!.text).toBe('Review it.');
  });

  it('derives the briefing from the workflow as it is at send time', async () => {
    const workflow = flow(
      column('review', { onEnterPrompt: 'Review it.', allowedTransitions: [{ to: 'done', when: 'Approved.' }, { to: 'rework', when: 'Changes requested.' }] }),
      column('rework'),
      column('done'),
    );
    const value = task();
    const f = fixture(value, workflow);
    const send = f.deps.assertExecutionContext;
    // The workflow changes during the admission of the same send.
    f.deps.assertExecutionContext = async sessionId => {
      await send(sessionId);
      workflow.columns[0]!.allowedTransitions = [{ to: 'done', when: 'Approved without comments.' }, { to: 'rework', when: 'Changes requested.' }];
    };
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.sent[0]!.text).toContain('- DONE — Approved without comments.');
    expect(f.sent[0]!.text).not.toContain('- DONE — Approved.');
  });

  it('names the recorded transition in the briefing', async () => {
    const f = fixture(task({ recordedTransition: { fromColumnId: 'review', columnId: 'done', at: now } }), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.sent[0]!.text).toContain('Recorded transition: DONE.');
  });

  it('keeps the captured instruction as the pending message text', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', requestId: 'request-1' });
    expect(f.sent[0]).toMatchObject({ sessionId: 's1', requestId: 'request-1' });
    expect(value.instructionPending).toBeUndefined();
  });
});
