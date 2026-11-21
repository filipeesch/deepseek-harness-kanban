import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Board, HubSharingView, Task } from '../../src/shared/types.js';
import { projectWorkflowSummary, workflowHeldState, workflowSummaryPage, WORKFLOW_SUMMARY_BUDGET } from '../../src/host/workflow-summary.js';
import { productToolDefinitions } from '../../src/host/tools.js';
import { discoveryTools } from '../../src/host/tools/discovery.js';
import type { BoardAdministration } from '../../src/host/board-administration.js';
import { fixture, taskWithConversation } from './helpers.js';

const board: Board = {
  id: 'b', name: 'Board', workflowYaml: 'SECRET YAML', createdAt: '', updatedAt: '', allowedProjectKeys: [],
  workflow: { name: 'Flow', description: 'Flow description', initialColumnId: 'a', groups: [], columns: [
    { id: 'a', name: 'Agent', description: 'Does work', onEnterPrompt: 'SECRET PROMPT', allowedTransitions: [{ to: 'b', when: 'Ready' }] },
    { id: 'b', name: 'Empty', allowedTransitions: [] },
    { id: 'c', name: 'Free', description: '  ' },
    { id: 'd', name: 'Script', scripted: { language: 'bash', directory: 'task', code: 'SECRET SCRIPT', exits: { done: 'b' } } },
  ] },
};
const hub = { id: 'h', name: 'Hub' };
const task = { id: 't', columnId: 'a', autoMode: { enabled: true, pause: { reason: 'turn-error', at: '' }, hold: { reason: 'waiting', at: '' } } } as Task;
const sharing = { status: 'synced', boards: [{ boardId: 'b', bound: true, state: 'clean' }] } as unknown as HubSharingView;

