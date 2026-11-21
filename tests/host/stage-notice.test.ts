import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Board, Column, HubTask, Workflow } from '../../src/shared/types.js';
import { announcedEntries, announcedEntry, createStageNoticeMessage, registerStageNotice, stageNoticeStatus } from '../../src/host/stage-notice.js';
import { ORIENTATION_OPENING } from '../support/stage-delivery.js';

const now = '2026-10-23T00:00:00Z';
const columns: Column[] = [
  { id: 'plan', name: 'Plan', description: 'Owns the plan.', onEnterPrompt: 'SECRET INSTRUCTION', allowedTransitions: [{ to: 'review', when: 'The plan is agreed.' }, { to: 'park' }] },
  { id: 'review', name: 'Review', description: 'Owns the review.', onEnterPrompt: 'Review it.' },
  { id: 'park', name: 'Park' },
  { id: 'gate', name: 'Gate', decision: { question: 'Go?', options: [{ id: 'go', title: 'Go', to: 'review' }] } },
  { id: 'check', name: 'Check', scripted: { language: 'bash', code: 'SECRET SCRIPT', directory: 'task', exits: { passed: 'review', failed: 'park' } } },
];
const workflow: Workflow = { name: 'Delivery', initialColumnId: 'plan', columns, groups: [] };
const board: Board = { id: 'board', name: 'Board', workflowYaml: '', workflow, createdAt: now, updatedAt: now };
const entry = (id: string, columnId: string) => ({ id, columnId, stageIdentity: columnId, enteredAt: now });
const baseTask = (columnId: string, entryId?: string): HubTask => ({
  id: 'task-1', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId, position: 0,
  sessionIds: ['session-1', 'session-2'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: now, updatedAt: now,
  ...(entryId === undefined ? {} : { stageEntry: entry(entryId, columnId) }),
});
const durable = (kind: string, entryId?: string) => ({ type: 'user/message', data: { role: 'user', content: [], source: { kind, ...(entryId === undefined ? {} : { entryId }) } } });
/** An inbox insertion a steering delivery persists before its message is appended; a cancel can leave only this. */
const inserted = (kind: string, entryId: string) => ({ type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind, entryId } }] } });
const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
const enter = (messages: UserMessage[]) => async () => ({ kind: 'enter' as const, messages });
const instruction = (entryId: string) => createUserMessage({ content: [{ type: 'text', text: 'Review it.' }], source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: Review', requestId: 'r-' + entryId, entryId, columnId: 'review' } });
const textOf = (message: { content: ReadonlyArray<unknown> }) => (message.content[0] as { text: string }).text;

function setup(options: { events?: readonly unknown[]; read?: () => Promise<{ events: readonly unknown[] }>; task?: HubTask } = {}) {
  const ctx = new Context();
  const state = { task: options.task ?? baseTask('review', 'e2'), events: options.events ?? [durable('kanban-task', 'e1')] };
  const read = vi.fn(options.read ?? (async () => ({ events: state.events })));
  const report = vi.fn();
  const locator = { bySession: (id: string) => (id === 'session-1' || id === 'session-2') ? { hubId: 'hub', hub: { name: 'Hub' }, board, project: {}, task: state.task } as never : undefined };
  const dispose = registerStageNotice(ctx, locator, { history: { read }, report });
  const step = (agent: Agent, messages: UserMessage[], signal = new AbortController().signal) =>
    ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal, messages }, enter(messages));
  // One live agent per conversation: the notice keeps its memory per agent object.
  const agents = new Map<string, Agent>();
  const agent = (id = 'session-1'): Agent => {
    let value = agents.get(id);
    if (value === undefined) { value = { id: SessionId(id) } as Agent; agents.set(id, value); }
    return value;
  };
  return { ctx, state, read, report, dispose, step, agent };
}
const entered = async (result: Awaited<ReturnType<ReturnType<typeof setup>['step']>>) => {
  if (result.kind !== 'enter') throw new Error('expected enter');
  return result.messages;
};

