import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import { UNREADABLE_SESSION_CODE } from '../../src/domain/session-observation.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { vi.useRealTimers(); for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }
const corrupt = () => Object.assign(new Error('stored session failed validation: PTC dispatch repeats subCallId'), { code: UNREADABLE_SESSION_CODE });
const turnEnd = (seq: number) => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind: 'ok' } } });

async function flow(f: Awaited<ReturnType<typeof setup>>, instruction?: string): Promise<string> {
  const columns = [{ id: 'backlog', label: 'Backlog' }, { id: 'plan', label: 'Plan', ...(instruction === undefined ? {} : { on_enter_prompt: instruction }) }];
  await f.store.setWorkflow(stringify({ name: 'Flow', initial_column: 'backlog', columns }));
  return f.store.snapshot().workflow.columns[1]!.id;
}

describe('writes into an unobservable conversation', () => {
  it('refuses the card run action with the diagnosis instead of writing', async () => {
    const f = await setup();
    const columnId = await flow(f, 'Plan this task.');
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Corrupt card', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    await f.app.sessionInspect(sessionId);
    await f.app.command({ type: 'task.move', taskId: t.id, columnId });
    const marker = f.store.requireTask(t.id).instructionPending!;
    await expect(f.app.command({ type: 'task.runInstruction', taskId: t.id, columnId, expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan this task.' }))
      .rejects.toMatchObject({ code: 'SESSION_UNOBSERVABLE' });
    expect(f.sessions.sent).toEqual([]);
    // The unresolved entry keeps the action available for another attempt.
    expect(f.store.requireTask(t.id).instructionPending).toBeDefined();
  });

  it('sends normally once the conversation is observed again', async () => {
    const f = await setup();
    const columnId = await flow(f, 'Plan this task.');
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Recovered card', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    await f.app.sessionInspect(sessionId);
    f.sessions.facts = async () => ({ running: false, background: [], pending: { kinds: [], queuedPrompts: 0 }, settledTurn: null });
    await f.app.sessionInspect(sessionId);
    await f.app.command({ type: 'task.move', taskId: t.id, columnId });
    const marker = f.store.requireTask(t.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: t.id, columnId, expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan this task.' });
    expect(f.sessions.sent).toHaveLength(1);
    expect(f.sessions.sent[0]!.id).toBe(sessionId);
  });

  it('does not automatically advance a task whose conversation cannot be read', async () => {
    const f = await setup();
    const columnId = await flow(f);
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Auto corrupt', description: '' });
    const sessionId = t.sessionIds[0]!;
    await f.app.command({ type: 'task.autoMode', taskId: t.id, enabled: true });
    f.sessions.facts = async () => { throw corrupt(); };
    await f.app.sessionInspect(sessionId);
    vi.useFakeTimers();
    try {
      f.app.observe(sessionId, turnEnd(10));
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
    } finally { vi.useRealTimers(); }
    expect(f.store.requireTask(t.id).columnId).toBe(f.board.workflow.initialColumnId);
    expect(f.store.requireTask(t.id).columnId).not.toBe(columnId);
    expect(f.sessions.sent).toEqual([]);
  });

  it('leaves the stored artifact untouched through classification, diagnosis and recheck', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Read only', description: '' });
    const sessionId = t.sessionIds[0]!;
    const artifactPath = join(f.root, 'sessions', 'session-' + sessionId, 'session.v4.jsonl.zstd');
    await (await import('node:fs/promises')).mkdir(join(f.root, 'sessions', 'session-' + sessionId), { recursive: true });
    await (await import('node:fs/promises')).writeFile(artifactPath, Buffer.from('original-bytes'));
    f.sessions.artifacts.set(sessionId, { kind: 'jsonl', path: artifactPath, revision: 'r1' });
    f.sessions.facts = async () => { throw corrupt(); };
    const before = await readFile(artifactPath);
    const beforeStat = await stat(artifactPath);
    await f.app.snapshot({ refreshSessionIds: [sessionId] });
    await f.app.sessionInspect(sessionId);
    await f.app.sessionInspect(sessionId);
    expect(await readFile(artifactPath)).toEqual(before);
    // Neither the bytes nor the modification time may move: nothing opened it for write.
    const afterStat = await stat(artifactPath);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.size).toBe(beforeStat.size);
    expect(f.sessions.artifacts.get(sessionId)?.revision).toBe('r1');
  });
});
