import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Board, HubState, HubTask } from '../../src/shared/types.js';
import { registerStageNotice } from '../../src/host/stage-notice.js';
import { registerTaskContextInjection } from '../../src/host/task-context.js';

const now = '2026-10-23T00:00:00Z';
const workflow = {
  name: 'Delivery', initialColumnId: 'plan', groups: [],
  columns: [{ id: 'plan', name: 'Plan', onEnterPrompt: 'Plan it.' }, { id: 'review', name: 'Review', description: 'Owns the review.', onEnterPrompt: 'Review it.' }],
};
const board: Board = { id: 'board', name: 'Board', workflowYaml: '', workflow, createdAt: now, updatedAt: now };
const project = { id: 'project', name: 'Project', projectKey: 'project', projectPath: '/repo', gitRootPath: '/repo' };
const taskIn = (columnId: string, entryId: string): HubTask => ({
  id: 'task-1', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId, position: 0,
  sessionIds: ['session-1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: now, updatedAt: now,
  stageEntry: { id: entryId, columnId, stageIdentity: columnId, enteredAt: now },
});
const hubOf = (task: HubTask): HubState => ({ id: 'hub', name: 'Hub', revision: 1, projects: [project], boards: [board], tasks: [task], notes: [], createdAt: now, updatedAt: now });
const person = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
const kinds = (messages: readonly UserMessage[]) => messages.map(message => message.source.kind);

/** Both injectors registered the way the plugin registers them: first-contact context first, notice after it. */
function setup(readAndMove: (call: number) => { events: readonly unknown[]; moveTo?: HubTask }) {
  const ctx = new Context();
  const state = { task: taskIn('plan', 'e1') };
  const locator = { bySession: (id: string) => id === 'session-1' ? { hubId: 'hub', hub: hubOf(state.task), board, project, task: state.task } as never : undefined };
  let calls = 0;
  const read = vi.fn(async () => {
    const outcome = readAndMove(++calls);
    if (outcome.moveTo !== undefined) state.task = outcome.moveTo;
    return { events: outcome.events };
  });
  registerTaskContextInjection(ctx, locator, { history: { read }, report: vi.fn() });
  registerStageNotice(ctx, locator, { history: { read }, report: vi.fn() });
  const agent = { id: SessionId('session-1') } as Agent;
  const step = async (messages: UserMessage[]) => {
    const result = await ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: new AbortController().signal, messages }, async () => ({ kind: 'enter' as const, messages }));
    if (result.kind !== 'enter') throw new Error('expected enter');
    return result.messages;
  };
  return { state, read, step };
}

describe('first-contact context and stage notice together', () => {
  it('tells a blank conversation about the entry the task holds when a move lands between the two decisions', async () => {
    // The context is composed for e1; the task moves to e2 while the notice reads the history.
    const f = setup(call => call === 1 ? { events: [] } : { events: [], moveTo: taskIn('review', 'e2') });
    const first = await f.step([person('Hello')]);
    expect(kinds(first)).toEqual(['kanban-task', 'stage-notice', 'user']);
    expect(first[0]!.source).toMatchObject({ entryId: 'e1', columnId: 'plan' });
    expect(first[1]!.source).toMatchObject({ entryId: 'e2', columnId: 'review' });
    expect(first[2]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('leaves a conversation alone once the log records both messages', async () => {
    const durable = (kind: string, entryId: string) => ({ type: 'user/message', data: { role: 'user', content: [], source: { kind, entryId } } });
    const f = setup(call => call <= 2 ? (call === 1 ? { events: [] } : { events: [], moveTo: taskIn('review', 'e2') }) : { events: [durable('kanban-task', 'e1'), durable('stage-notice', 'e2')] });
    await f.step([person('Hello')]);
    expect(kinds(await f.step([person('Later')]))).toEqual(['user']);
    expect(kinds(await f.step([person('Again')]))).toEqual(['user']);
  });

  it('gives a conversation in its first entry only the context', async () => {
    const f = setup(() => ({ events: [] }));
    expect(kinds(await f.step([person('Hello')]))).toEqual(['kanban-task', 'user']);
  });
});
