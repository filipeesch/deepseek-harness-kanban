import { describe, expect, it } from 'vitest';
import type { Board, Column, HubState, HubTask, Workflow } from '../../src/shared/types.js';
import type { StageInstructionDelivery } from '../../src/shared/ports.js';
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
  const delivered: Array<{ sessionId: string; delivery: StageInstructionDelivery }> = [];
  const deps: StageInstructionDeps = {
    locate: () => ({ hubId: 'hub', task: value, board: target }),
    transact: async (_hubId, change) => { change(draft); },
    resolveSession: async () => 's1',
    assertExecutionContext: async () => {},
    deliver: async (sessionId, delivery) => { delivered.push({ sessionId, delivery }); },
  };
  return { deps, delivered };
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
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]!.delivery.text.startsWith('Review it.\n\nWorkflow transitions from REVIEW:')).toBe(true);
    expect(f.delivered[0]!.delivery.text).toContain('set_next_transition');
  });

  it('leaves the task flow record untouched when the instruction is delivered', async () => {
    const history = [{ kind: 'created' as const, at: now, columnId: 'review' }];
    const f = fixture(task({ history }), flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(history).toEqual([{ kind: 'created', at: now, columnId: 'review' }]);
  });

  it('delivers the instruction alone when the stage configures one target', async () => {
    const workflow = flow(column('review', { onEnterPrompt: 'Review it.', allowedTransitions: transitions('done') }), column('done'));
    const f = fixture(task(), workflow);
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.text).toBe('Review it.');
  });

  it('delivers the instruction alone when the stage configures no transitions', async () => {
    const f = fixture(task(), flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.text).toBe('Review it.');
  });

  it('derives the briefing from the workflow as it is at delivery time', async () => {
    const workflow = flow(
      column('review', { onEnterPrompt: 'Review it.', allowedTransitions: [{ to: 'done', when: 'Approved.' }, { to: 'rework', when: 'Changes requested.' }] }),
      column('rework'),
      column('done'),
    );
    const value = task();
    const f = fixture(value, workflow);
    const assertExecutionContext = f.deps.assertExecutionContext;
    // The workflow changes during the admission of the same delivery.
    f.deps.assertExecutionContext = async sessionId => {
      await assertExecutionContext(sessionId);
      workflow.columns[0]!.allowedTransitions = [{ to: 'done', when: 'Approved without comments.' }, { to: 'rework', when: 'Changes requested.' }];
    };
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.text).toContain('- DONE — Approved without comments.');
    expect(f.delivered[0]!.delivery.text).not.toContain('- DONE — Approved.');
  });

  it('names the recorded transition in the briefing', async () => {
    const f = fixture(task({ recordedTransition: { fromColumnId: 'review', columnId: 'done', at: now } }), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.text).toContain('Recorded transition: DONE.');
  });

  it('keeps the captured instruction as the pending delivery text', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', requestId: 'request-1' });
    expect(f.delivered[0]).toMatchObject({ sessionId: 's1', delivery: { requestId: 'request-1' } });
    expect(value.instructionPending).toBeUndefined();
  });

  it('mints a delivery identity when the request carries none', async () => {
    const f = fixture(task(), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('summarizes the stage and the target that applies', async () => {
    const f = fixture(task(), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.summary).toBe('Stage: REVIEW - next: DONE');
  });

  it('summarizes the recorded transition instead of the default target', async () => {
    const f = fixture(task({ recordedTransition: { fromColumnId: 'review', columnId: 'rework', at: now } }), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.summary).toBe('Stage: REVIEW - next: REWORK');
  });

  it('summarizes the stage alone when no target applies', async () => {
    const f = fixture(task(), flow(column('review', { onEnterPrompt: 'Review it.' })));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.summary).toBe('Stage: REVIEW');
  });
});
