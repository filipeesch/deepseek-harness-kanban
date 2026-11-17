import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';
import type { PendingTransition } from '../../src/shared/types.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });

const DECISION_WORKFLOW = [
  'name: Gated Flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: gate',
  '    label: Gate',
  '    decision:',
  '      question: How should this proceed?',
  '      context: The review left findings.',
  '      options:',
  '        - id: ship',
  '          title: Ship it',
  '          to: done',
  '        - id: fix',
  '          title: Fix it',
  '          description: Return to review with the findings addressed.',
  '          to: review',
  '  - id: review',
  '    label: Review',
  '    on_enter_prompt: Review carefully.',
  '    allowed_transitions: []',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

type F = Awaited<ReturnType<typeof fixture>>;

function stageIdentity(f: F, columnId: string): string {
  const board = f.app.hubs.requireHub(f.hub.id).boards[0]!;
  return board.localStageIdentities?.[columnId] ?? board.workflow.columns.find(column => column.id === columnId)?.key ?? columnId;
}

async function gated() {
  const f = await fixture();
  active.push(f);
  await f.store.setWorkflow(DECISION_WORKFLOW);
  const task = await f.app.createTask({ projectId: f.project.id, title: 'Gated task', description: '' });
  await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
  await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'gate' });
  const stored = f.store.requireTask(task.id);
  return { f, taskId: task.id, entryId: stored.stageEntry!.id };
}

function choose(f: F, taskId: string, entryId: string, optionId: string, destinationColumnId: string, extra: { note?: string; destinationIdentity?: string; entryOverride?: string } = {}) {
  return f.app.command({
    type: 'task.decide', taskId, entryId: extra.entryOverride ?? entryId, optionId,
    destinationIdentity: extra.destinationIdentity ?? stageIdentity(f, destinationColumnId),
    ...(extra.note === undefined ? {} : { note: extra.note }),
  });
}

function pendingDecision(taskId: string, destinationIdentity: string, columnId = 'review', optionId = 'fix'): PendingTransition {
  return { id: 'pending-decision', fromColumnId: 'gate', columnId, mode: 'move', status: 'waiting', transitionOverride: true, decision: { optionId, destinationIdentity } };
}

