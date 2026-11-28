import { describe, expect, it, vi } from 'vitest';
import type { Board, Column, HubState, HubTask, Workflow } from '../../src/shared/types.js';
import type { StageInstructionDelivery } from '../../src/shared/ports.js';
import { admitStageInstruction, type StageInstructionDeps } from '../../src/host/stage-instruction.js';
import { transitions } from '../support/transition-rules.js';
import { afterOrientation } from '../support/stage-delivery.js';

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
    expect(afterOrientation(f.delivered[0]!.delivery.text).startsWith('Review it.\n\nWorkflow transitions from REVIEW')).toBe(true);
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
    expect(afterOrientation(f.delivered[0]!.delivery.text)).toBe('Review it.');
  });

  it('delivers the instruction alone when the stage configures no transitions', async () => {
    const f = fixture(task(), flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(afterOrientation(f.delivered[0]!.delivery.text)).toBe('Review it.');
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
    expect(f.delivered[0]!.delivery.text).toContain('Condition: Approved without comments.');
    expect(f.delivered[0]!.delivery.text).not.toContain('Condition: Approved.');
  });

  it('names the recorded transition in the briefing', async () => {
    const f = fixture(task({ recordedTransition: { fromColumnId: 'review', columnId: 'done', at: now } }), twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.text).toContain('Recorded transition: DONE.');
  });

  it('delivers the declared reason between the instruction and the briefing', async () => {
    const value = task({ columnId: 'rework', instructionPending: { columnId: 'rework', enteredAt: 1 } });
    const f = fixture(value, flow(
      column('review', { onEnterPrompt: 'Review it.' }),
      column('rework', { onEnterPrompt: 'Rework it.', allowedTransitions: [{ to: 'done', when: 'Approved.' }, { to: 'review', when: 'Still wrong.' }] }),
      column('done'),
    ));
    await admitStageInstruction(f.deps, {
      taskId: 'task', columnId: 'rework', instruction: 'Rework it.', reviewedInstruction: 'Rework it.',
      transition: { fromColumnId: 'review', reason: 'Changes are needed.' },
    });
    const text = f.delivered[0]!.delivery.text;
    expect(afterOrientation(text).startsWith('Rework it.\n\nTransition reason (from REVIEW):\nChanges are needed.')).toBe(true);
    expect(text).toContain('Workflow transitions from REWORK');
    expect(text.indexOf('Transition reason')).toBeLessThan(text.indexOf('Workflow transitions from REWORK'));
  });

  it('delivers no reason block without a declared transition', async () => {
    const value = task({ columnId: 'rework', instructionPending: { columnId: 'rework', enteredAt: 1 } });
    const f = fixture(value, flow(column('review'), column('rework', { onEnterPrompt: 'Rework it.' })));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'rework', instruction: 'Rework it.', reviewedInstruction: 'Rework it.' });
    expect(afterOrientation(f.delivered[0]!.delivery.text)).toBe('Rework it.');
  });

  it('names the source stage as the workflow carries it at delivery time', async () => {
    const workflow = flow(column('review', { onEnterPrompt: 'Review it.' }), column('rework', { onEnterPrompt: 'Rework it.' }));
    const value = task({ columnId: 'rework', instructionPending: { columnId: 'rework', enteredAt: 1 } });
    const f = fixture(value, workflow);
    const assertExecutionContext = f.deps.assertExecutionContext;
    f.deps.assertExecutionContext = async sessionId => {
      await assertExecutionContext(sessionId);
      workflow.columns[0]!.name = 'CODE REVIEW';
    };
    await admitStageInstruction(f.deps, {
      taskId: 'task', columnId: 'rework', instruction: 'Rework it.', reviewedInstruction: 'Rework it.',
      transition: { fromColumnId: 'review', reason: 'Changes are needed.' },
    });
    expect(f.delivered[0]!.delivery.text).toContain('Transition reason (from CODE REVIEW):');
  });

  it('keeps the entry unresolved while its held handoffs await the first step', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    const retainsEntry = vi.fn(() => true);
    f.deps.retainsEntry = retainsEntry;
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(retainsEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'task' }), 'review', 's1');
    expect(value.instructionPending).toEqual({ columnId: 'review', enteredAt: 1 });
  });

  it('resolves the entry when it holds no handoff for the instruction conversation', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    f.deps.retainsEntry = () => false;
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(value.instructionPending).toBeUndefined();
  });

  it('derives the request identity from the entry so a retry deduplicates', async () => {
    const value = task({ stageEntry: { id: 'entry-1', columnId: 'review', stageIdentity: 'review', enteredAt: now } });
    const f = fixture(value, twoTargets());
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered.map(entry => entry.delivery.requestId)).toEqual(['stage-instruction:task:entry-1', 'stage-instruction:task:entry-1']);
  });

  it('fails the admission before the wake when preparation fails', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    const prepareHeld = vi.fn(async () => { throw new Error('Session history is unreadable.'); });
    f.deps.prepareHeld = prepareHeld;
    await expect(admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' }))
      .rejects.toThrow('Session history is unreadable.');
    expect(prepareHeld).toHaveBeenCalledWith('task', 'review', 's1', expect.any(String));
    expect(f.delivered).toEqual([]);
    expect(value.instructionPending).toEqual({ columnId: 'review', enteredAt: 1 });
  });

  it('forgets the preparation when the native delivery fails', async () => {
    const f = fixture(task(), twoTargets());
    const abandonHeld = vi.fn();
    const deliver = vi.fn(async () => { throw new Error('Native admission failed'); });
    f.deps.prepareHeld = async () => 'deliver';
    f.deps.abandonHeld = abandonHeld;
    f.deps.deliver = deliver;
    await expect(admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' }))
      .rejects.toThrow('Native admission failed');
    expect(abandonHeld).toHaveBeenCalledWith('task', 'review', 's1');
  });

  it('skips the send when the conversation already records the instruction', async () => {
    const value = task();
    const f = fixture(value, twoTargets());
    const prepareHeld = vi.fn(async () => 'accepted' as const);
    const releaseHeld = vi.fn(async () => {});
    f.deps.prepareHeld = prepareHeld;
    f.deps.releaseHeld = releaseHeld;
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered).toEqual([]);
    // No new first step exists, so everything left is released separately.
    expect(releaseHeld).toHaveBeenCalledWith('task', 'review');
    expect(value.instructionPending).toBeUndefined();
  });

  it('keeps a recovery entry actionable while a handoff is still held', async () => {
    const value = task({ heldMessages: [{ id: 'held:main:1', fromSessionId: 's0', columnId: 'review', body: 'Result.', at: now }] });
    const f = fixture(value, twoTargets());
    f.deps.prepareHeld = async () => 'accepted';
    f.deps.releaseHeld = async () => {};
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(value.instructionPending).toEqual({ columnId: 'review', enteredAt: 1 });
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

  it('records the stage entry it follows on the delivery', async () => {
    const value = task({ stageEntry: { id: 'entry-9', columnId: 'review', stageIdentity: 'review', enteredAt: now } });
    const f = fixture(value, flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery).toMatchObject({ entryId: 'entry-9', columnId: 'review' });
  });

  it('records no entry for a task that has none', async () => {
    const f = fixture(task(), flow(column('review', { onEnterPrompt: 'Review it.' }), column('done')));
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.' });
    expect(f.delivered[0]!.delivery.entryId).toBeUndefined();
    expect(f.delivered[0]!.delivery.columnId).toBeUndefined();
  });

  it('composes again from the live workflow after the final check, keeping the delivery identity', async () => {
    const workflow = flow(
      column('review', { description: 'Owns the first review.', onEnterPrompt: 'Review it.', allowedTransitions: [{ to: 'done', when: 'Approved.' }, { to: 'rework', when: 'Changes requested.' }] }),
      column('rework'),
      column('done'),
    );
    const f = fixture(task({ stageEntry: { id: 'entry-1', columnId: 'review', stageIdentity: 'review', enteredAt: now } }), workflow);
    await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', reviewedInstruction: 'Review it.', requestId: 'fixed-identity' });
    const first = f.delivered[0]!.delivery;
    expect(first.text).toContain('Owns the first review.');
    // An edit lands between the final authority check and the enqueue, and keeps the entry.
    workflow.columns[0]!.description = 'Owns the second review.';
    workflow.columns[0]!.allowedTransitions = [{ to: 'done', when: 'Approved without comments.' }, { to: 'rework', when: 'Changes requested.' }];
    const refreshed = first.refresh!();
    expect(refreshed.text).toContain('Owns the second review.');
    expect(refreshed.text).toContain('Condition: Approved without comments.');
    expect(refreshed.text).not.toContain('Owns the first review.');
    expect(refreshed).toMatchObject({ requestId: 'fixed-identity', entryId: 'entry-1', columnId: 'review' });
  });
});
