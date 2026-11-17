import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotSchema } from '../../src/remote.js';
import { fixture, taskWithConversation } from './helpers.js';
import { MISSING_SESSION_CODE, UNREADABLE_SESSION_CODE } from '../../src/domain/session-observation.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }
const corrupt = (message = 'stored session failed validation: PTC dispatch repeats subCallId') => Object.assign(new Error(message), { code: UNREADABLE_SESSION_CODE });

describe('session observation snapshots', () => {
  it('publishes the observation for a conversation it could not observe', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Corrupt', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    const snapshot = await f.app.snapshot({ refreshSessionIds: [sessionId] });
    expect(snapshot.conversationObservations?.[sessionId]).toEqual({
      state: 'unreadable',
      cause: 'stored session failed validation: PTC dispatch repeats subCallId',
    });
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('omits the field while every conversation is observed', async () => {
    const f = await setup();
    await taskWithConversation(f.app, { projectId: f.project.id, title: 'Healthy', description: '' });
    const snapshot = await f.app.snapshot();
    expect(snapshot.conversationObservations).toBeUndefined();
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('distinguishes a missing log from an unreadable one', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Missing', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw Object.assign(new Error('no stored log'), { code: MISSING_SESSION_CODE }); };
    const snapshot = await f.app.snapshot({ refreshSessionIds: [sessionId] });
    expect(snapshot.conversationObservations?.[sessionId]).toEqual({ state: 'missing', cause: 'no stored log' });
  });

  it('records the failure on the first read rather than after a retry allowance', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'First read', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    await f.app.snapshot({ refreshSessionIds: [sessionId] });
    expect((await f.app.snapshot()).conversationObservations?.[sessionId]?.state).toBe('unreadable');
  });

  it('inspects one conversation and reports its artifact location', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Inspected', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.artifacts.set(sessionId, { kind: 'jsonl', path: '/sessions/session-1/session.v4.jsonl.zstd', revision: 'r1' });
    f.sessions.facts = async () => { throw corrupt(); };
    const inspection = await f.app.sessionInspect(sessionId);
    expect(inspection.observation?.state).toBe('unreadable');
    expect(inspection.location).toEqual({ kind: 'jsonl', path: '/sessions/session-1/session.v4.jsonl.zstd', revision: 'r1' });
    expect((await f.app.snapshot()).conversationObservations?.[sessionId]?.state).toBe('unreadable');
  });

  it('reports no location for a missing log', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No artifact', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw Object.assign(new Error('no stored log'), { code: MISSING_SESSION_CODE }); };
    const inspection = await f.app.sessionInspect(sessionId);
    expect(inspection.observation?.state).toBe('missing');
    expect(inspection.location).toBeUndefined();
  });

  it('clears the observation through an inspect once the artifact is repaired', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Repaired by inspect', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    await f.app.sessionInspect(sessionId);
    expect((await f.app.snapshot()).conversationObservations?.[sessionId]?.state).toBe('unreadable');
    f.sessions.facts = async () => ({ running: false, background: [], pending: { kinds: [], queuedPrompts: 0 }, settledTurn: null });
    const inspection = await f.app.sessionInspect(sessionId);
    expect(inspection.observation).toBeNull();
    expect((await f.app.snapshot()).conversationObservations).toBeUndefined();
  });

  it('clears the observation once the conversation is observed again', async () => {
    const f = await setup();
    const t = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Repaired', description: '' });
    const sessionId = t.sessionIds[0]!;
    f.sessions.facts = async () => { throw corrupt(); };
    expect((await f.app.snapshot({ refreshSessionIds: [sessionId] })).conversationObservations?.[sessionId]).toBeDefined();
    f.sessions.facts = async () => ({ running: false, background: [], pending: { kinds: [], queuedPrompts: 0 }, settledTurn: null });
    expect((await f.app.snapshot({ refreshSessionIds: [sessionId] })).conversationObservations).toBeUndefined();
  });
});