describe('stage notice', () => {
  it('announces a manual move before the next input and keeps the input as sent', async () => {
    const f = setup();
    const messages = await entered(await f.step(f.agent(), [user('Hello')]));
    expect(messages).toHaveLength(2);
    const text = textOf(messages[0]!);
    expect(text.startsWith('Stage notice: the task moved to the Review stage. ')).toBe(true);
    expect(text).toContain(ORIENTATION_OPENING);
    expect(text).toContain('Stage: Review (review), agent-instruction');
    expect(messages[0]!.source).toMatchObject({ kind: 'stage-notice', form: 'notice', summary: 'Stage: Review', entryId: 'e2', columnId: 'review' });
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(messages[1]!.source).toEqual({ kind: 'user' });
  });

  it('states that a stage without an entry instruction delivered none', async () => {
    const f = setup({ task: baseTask('park', 'e2') });
    const [notice] = await entered(await f.step(f.agent(), [user('Hello')]));
    expect(textOf(notice!)).toContain('It has no entry instruction, so none was sent.');
  });

  it('states that a decision gate waits for a person and a scripted stage runs a program', async () => {
    const gate = setup({ task: baseTask('gate', 'e2') });
    const [gateNotice] = await entered(await gate.step(gate.agent(), [user('Hello')]));
    expect(textOf(gateNotice!)).toContain('It is a decision gate that waits for a person, so no entry instruction was sent.');
    expect(textOf(gateNotice!)).not.toMatch(/\b(route|declare)\b/i);
    const script = setup({ task: baseTask('check', 'e2') });
    const [scriptNotice] = await entered(await script.step(script.agent(), [user('Hello')]));
    expect(textOf(scriptNotice!)).toContain('It runs a program, so no entry instruction was sent.');
    expect(textOf(scriptNotice!)).not.toContain('SECRET SCRIPT');
  });

  it('states that an entry instruction was not delivered yet, without quoting it', async () => {
    const f = setup({ task: baseTask('plan', 'e2') });
    const [notice] = await entered(await f.step(f.agent(), [user('Hello')]));
    expect(textOf(notice!)).toContain('Its entry instruction has not been sent in this conversation.');
    expect(textOf(notice!)).not.toContain('SECRET INSTRUCTION');
  });

  it('announces an entry once, then announces a later entry as a new one', async () => {
    const f = setup();
    expect(await entered(await f.step(f.agent(), [user('One')]))).toHaveLength(2);
    f.state.events = [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')];
    expect(await entered(await f.step(f.agent(), [user('Two')]))).toHaveLength(1);
    f.state.task = baseTask('review', 'e3');
    const later = await entered(await f.step(f.agent(), [user('Three')]));
    expect(later).toHaveLength(2);
    expect(later[0]!.source).toMatchObject({ entryId: 'e3' });
  });

  it('does not reread the history for a live conversation after it was told', async () => {
    const f = setup();
    await f.step(f.agent(), [user('One')]);
    // The notice has no confirmation yet, so the next step checks the log once.
    f.state.events = [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')];
    await f.step(f.agent(), [user('Two')]);
    expect(f.read).toHaveBeenCalledTimes(2);
    await f.step(f.agent(), [user('Three')]);
    await f.step(f.agent(), [user('Four')]);
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it('tells the conversation again when the notice never reached the log', async () => {
    const f = setup();
    expect(await entered(await f.step(f.agent(), [user('One')]))).toHaveLength(2);
    // The step was aborted after the injection: the log still ends at the first-contact context.
    const again = await entered(await f.step(f.agent(), [user('One again')]));
    expect(again).toHaveLength(2);
    expect(again[0]!.source).toMatchObject({ kind: 'stage-notice', entryId: 'e2' });
  });

  it('does not announce when the input is the stage instruction of the current entry', async () => {
    const f = setup();
    const messages = await entered(await f.step(f.agent(), [instruction('e2')]));
    expect(messages).toHaveLength(1);
    // The instruction reached the log, so the next step has nothing to announce.
    f.state.events = [durable('kanban-task', 'e1'), durable('stage-instruction', 'e2')];
    expect(await entered(await f.step(f.agent(), [user('Later')]))).toHaveLength(1);
  });

  describe('an input that carries an instruction for an earlier entry', () => {
    const kindsOf = (messages: readonly UserMessage[]) => messages.map(message => message.source.kind);
    const setupMoved = () => setup({ events: [durable('kanban-task', 'e1')] });

    it('puts the notice after the older instruction, says it is out of date, and keeps the instruction', async () => {
      const f = setupMoved();
      const old = instruction('e1');
      const messages = await entered(await f.step(f.agent(), [old]));
      expect(kindsOf(messages)).toEqual(['stage-instruction', 'stage-notice']);
      expect(messages[0]).toBe(old);
      expect(textOf(messages[1]!)).toContain('The stage message just before it names an earlier entry and is out of date.');
      expect(messages[1]!.source).toMatchObject({ entryId: 'e2', columnId: 'review' });
    });

    it('keeps the person\'s input after the notice when it follows the older instruction', async () => {
      const f = setupMoved();
      const messages = await entered(await f.step(f.agent(), [instruction('e1'), user('Hello')]));
      expect(kindsOf(messages)).toEqual(['stage-instruction', 'stage-notice', 'user']);
      expect(messages[2]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('puts the notice after the older instruction even when the person\'s input came first', async () => {
      const f = setupMoved();
      const messages = await entered(await f.step(f.agent(), [user('Hello'), instruction('e1')]));
      expect(kindsOf(messages)).toEqual(['user', 'stage-instruction', 'stage-notice']);
    });

    it('adds nothing when the batch also carries the instruction of the current entry', async () => {
      const f = setupMoved();
      const messages = await entered(await f.step(f.agent(), [instruction('e1'), instruction('e2'), user('Hello')]));
      expect(kindsOf(messages)).toEqual(['stage-instruction', 'stage-instruction', 'user']);
    });

    it('corrects an older instruction that would be the last stage statement although the entry was announced', async () => {
      const f = setup({ events: [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')] });
      const messages = await entered(await f.step(f.agent(), [instruction('e1')]));
      expect(kindsOf(messages)).toEqual(['stage-instruction', 'stage-notice']);
      const text = textOf(messages[1]!);
      expect(text.startsWith('Stage notice: the task is in the Review stage. The stage message just before it names an earlier entry and is out of date.')).toBe(true);
      expect(text).not.toContain('moved to');
      expect(text).not.toContain('entry instruction');
      expect(text).toContain(ORIENTATION_OPENING);
      expect(messages[1]!.source).toMatchObject({ kind: 'stage-notice', entryId: 'e2' });
    });

    it('corrects an older instruction that follows the current one in the same batch', async () => {
      const f = setupMoved();
      const messages = await entered(await f.step(f.agent(), [instruction('e2'), instruction('e1'), user('Hello')]));
      expect(kindsOf(messages)).toEqual(['stage-instruction', 'stage-instruction', 'stage-notice', 'user']);
      // Only the last stage message is out of date; the current instruction before it stays valid.
      expect(textOf(messages[2]!).startsWith('Stage notice: the task is in the Review stage. The stage message just before it names an earlier entry and is out of date.')).toBe(true);
      expect(textOf(messages[2]!)).not.toContain('messages just before');
    });

    it('confirms the correction against the log once, and then leaves the conversation alone', async () => {
      const f = setup({ events: [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')] });
      await f.step(f.agent(), [instruction('e1')]);
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(kindsOf(await entered(await f.step(f.agent(), [user('Later')])))).toEqual(['user']);
      expect(f.read).toHaveBeenCalledTimes(2);
      await f.step(f.agent(), [user('Again')]);
      expect(f.read).toHaveBeenCalledTimes(2);
    });

    it('does not say anything is out of date when no stage message precedes the notice', async () => {
      const f = setupMoved();
      const [notice] = await entered(await f.step(f.agent(), [user('Hello')]));
      expect(textOf(notice!)).not.toContain('out of date');
    });
  });

  it('confirms a batch that names an older entry even when the current entry is already known', async () => {
    const f = setup({ events: [durable('kanban-task', 'e1'), durable('stage-instruction', 'e2')] });
    // The log records the current entry, so the notice is only a correction placed after the older instruction.
    const corrected = await entered(await f.step(f.agent(), [instruction('e1'), user('Hello')]));
    expect(corrected.map(message => message.source.kind)).toEqual(['stage-instruction', 'stage-notice', 'user']);
    expect(f.read).toHaveBeenCalledTimes(1);
    // That batch is tentative until the log shows it, so the next decision reads once more.
    expect(await entered(await f.step(f.agent(), [user('Later')]))).toHaveLength(1);
    expect(f.read).toHaveBeenCalledTimes(2);
    await f.step(f.agent(), [user('Again')]);
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it('announces the entry again when the instruction a step carried never reached the log', async () => {
    const f = setup();
    expect(await entered(await f.step(f.agent(), [instruction('e2')]))).toHaveLength(1);
    // The step was aborted after the decision and before its messages were appended.
    const again = await entered(await f.step(f.agent(), [user('Hello again')]));
    expect(again).toHaveLength(2);
    expect(again[0]!.source).toMatchObject({ kind: 'stage-notice', entryId: 'e2' });
  });

  it('lets an older instruction beside the current one change nothing', async () => {
    const f = setup({ events: [durable('kanban-task', 'e1'), durable('stage-instruction', 'e2')] });
    // The log already records the current entry, and the current one is the last stage message.
    expect(await entered(await f.step(f.agent(), [instruction('e1'), instruction('e2')]))).toHaveLength(2);
    expect(await entered(await f.step(f.agent(), [user('Later')]))).toHaveLength(1);
    const fresh = setup();
    expect(await entered(await fresh.step(fresh.agent(), [instruction('e1'), instruction('e2')]))).toHaveLength(2);
    fresh.state.events = [durable('kanban-task', 'e1'), durable('stage-instruction', 'e2'), durable('stage-instruction', 'e1')];
    // Both are recorded now, in either order: the conversation was told about the current entry.
    expect(await entered(await fresh.step(fresh.agent(), [user('Later')]))).toHaveLength(1);
  });

  it('announces the entry the task holds after a slow history read, not the one it held before', async () => {
    const f = setup({ read: async () => { f.state.task = baseTask('park', 'e3'); return { events: [durable('kanban-task', 'e1')] }; } });
    const [notice] = await entered(await f.step(f.agent(), [user('Hello')]));
    expect(notice!.source).toMatchObject({ kind: 'stage-notice', entryId: 'e3', columnId: 'park' });
    expect(textOf(notice!)).toContain('moved to the Park stage');
  });

  it('announces the entry again when its instruction was admitted but a cancel kept it out of the conversation', async () => {
    // The log holds the first-contact context and only the inbox insertion of the instruction for the current entry.
    const f = setup({ events: [durable('kanban-task', 'e1'), inserted('stage-instruction', 'e2')] });
    const messages = await entered(await f.step(f.agent(), [user('Hello')]));
    expect(messages).toHaveLength(2);
    expect(messages[0]!.source).toMatchObject({ kind: 'stage-notice', entryId: 'e2' });
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('treats an instruction that was appended as told even when its insertion is also in the log', async () => {
    const f = setup({ events: [durable('kanban-task', 'e1'), inserted('stage-instruction', 'e2'), durable('stage-instruction', 'e2')] });
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
  });

  it('announces the current entry when the first-contact context a blank conversation carried names an older one', async () => {
    // The task moved while the context was composed: the context names e1, the task now holds e2.
    const f = setup({ events: [] });
    const stale = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'kanban-task', entryId: 'e1', columnId: 'plan' } });
    const messages = await entered(await f.step(f.agent(), [stale, user('Hello')]));
    // The notice follows the older context, so the last stage statement the conversation reads is the current one.
    expect(messages.map(message => message.source.kind)).toEqual(['kanban-task', 'stage-notice', 'user']);
    expect(messages[1]!.source).toMatchObject({ entryId: 'e2', columnId: 'review' });
    // The log shows both, so nothing more is announced.
    f.state.events = [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')];
    expect(await entered(await f.step(f.agent(), [user('Later')]))).toHaveLength(1);
  });

  it('confirms a stale first-contact context against the log before deciding again', async () => {
    const f = setup({ events: [] });
    const stale = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'kanban-task', entryId: 'e1', columnId: 'plan' } });
    await f.step(f.agent(), [stale]);
    expect(f.read).toHaveBeenCalledTimes(1);
    // The step was aborted after the injections: the log still records nothing, so the context returns and is told again.
    const again = await entered(await f.step(f.agent(), [stale]));
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(again.map(message => message.source.kind)).toEqual(['kanban-task', 'stage-notice']);
  });

  it('announces nothing when the task lost its stage entry during the read', async () => {
    const f = setup({ read: async () => { f.state.task = baseTask('review'); return { events: [durable('kanban-task', 'e1')] }; } });
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
  });

  it('does not announce when the first-contact context of the current entry rides in the same step', async () => {
    const f = setup({ events: [] });
    const context = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'kanban-task', entryId: 'e2', columnId: 'review' } });
    expect(await entered(await f.step(f.agent(), [context, user('Hello')]))).toHaveLength(2);
    f.state.events = [durable('kanban-task', 'e2')];
    expect(await entered(await f.step(f.agent(), [user('Again')]))).toHaveLength(1);
  });

  it('does not backfill a conversation whose history records no stage entry', async () => {
    const f = setup({ events: [durable('kanban-task'), durable('stage-instruction')] });
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
    expect(await entered(await f.step(f.agent(), [user('Again')]))).toHaveLength(1);
  });

  it('does not announce for a task that has no stage entry', async () => {
    const f = setup({ task: baseTask('review') });
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
  });

  it('tells each conversation of the task on its own', async () => {
    const f = setup();
    const first = await entered(await f.step(f.agent('session-1'), [user('Hello')]));
    const second = await entered(await f.step(f.agent('session-2'), [user('Hello')]));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it('ignores an agent that belongs to no task without reading its history', async () => {
    const f = setup();
    expect(await entered(await f.step(f.agent('other-session'), [user('Hello')]))).toHaveLength(1);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('leaves an empty or aborted step alone', async () => {
    const f = setup();
    expect(await entered(await f.step(f.agent(), []))).toHaveLength(0);
    const controller = new AbortController(); controller.abort();
    expect(await entered(await f.step(f.agent(), [user('Hello')], controller.signal))).toHaveLength(1);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('reports a failed history read, injects nothing, and retries on the next step', async () => {
    let fail = true;
    const f = setup({ read: async () => { if (fail) throw new Error('history unavailable'); return { events: [durable('kanban-task', 'e1')] }; } });
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
    expect(f.report).toHaveBeenCalledOnce();
    fail = false;
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(2);
  });

  it('decides afresh for an agent a clear recreated', async () => {
    const f = setup();
    await f.step(f.agent(), [user('One')]);
    f.state.events = [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')];
    await f.step(f.agent(), [user('Two')]);
    f.state.task = baseTask('review', 'e3');
    await f.ctx.serial('agent/created', { agent: f.agent(), source: 'clear' });
    f.state.events = [durable('kanban-task', 'e3')];
    expect(await entered(await f.step(f.agent(), [user('Three')]))).toHaveLength(1);
  });

  it('stops announcing once it is disposed', async () => {
    const f = setup(); f.dispose();
    expect(await entered(await f.step(f.agent(), [user('Hello')]))).toHaveLength(1);
  });
});

describe('stage notice helpers', () => {
  it('reads the entry a message says its conversation was told about', () => {
    expect(announcedEntry({ source: { kind: 'kanban-task', entryId: 'e1' } })).toBe('e1');
    expect(announcedEntry({ source: { kind: 'stage-instruction', entryId: 'e2' } })).toBe('e2');
    expect(announcedEntry({ source: { kind: 'stage-notice', entryId: 'e3' } })).toBe('e3');
    expect(announcedEntry({ source: { kind: 'user', entryId: 'e4' } })).toBeUndefined();
    expect(announcedEntry({ source: { kind: 'stage-notice', entryId: '' } })).toBeUndefined();
    expect(announcedEntry({ source: { kind: 'stage-notice' } })).toBeUndefined();
    expect(announcedEntry(null)).toBeUndefined();
    expect(announcedEntry({})).toBeUndefined();
  });

  it('collects every entry the appended messages record, in any order, and not an inbox insertion', () => {
    expect([...announcedEntries([])]).toEqual([]);
    expect([...announcedEntries([durable('kanban-task', 'e1'), durable('user'), durable('stage-instruction', 'e2')])].sort()).toEqual(['e1', 'e2']);
    expect([...announcedEntries([durable('kanban-task', 'e1'), inserted('stage-notice', 'e5')])]).toEqual(['e1']);
    expect([...announcedEntries([durable('kanban-task', 'e1'), durable('user', 'ignored')])]).toEqual(['e1']);
    expect([...announcedEntries([durable('stage-instruction', 'e2'), durable('stage-instruction', 'e1')])].sort()).toEqual(['e1', 'e2']);
  });

  it('derives why no instruction accompanied the change from the stage itself', () => {
    expect(stageNoticeStatus({})).toBe('no-instruction');
    expect(stageNoticeStatus({ onEnterPrompt: ' ' })).toBe('no-instruction');
    expect(stageNoticeStatus({ onEnterPrompt: 'Do it.' })).toBe('undelivered');
    expect(stageNoticeStatus(columns[3]!)).toBe('decision');
    expect(stageNoticeStatus(columns[4]!)).toBe('scripted');
  });

  it('builds no notice for a stage the workflow no longer holds', () => {
    expect(createStageNoticeMessage(workflow, 'gone', 'e1')).toBeUndefined();
    expect(createStageNoticeMessage(workflow, 'park', 'e1')?.role).toBe('user');
  });
});
