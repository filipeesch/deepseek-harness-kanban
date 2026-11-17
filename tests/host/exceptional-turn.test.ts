import { describe, expect, it, vi } from 'vitest';
import { ExceptionalTurnObserver } from '../../src/host/exceptional-turn.js';

const identity = { id: 'x1', sessionId: 's1', turn: 4, entryId: 'e1', fromColumnId: 'a', columnId: 'b' };
const end = (turn: number, kind: string) => ({ type: 'turn/end', seq: turn * 2 + 1, data: { turn, reason: { kind } } });
const start = (turn: number) => ({ type: 'turn/start', seq: turn * 2, data: { turn } });

function setup() {
  let current = true;
  const admissions: Array<{ token: () => boolean }> = [];
  const expired: string[] = [];
  const report = vi.fn();
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const observer = new ExceptionalTurnObserver({
    taskForSession: session => ['s1', 's2'].includes(session) ? 'task' : undefined,
    matches: () => current,
    admit: async (_task, _identity, token) => { admissions.push({ token }); await waiting; },
    expire: async (_task, id) => { expired.push(id); },
    report,
  });
  return { observer, admissions, expired, report, finish, replace: () => { current = false; } };
}

describe('exceptional turn observer', () => {
  it('admits only the exact owner and completed turn, suppressing duplicates', async () => {
    const f = setup(); f.observer.register('task', identity);
    expect(f.observer.observe('s1', end(3, 'completed'))).toBe(false);
    expect(f.observer.observe('s1', end(4, 'completed'))).toBe(true);
    expect(f.admissions).toHaveLength(1);
    expect(f.admissions[0]!.token()).toBe(true);
    expect(f.observer.observe('s1', end(4, 'completed'))).toBe(true);
    f.finish(); await vi.waitFor(() => expect(f.admissions[0]!.token()).toBe(false));
    expect(f.observer.observe('s1', end(4, 'completed'))).toBe(true);
    expect(f.admissions).toHaveLength(1);
  });
  it('preserves the owner while another conversation runs, then revokes after owner completion', () => {
    for (const event of [start(1), { type: 'agent/inbox/spliced', seq: 12, data: {} }]) {
      const f = setup(); f.observer.register('task', identity);
      expect(f.observer.observe('s2', event)).toBe(false);
      expect(f.observer.owns('task', 'x1')).toBe(true);
      expect(f.observer.observe('s1', end(4, 'completed'))).toBe(true);
      expect(f.observer.observe('s2', event)).toBe(false);
      expect(f.expired).toEqual(['x1']);
      expect(f.admissions[0]!.token()).toBe(false);
      f.finish();
    }
  });
  it('forwards other completions immediately and cancels older automatic triggers only when the owner completes', () => {
    const f = setup(); const ownerCompleted = vi.fn();
    const observer = new ExceptionalTurnObserver({
      taskForSession: () => 'task', matches: () => true,
      admit: async () => {}, expire: async () => {}, report: f.report, ownerCompleted,
    });
    observer.register('task', identity);
    expect(observer.observe('s2', end(1, 'completed'))).toBe(false);
    expect(observer.observe('s1', end(4, 'completed'))).toBe(true);
    expect(ownerCompleted).toHaveBeenCalledOnce();
  });
  it('expires unsuccessful, malformed and later owner boundaries', () => {
    for (const event of [end(4, 'error'), end(4, 'aborted'), end(4, 'blocked'), end(4, 'interrupted'), start(5), { type: 'turn/end', data: {} }]) {
      const f = setup(); f.observer.register('task', identity);
      expect(f.observer.observe('s1', event)).toBe(false);
      expect(f.expired).toEqual(['x1']);
      expect(f.admissions).toHaveLength(0);
    }
  });
  it('never replays persisted identity after restart and cannot erase a replacement', () => {
    const f = setup();
    expect(f.observer.observe('s1', end(4, 'completed'))).toBe(false);
    f.observer.register('task', identity); f.replace();
    expect(f.observer.observe('s1', end(4, 'completed'))).toBe(false);
    expect(f.expired).toEqual(['x1']);
    expect(f.admissions).toHaveLength(0);
  });
  it('revokes an in-flight token on replacement, forget, and disposal', () => {
    for (const action of ['replace', 'forget', 'dispose'] as const) {
      const f = setup(); f.observer.register('task', identity);
      f.observer.observe('s1', end(4, 'completed'));
      if (action === 'replace') f.observer.register('task', { ...identity, id: 'x2', turn: 5 });
      if (action === 'forget') f.observer.forget('task');
      if (action === 'dispose') f.observer.dispose();
      expect(f.admissions[0]!.token()).toBe(false);
      if (action === 'forget') expect(f.expired).toEqual(['x1']);
      f.finish();
    }
  });
});