describe('decision routing', () => {
  it('applies the chosen option, records it, and dispatches the destination reason', async () => {
    const { f, taskId, entryId } = await gated();
    await choose(f, taskId, entryId, 'fix', 'review', { note: '  Please fix the copy.  ' });
    const task = f.store.requireTask(taskId);
    expect(task.columnId).toBe('review');
    expect(task.pendingTransition).toBeUndefined();
    expect(task.history?.at(-1)).toMatchObject({ kind: 'stage', fromColumnId: 'gate', columnId: 'review', origin: 'decision:fix', decision: { optionId: 'fix', note: 'Please fix the copy.' } });
    const sent = f.sessions.sent.filter(message => message.kind === 'stage-instruction');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Review carefully.');
    expect(sent[0]!.text).toContain('Transition reason (from Gate):');
    expect(sent[0]!.text).toContain('Decision: Fix it');
    expect(sent[0]!.text).toContain('Observation: Please fix the copy.');
    expect(sent[0]!.text).toContain('Return to review with the findings addressed.');
  });

  it('refuses a stale entry, keeps the gate, and records nothing', async () => {
    const { f, taskId, entryId } = await gated();
    const history = f.store.requireTask(taskId).history?.length;
    await expect(f.app.command({ type: 'task.decide', taskId, entryId: 'replaced-entry', optionId: 'fix', destinationIdentity: stageIdentity(f, 'review') })).rejects.toMatchObject({ code: 'STALE_DECISION' });
    expect(f.store.requireTask(taskId).columnId).toBe('gate');
    expect(f.store.requireTask(taskId).history?.length).toBe(history);
    expect(f.sessions.sent).toEqual([]);
    await choose(f, taskId, entryId, 'fix', 'review');
    expect(f.store.requireTask(taskId).columnId).toBe('review');
  });

  it('refuses an option the stage no longer authors', async () => {
    const { f, taskId, entryId } = await gated();
    await f.store.setWorkflow(DECISION_WORKFLOW.replace('        - id: fix\n          title: Fix it\n          description: Return to review with the findings addressed.\n          to: review\n', ''));
    const history = f.store.requireTask(taskId).history?.length;
    await expect(choose(f, taskId, entryId, 'fix', 'review')).rejects.toMatchObject({ code: 'DECISION_OPTION_GONE' });
    expect(f.store.requireTask(taskId).columnId).toBe('gate');
    expect(f.store.requireTask(taskId).history?.length).toBe(history);
    expect(f.sessions.sent).toEqual([]);
  });

  it('refuses a destination whose stable identity changed after the person saw it', async () => {
    const { f, taskId, entryId } = await gated();
    const history = f.store.requireTask(taskId).history?.length;
    await expect(choose(f, taskId, entryId, 'fix', 'review', { destinationIdentity: 'replacement-target' })).rejects.toMatchObject({ code: 'STALE_DECISION' });
    expect(f.store.requireTask(taskId).columnId).toBe('gate');
    expect(f.store.requireTask(taskId).history?.length).toBe(history);
    expect(f.sessions.sent).toEqual([]);
  });

  it('refuses an option retargeted after the person saw the destination', async () => {
    const { f, taskId, entryId } = await gated();
    const displayed = stageIdentity(f, 'review');
    await f.store.setWorkflow(DECISION_WORKFLOW.replace('          to: review', '          to: done'));
    await expect(choose(f, taskId, entryId, 'fix', 'review', { destinationIdentity: displayed })).rejects.toMatchObject({ code: 'STALE_DECISION' });
    expect(f.store.requireTask(taskId).columnId).toBe('gate');
  });

  it('refuses a busy task', async () => {
    const { f, taskId, entryId } = await gated();
    await f.store.transact(draft => { draft.tasks.find(task => task.id === taskId)!.pendingTransition = { id: 'waiting-move', fromColumnId: 'gate', columnId: 'review', mode: 'move', status: 'waiting' }; });
    await expect(choose(f, taskId, entryId, 'fix', 'review')).rejects.toMatchObject({ code: 'TASK_BUSY' });
  });

  it('replaces a failed decision route with the next confirmation', async () => {
    const { f, taskId, entryId } = await gated();
    await f.store.transact(draft => {
      const task = draft.tasks.find(value => value.id === taskId)!;
      task.pendingTransition = { ...pendingDecision(taskId, 'stale-target'), status: 'failed', error: { code: 'STALE_DECISION', message: 'The destination changed.' } };
    });
    await choose(f, taskId, entryId, 'fix', 'review');
    expect(f.store.requireTask(taskId).columnId).toBe('review');
    expect(f.store.requireTask(taskId).pendingTransition).toBeUndefined();
  });

  it('fails a pending decision whose destination identity no longer matches', async () => {
    const { f, taskId } = await gated();
    await f.store.transact(draft => { draft.tasks.find(value => value.id === taskId)!.pendingTransition = pendingDecision(taskId, 'stale-target'); });
    await f.app.command({ type: 'task.edit', taskId, title: 'Gated task' });
    const task = f.store.requireTask(taskId);
    expect(task.columnId).toBe('gate');
    expect(task.pendingTransition).toMatchObject({ status: 'failed', decision: { optionId: 'fix' } });
    expect(task.history?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
  });


  it('refuses an option retargeted between persistence and first placement', async () => {
    const { f, taskId } = await gated();
    await f.store.setWorkflow(DECISION_WORKFLOW.replace('          to: review', '          to: done'));
    const retargeted = f.hubs.requireHub(f.hub.id).boards[0]!.workflow.columns.find(column => column.id === 'gate')!.decision!.options.find(option => option.id === 'fix')!;
    expect(retargeted.to).toBe('done');
    await f.store.transact(draft => { draft.tasks.find(task => task.id === taskId)!.pendingTransition = pendingDecision(taskId, stageIdentity(f, 'review')); });
    await f.app.command({ type: 'task.edit', taskId, title: 'Gated task' });
    const task = f.store.requireTask(taskId);
    expect(task.columnId).toBe('gate');
    expect(task.pendingTransition).toMatchObject({ status: 'failed', decision: { optionId: 'fix' } });
    expect(task.history?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
    expect(f.sessions.sent).toEqual([]);
  });

  it('refuses an option removed between persistence and first placement', async () => {
    const { f, taskId } = await gated();
    await f.store.setWorkflow(DECISION_WORKFLOW.replace('        - id: fix\n          title: Fix it\n          description: Return to review with the findings addressed.\n          to: review\n', ''));
    expect(f.hubs.requireHub(f.hub.id).boards[0]!.workflow.columns.find(column => column.id === 'gate')!.decision!.options.some(option => option.id === 'fix')).toBe(false);
    await f.store.transact(draft => { draft.tasks.find(task => task.id === taskId)!.pendingTransition = pendingDecision(taskId, stageIdentity(f, 'review')); });
    await f.app.command({ type: 'task.edit', taskId, title: 'Gated task' });
    const task = f.store.requireTask(taskId);
    expect(task.columnId).toBe('gate');
    expect(task.pendingTransition).toMatchObject({ status: 'failed', decision: { optionId: 'fix' } });
    expect(task.history?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
    expect(f.sessions.sent).toEqual([]);
  });

  it('routes to a scripted destination and admits its entry', async () => {
    const f = await fixture();
    active.push(f);
    const workflow = [
      'name: Scripted Gate',
      'initial_column: gate',
      'columns:',
      '  - id: gate',
      '    label: Gate',
      '    decision:',
      '      question: Proceed?',
      '      options:',
      '        - id: run',
      '          title: Run it',
      '          to: scripted',
      '  - id: scripted',
      '    label: Scripted',
      '    scripted:',
      '      language: bash',
      '      code: echo ok',
      '      exits:',
      '        ok: done',
      '  - id: done',
      '    label: Done',
      '',
    ].join('\n');
    await f.store.setWorkflow(workflow);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Scripted gate', description: '' });
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const entryId = f.store.requireTask(task.id).stageEntry!.id;
    await choose(f, task.id, entryId, 'run', 'scripted');
    const stored = f.store.requireTask(task.id);
    expect(stored.columnId).toBe('scripted');
    expect(stored.scripted?.entryId).toBe(stored.stageEntry?.id);
    expect(f.sessions.sent.filter(message => message.kind === 'stage-instruction')).toEqual([]);
  });

  it('does not duplicate the route when the same choice is submitted again', async () => {
    const { f, taskId, entryId } = await gated();
    await choose(f, taskId, entryId, 'fix', 'review');
    const stageEntries = () => f.store.requireTask(taskId).history?.filter(entry => entry.kind === 'stage') ?? [];
    const before = stageEntries().length;
    await expect(choose(f, taskId, entryId, 'fix', 'review')).rejects.toMatchObject({ code: 'DECISION_NOT_AVAILABLE' });
    expect(stageEntries().length).toBe(before);
    expect(f.sessions.sent.filter(message => message.kind === 'stage-instruction')).toHaveLength(1);
  });

  it('moves to a silent destination without creating a conversation', async () => {
    const { f, taskId, entryId } = await gated();
    await choose(f, taskId, entryId, 'ship', 'done');
    const task = f.store.requireTask(taskId);
    expect(task.columnId).toBe('done');
    expect(task.sessionIds).toEqual([]);
    expect(f.sessions.sent).toEqual([]);
  });
});