describe('workflow summary projection', () => {
  it('projects safe policies, task state, project scope and sharing', () => {
    const records = projectWorkflowSummary(board, hub, sharing, task, true);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'task', currentStage: { id: 'a', name: 'Agent' }, autoMode: { enabled: true, paused: true, held: true } }));
    expect(records).toContainEqual(expect.objectContaining({ kind: 'projectScope', mode: 'restricted', projectCount: 0 }));
    expect(records).toContainEqual(expect.objectContaining({ kind: 'sharing', status: 'synced', bound: true }));
    expect(records).toContainEqual(expect.objectContaining({ kind: 'stage', id: 'a', type: 'agent-instruction', routePolicy: 'configured' }));
    expect(records).toContainEqual(expect.objectContaining({ kind: 'stage', id: 'b', routePolicy: 'empty' }));
    expect(records).toContainEqual({ kind: 'stage', id: 'c', name: 'Free', type: 'no-instruction', routePolicy: 'unrestricted' });
    expect(records).toContainEqual(expect.objectContaining({ kind: 'stage', id: 'd', type: 'scripted', routePolicy: 'scripted' }));
    expect(records).toContainEqual({ kind: 'route', from: 'a', to: 'b', condition: 'Ready' });
    expect(records.filter(record => record.current === true)).toEqual([expect.objectContaining({ kind: 'stage', id: 'a', current: true })]);
    expect(records).toContainEqual({ kind: 'scriptExit', from: 'd', exit: 'done', to: 'b' });
    expect(JSON.stringify(records)).not.toMatch(/SECRET|workflowYaml|onEnterPrompt|code/);
    expect(projectWorkflowSummary(board, hub, undefined, { ...task, columnId: 'missing', autoMode: undefined })[0]).toMatchObject({ currentStage: { id: 'missing', status: 'unavailable' }, autoMode: { enabled: false, paused: false, held: 'unavailable' } });
    expect(projectWorkflowSummary(board, hub, undefined)).toContainEqual({ kind: 'sharing', status: 'not-published', bound: false });
    // Without a task of this board no stage is marked, and a task in an unknown stage marks none.
    expect(projectWorkflowSummary(board, hub, sharing).some(record => record.current !== undefined)).toBe(false);
    expect(projectWorkflowSummary(board, hub, undefined, { ...task, columnId: 'missing' }).some(record => record.current !== undefined)).toBe(false);
    expect(projectWorkflowSummary(board, hub, 'unavailable')).toContainEqual({ kind: 'sharing', status: 'unavailable', bound: null });
    expect(projectWorkflowSummary(board, hub, undefined, { ...task, autoMode: { enabled: true, hold: { reason: 'waiting', at: '' } } }, false)[0]).toMatchObject({ autoMode: { enabled: true, paused: true, held: false } });
    expect(projectWorkflowSummary(board, hub, undefined, { ...task, autoMode: { enabled: true } }, true)[0]).toMatchObject({ autoMode: { enabled: true, paused: false, held: true } });
  });

  it('projects a decision gate as its type, question, and option destinations', () => {
    const gated: Board = { ...board, workflow: { ...board.workflow, columns: [
      { id: 'gate', name: 'Gate', decision: { question: 'Proceed?', context: 'SECRET CONTEXT', options: [{ id: 'ship', title: 'Ship it', description: 'SECRET DESC', to: 'done' }, { id: 'fix', title: 'Fix it', to: 'review' }] } },
      { id: 'review', name: 'Review' },
      { id: 'done', name: 'Done' },
    ] } };
    const records = projectWorkflowSummary(gated, hub, undefined);
    expect(records).toContainEqual({ kind: 'stage', id: 'gate', name: 'Gate', type: 'decision', routePolicy: 'decision' });
    expect(records).toContainEqual({ kind: 'decision', stage: 'gate', question: 'Proceed?' });
    expect(records).toContainEqual({ kind: 'decisionOption', stage: 'gate', id: 'ship', title: 'Ship it', to: 'done' });
    expect(records).toContainEqual({ kind: 'decisionOption', stage: 'gate', id: 'fix', title: 'Fix it', to: 'review' });
    const text = JSON.stringify(records);
    expect(text).not.toContain('SECRET CONTEXT');
    expect(text).not.toContain('SECRET DESC');
    expect(records.some(record => record.kind === 'route')).toBe(false);
  });

  it('derives held from all conversations and reports read failures as unavailable', async () => {
    const sessions = { ...task, sessionIds: ['active', 'closed'], closedSessionIds: ['closed'] };
    const facts = vi.fn(async (id: string) => ({ running: false, background: [], settledTurn: null, pending: { kinds: id === 'closed' ? ['approval' as const] : [], queuedPrompts: 0 } }));
    expect(await workflowHeldState(sessions, facts)).toBe(true);
    expect(facts).toHaveBeenCalledTimes(2);
    expect(await workflowHeldState(sessions, async () => ({ running: false, background: [], settledTurn: null, pending: { kinds: [], queuedPrompts: 0 } }))).toBe(false);
    expect(await workflowHeldState(sessions, async () => { throw new Error('unreadable'); })).toBe('unavailable');
    expect(await workflowHeldState(sessions)).toBe('unavailable');
  });
  it('retrieves oversized Unicode records exactly within the pretty-printed page budget', () => {
    const huge = '😀á\n"\\'.repeat(4000);
    const source = projectWorkflowSummary({ ...board, workflow: { ...board.workflow, description: huge, columns: board.workflow.columns.map((column, i) => i === 0 ? { ...column, allowedTransitions: [{ to: 'b', when: huge }] } : column) } }, hub, undefined, task);
    const recovered: unknown[] = []; let fragments = ''; let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = workflowSummaryPage(source, cursor);
      expect(Buffer.byteLength(JSON.stringify(page, null, 2))).toBeLessThanOrEqual(WORKFLOW_SUMMARY_BUDGET);
      for (const record of page.records) {
        if (record.kind === 'oversizedRecordFragment') {
          fragments += record.text as string;
          if (record.complete) { recovered.push(JSON.parse(fragments)); fragments = ''; }
        } else recovered.push(record);
      }
      if (!page.nextCursor) { expect(page.omittedRecords).toBe(0); break; }
      expect(page.omittedRecords).toBeGreaterThan(0); cursor = page.nextCursor;
    }
    expect(fragments).toBe(''); expect(recovered).toEqual(source);
    const first = workflowSummaryPage(source); expect(first.nextCursor).toBeTruthy();
    expect(() => workflowSummaryPage([...source, { kind: 'changed' }], first.nextCursor!)).toThrow(/changed or the cursor is invalid/);
  });
});

describe('workflow summary scope', () => {
  const opened: Array<Awaited<ReturnType<typeof fixture>>> = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  it('uses live pending facts and distinguishes a sharing read error', async () => {
    const f = await fixture(); opened.push(f);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Live', description: '' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.autoMode = { enabled: true, hold: { reason: 'asked', at: '2026-10-23T00:00:00.000Z' } }; });
    const read = vi.spyOn(f.app, 'conversationFacts').mockResolvedValue({ running: false, background: [], settledTurn: null, pending: { kinds: ['queued-prompt'], queuedPrompts: 1 } });
    const sharingView = vi.fn(() => undefined as HubSharingView | undefined);
    const tool = discoveryTools(f.app, { sharingView } as unknown as BoardAdministration).find(value => value.name === 'get_workflow_summary')!;
    const ctx = { signal: new AbortController().signal, agent: { id: task.sessionIds[0]! } } as unknown as ToolRunContext;
    const first = await tool.execute({}, ctx) as { records: Array<Record<string, unknown>> };
    expect(first.records.find(value => value.kind === 'task')).toMatchObject({ autoMode: { enabled: true, paused: true, held: true } });
    expect(first.records.find(value => value.kind === 'sharing')).toMatchObject({ status: 'not-published', bound: false });
    expect(read).toHaveBeenCalledWith(task.sessionIds[0]);
    read.mockResolvedValue({ running: false, background: [], settledTurn: null, pending: { kinds: [], queuedPrompts: 0 } });
    const cleared = await tool.execute({}, ctx) as { records: Array<Record<string, unknown>> };
    expect(cleared.records.find(value => value.kind === 'task')).toMatchObject({ autoMode: { paused: true, held: false } });
    read.mockRejectedValue(new Error('facts offline'));
    sharingView.mockImplementation(() => { throw new Error('sharing offline'); });
    const failed = await tool.execute({}, ctx) as { records: Array<Record<string, unknown>> };
    expect(failed.records.find(value => value.kind === 'task')).toMatchObject({ autoMode: { paused: true, held: 'unavailable' } });
    expect(failed.records.find(value => value.kind === 'sharing')).toMatchObject({ status: 'unavailable', bound: null });
  });
  it('returns task state only on its own board and never declares the old tool', async () => {
    const f = await fixture(); opened.push(f);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Scoped', description: '' });
    const tools = productToolDefinitions(f.app);
    expect(tools.some(value => value.name === 'get_board_summary')).toBe(false);
    const tool = tools.find(value => value.name === 'get_workflow_summary')!;
    const ctx = (id: string) => ({ signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() }) as unknown as ToolRunContext;
    const own = await tool.execute({}, ctx(task.sessionIds[0]!)) as { records: Array<{ kind: string }> };
    expect(own.records.some(record => record.kind === 'task')).toBe(true);
    expect(own.records.filter(record => (record as { current?: boolean }).current === true)).toEqual([expect.objectContaining({ kind: 'stage', id: f.store.requireTask(task.id).columnId })]);
    const ordinary = await tool.execute({ board_id: f.board.id }, ctx('ordinary')) as { records: Array<{ kind: string }> };
    expect(ordinary.records.some(record => record.kind === 'task')).toBe(false);
    expect(ordinary.records.some(record => (record as { current?: boolean }).current !== undefined)).toBe(false);
    const other = await f.store.addBoard('Other');
    const cross = await tool.execute({ board_id: other.id }, ctx(task.sessionIds[0]!)) as { records: Array<{ kind: string }> };
    expect(cross.records.some(record => record.kind === 'task')).toBe(false);
    expect(cross.records.some(record => (record as { current?: boolean }).current !== undefined)).toBe(false);
  });
});
