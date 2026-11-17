import { describe, expect, it, vi } from 'vitest';
import { constants, zstdCompressSync } from 'node:zlib';
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog';
import {
  SessionRepair,
  SessionRepairRefused,
  planRepair,
  rewriteArtifact,
  scanArtifact,
  type SessionRepairPorts,
} from '../../src/host/session-repair.js';
import { validateSessionArtifact } from '../../src/host/session-validator.js';

const FRAME = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
function frame(text: string): Buffer { return zstdCompressSync(Buffer.from(text + '\n', 'utf8'), FRAME); }

const header = { id: 's1', version: 4, cwd: '/project', createdAt: '2026-01-01T00:00:00.000Z' };
const dispatchStart = (seq: number, id: string) => ({ type: 'tool/ptc-dispatch-start', seq, data: { subCallId: id, rootCallId: 'call-A', parentCallId: 'call-A', name: 'bash', arguments: '{}' } });
// The installed format settles a dispatch with tool/ptc-dispatch, paired by subCallId.
const dispatchEnd = (seq: number, id: string) => ({ type: 'tool/ptc-dispatch', seq, data: { subCallId: id, rootCallId: 'call-A', parentCallId: 'call-A', name: 'bash', arguments: {}, isError: false, content: [] } });
const call = (seq: number) => ({ type: 'tool/call', seq, data: { callId: 'call-A', name: 'run_code', arguments: '{}' } });
// The installed V4 format pairs a result by message.toolCallId, not by the message source.
const result = (seq: number, callId = 'call-A') => ({ type: 'tool/result', seq, data: { message: { toolCallId: callId, source: { callId } } } });

/** Two invocations that receive the same provider call id and repeat one subCallId. */
function corruptRows() {
  return [
    { type: 'turn/start', seq: 1, data: {} },
    call(2),
    dispatchStart(3, 'call-A:ptc:1'),
    dispatchEnd(4, 'call-A:ptc:1'),
    result(5),
    call(6),
    dispatchStart(7, 'call-A:ptc:1'),
    dispatchEnd(8, 'call-A:ptc:1'),
    result(9),
    { type: 'turn/end', seq: 10, data: { reason: { kind: 'ok' } } },
  ];
}

function artifact(rows: readonly unknown[] = corruptRows(), head: unknown = header): Buffer {
  return Buffer.concat([frame(JSON.stringify(head)), ...rows.map(row => frame(JSON.stringify(row)))]);
}

interface FakeArtifact {
  readonly ports: SessionRepairPorts;
  /** The bytes the fake artifact currently holds. */
  file(): Buffer;
  /** Replace the artifact behind the pipeline's back, as another writer would. */
  set(bytes: Buffer): void;
  /** Every bytes value moved onto the artifact, in order. */
  replacements(): readonly Buffer[];
}

/** A fake artifact whose staged bytes only reach it through replaceArtifact. */
function fakeArtifact(overrides: Partial<SessionRepairPorts> = {}, initial: Buffer = artifact()): FakeArtifact {
  const staged = new Map<string, Buffer>();
  const replaced: Buffer[] = [];
  let current = initial;
  let sequence = 0;
  const ports: SessionRepairPorts = {
    live: () => false,
    location: async () => ({ kind: 'jsonl', path: '/dsh/sessions/p/session-s1/session.v4.jsonl.zstd', revision: 'r1' }),
    readArtifact: async () => current,
    stageArtifact: vi.fn(async (_path: string, bytes: Buffer) => { const key = 'stage-' + (++sequence); staged.set(key, bytes); return key; }),
    replaceArtifact: vi.fn(async (staging: string) => { const bytes = staged.get(staging); if (bytes === undefined) throw new Error('unknown staging path'); current = bytes; replaced.push(bytes); }),
    discardArtifact: vi.fn(async (staging: string) => { staged.delete(staging); }),
    keepBackup: vi.fn(async () => '/dsh/session-repair-backups/kanban/s1/stamp/session.v4.jsonl.zstd'),
    observe: vi.fn(async () => {}),
    validate: vi.fn(async () => {}),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
  return { ports, file: () => current, set: bytes => { current = bytes; }, replacements: () => replaced };
}

describe('artifact scan', () => {
  it('decodes the header, the rows and the frame ownership', () => {
    const scanned = scanArtifact(artifact());
    expect(scanned.header).toEqual(header);
    expect(scanned.rows).toHaveLength(corruptRows().length);
    expect(scanned.lines).toHaveLength(corruptRows().length + 1);
    expect(scanned.frames).toHaveLength(corruptRows().length + 1);
    expect(scanned.lineFrames[0]).toBe(0);
    expect(scanned.lineFrames[1]).toBe(1);
  });

  it('refuses a torn final frame', () => {
    const whole = artifact();
    expect(() => scanArtifact(whole.subarray(0, whole.length - 6))).toThrow(SessionRepairRefused);
  });

  it('refuses a header that is not JSON', () => {
    const bytes = Buffer.concat([frame('not-json'), frame(JSON.stringify({ type: 'turn/start', seq: 1, data: {} }))]);
    expect(() => scanArtifact(bytes)).toThrow(SessionRepairRefused);
  });

  it('refuses a record line that is not JSON', () => {
    const bytes = Buffer.concat([frame(JSON.stringify(header)), frame('{not json')]);
    expect(() => scanArtifact(bytes)).toThrow(SessionRepairRefused);
  });

  it('refuses an artifact whose first frame is not exactly the header line', () => {
    const bytes = Buffer.concat([frame(JSON.stringify(header) + '\n' + JSON.stringify({ type: 'turn/start', seq: 1, data: {} }))]);
    expect(() => scanArtifact(bytes)).toThrow(SessionRepairRefused);
  });
});

describe('repair plan', () => {
  it('renames only the repeated invocation and continues past the highest sequence', () => {
    const scanned = scanArtifact(artifact());
    const plan = planRepair(scanned.rows);
    expect(plan.renames).toEqual([{ from: 'call-A:ptc:1', to: 'call-A:ptc:2' }]);
    // The first invocation keeps its identifier: only the second window changes.
    expect([...plan.lineRenames.keys()]).toEqual([6, 7]);
  });

  it('renames only an identifier that already started earlier, never a unique later one', () => {
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'), dispatchEnd(4, 'call-A:ptc:1'), result(5),
      call(6), dispatchStart(7, 'call-A:ptc:2'), dispatchEnd(8, 'call-A:ptc:2'), result(9),
      { type: 'turn/end', seq: 10, data: { reason: { kind: 'ok' } } },
    ];
    expect(planRepair(rows).renames).toHaveLength(0);
  });

  it('renames only the colliding identifier inside a repeated invocation', () => {
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'), dispatchEnd(4, 'call-A:ptc:1'), result(5),
      call(6), dispatchStart(7, 'call-A:ptc:1'), dispatchEnd(8, 'call-A:ptc:1'), dispatchStart(9, 'call-A:ptc:2'), dispatchEnd(10, 'call-A:ptc:2'), result(11),
      { type: 'turn/end', seq: 12, data: { reason: { kind: 'ok' } } },
    ];
    const plan = planRepair(rows);
    expect(plan.renames).toEqual([{ from: 'call-A:ptc:1', to: 'call-A:ptc:3' }]);
    expect([...plan.lineRenames.keys()].sort((left, right) => left - right)).toEqual([6, 7]);
  });

  it('pairs a call with a result that arrives after another call started', () => {
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'),
      { type: 'tool/call', seq: 4, data: { callId: 'call-B', name: 'read', arguments: '{}' } },
      // The duplicate belongs to the first call, whose result has not arrived yet.
      dispatchStart(5, 'call-A:ptc:1'), dispatchEnd(6, 'call-A:ptc:1'),
      result(7, 'call-A'),
      { type: 'tool/result', seq: 8, data: { message: { toolCallId: 'call-B' } } },
      { type: 'turn/end', seq: 9, data: { reason: { kind: 'ok' } } },
    ];
    const plan = planRepair(rows);
    expect(plan.renames).toEqual([{ from: 'call-A:ptc:1', to: 'call-A:ptc:2' }]);
    expect([...plan.lineRenames.keys()].sort((left, right) => left - right)).toEqual([4, 5]);
  });

  it('follows a job that settles after the invocation closed, and only that job', () => {
    const job = (type: string, seq: number, jobId: string) => ({ type, seq, data: { jobId, owner: 's1', toolCall: { callId: 'call-A:ptc:1', rootCallId: 'call-A' } } });
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'), job('job/registered', 4, 'job-first'), dispatchEnd(5, 'call-A:ptc:1'), result(6),
      call(7), dispatchStart(8, 'call-A:ptc:1'), job('job/registered', 9, 'job-second'), dispatchEnd(10, 'call-A:ptc:1'), result(11),
      job('job/settled', 12, 'job-second'), job('job/settled', 13, 'job-first'),
      { type: 'turn/end', seq: 14, data: { reason: { kind: 'ok' } } },
    ];
    const plan = planRepair(rows);
    expect(plan.renames).toEqual([{ from: 'call-A:ptc:1', to: 'call-A:ptc:2' }]);
    // The duplicate dispatch, the job registered inside it, and that job's later settlement.
    // The first invocation and its own job keep their identifier.
    expect([...plan.lineRenames.keys()].sort((left, right) => left - right)).toEqual([7, 8, 9, 11]);
    const rewritten = rewriteArtifact(scanArtifact(artifact(rows)), plan);
    const settled = rewritten.rows.filter(row => (row as { type?: string }).type === 'job/settled') as Array<{ data: { jobId: string; toolCall: { callId: string } } }>;
    expect(settled.find(row => row.data.jobId === 'job-second')?.data.toolCall.callId).toBe('call-A:ptc:2');
    expect(settled.find(row => row.data.jobId === 'job-first')?.data.toolCall.callId).toBe('call-A:ptc:1');
  });

  it('never rewrites a payload string that merely contains the identifier', () => {
    const argumentsWithId = JSON.stringify({ id: 'call-A:ptc:1' });
    const dispatch = (type: string, seq: number) => ({ type, seq, data: { subCallId: 'call-A:ptc:1', rootCallId: 'call-A', parentCallId: 'call-A', name: 'bash', arguments: argumentsWithId, ...(type === 'tool/ptc-dispatch' ? { isError: false, content: [] } : {}) } });
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatch('tool/ptc-dispatch-start', 3), dispatch('tool/ptc-dispatch', 4), result(5),
      call(6), dispatch('tool/ptc-dispatch-start', 7), dispatch('tool/ptc-dispatch', 8), result(9),
      { type: 'turn/end', seq: 10, data: { reason: { kind: 'ok' } } },
    ];
    const rewritten = rewriteArtifact(scanArtifact(artifact(rows)), planRepair(rows));
    const starts = rewritten.rows.filter(row => (row as { type?: string }).type === 'tool/ptc-dispatch-start') as Array<{ data: { subCallId: string; arguments: string } }>;
    expect(starts.map(row => row.data.subCallId)).toEqual(['call-A:ptc:1', 'call-A:ptc:2']);
    // The nested payload keeps the text it always had; only the identifier field changed.
    expect(starts.every(row => row.data.arguments === argumentsWithId)).toBe(true);
  });

  it('plans nothing for a healthy artifact', () => {
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'), dispatchEnd(4, 'call-A:ptc:1'), result(5),
      { type: 'turn/end', seq: 6, data: { reason: { kind: 'ok' } } },
    ];
    expect(planRepair(rows).renames).toHaveLength(0);
  });
});

describe('artifact rewrite', () => {
  it('preserves the record count and order and changes only the planned lines', () => {
    const scanned = scanArtifact(artifact());
    const plan = planRepair(scanned.rows);
    const rewritten = rewriteArtifact(scanned, plan);
    const after = scanArtifact(rewritten.bytes);
    expect(after.lines).toHaveLength(scanned.lines.length);
    expect(rewritten.changedLines).toHaveLength(2);
    const starts = after.rows.filter(row => (row as { type?: string }).type === 'tool/ptc-dispatch-start').map(row => (row as { data: { subCallId: string } }).data.subCallId);
    expect(starts).toEqual(['call-A:ptc:1', 'call-A:ptc:2']);
    expect(JSON.stringify(after.rows.filter((_row, index) => index < 6))).toBe(JSON.stringify(scanned.rows.slice(0, 6)));
  });

  it('keeps untouched frames byte-identical', () => {
    const scanned = scanArtifact(artifact());
    const plan = planRepair(scanned.rows);
    const rewritten = rewriteArtifact(scanned, plan);
    const after = scanArtifact(rewritten.bytes);
    const touched = new Set([...plan.lineRenames.keys()].map(bodyIndex => scanned.lineFrames[bodyIndex + 1]!));
    expect(touched.size).toBeGreaterThan(0);
    for (const [index, frameValue] of scanned.frames.entries()) {
      if (touched.has(index)) continue;
      const moved = after.frames[index]!;
      expect(rewritten.bytes.subarray(moved.start, moved.end)).toEqual(scanned.bytes.subarray(frameValue.start, frameValue.end));
    }
  });
});

describe('rewrite self-check', () => {
  it('refuses a plan that would leave a duplicate identifier behind', () => {
    const scanned = scanArtifact(artifact());
    const plan = planRepair(scanned.rows);
    const lineRenames = new Map(plan.lineRenames);
    // Drop the renamed start row: its settlement would keep the new name alone.
    lineRenames.delete([...lineRenames.keys()][0]!);
    expect(() => rewriteArtifact(scanned, { renames: plan.renames, lineRenames })).toThrow(SessionRepairRefused);
  });
});

describe('installed validator agreement', () => {
  it('repairs a duplicate the installed chain refuses, and the chain accepts the result', async () => {
    const logicalHeader = { version: 4 as const, id: 's1', createdAt: 0, isSeeded: false, delegationDepth: 0 };
    const physicalHeader = sessionFormatCatalog.encodeCurrentHeader(logicalHeader, 0);
    const start = (seq: number) => ({ type: 'tool/ptc-dispatch-start', seq, time: 0, data: { subCallId: 'root:ptc:1', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: {} } });
    const settle = (seq: number) => ({ type: 'tool/ptc-dispatch', seq, time: 0, data: { subCallId: 'root:ptc:1', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: {}, isError: false, content: [] } });
    const events = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
      start(2), settle(3), start(4), settle(5),
      { type: 'step/end', seq: 6, time: 0, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 7, time: 0, data: { turn: 1, reason: { kind: 'ok' } } },
    ];
    const rows = events.map(event => sessionFormatCatalog.encodeCurrentEvent(event as never));
    const bytes = Buffer.concat([frame(JSON.stringify(physicalHeader)), ...rows.map(row => frame(JSON.stringify(row)))]);
    const scanned = scanArtifact(bytes);
    // The installed chain refuses the original log for exactly the repetition this repair exists for.
    await expect(validateSessionArtifact(scanned.header, scanned.rows)).rejects.toThrow(/PTC dispatch repeats subCallId/);
    const plan = planRepair(scanned.rows);
    expect(plan.renames).toEqual([{ from: 'root:ptc:1', to: 'root:ptc:2' }]);
    const rewritten = rewriteArtifact(scanned, plan);
    // The repaired artifact passes the same chain the pipeline runs before any swap.
    await expect(validateSessionArtifact(scanned.header, rewritten.rows)).resolves.toBeUndefined();
  });
});

describe('repair pipeline', () => {
  it('refuses a live conversation', async () => {
    const fake = fakeArtifact({ live: () => true });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toBeInstanceOf(SessionRepairRefused);
    expect(fake.ports.stageArtifact).not.toHaveBeenCalled();
  });

  it('refuses a conversation with no stored log', async () => {
    const fake = fakeArtifact({ location: async () => undefined });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('no stored log');
    expect(fake.ports.stageArtifact).not.toHaveBeenCalled();
  });

  it('refuses a torn artifact', async () => {
    const whole = artifact();
    const fake = fakeArtifact({ readArtifact: async () => whole.subarray(0, whole.length - 6) });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('torn frame');
    expect(fake.ports.stageArtifact).not.toHaveBeenCalled();
  });

  it('refuses an artifact with no repeated identifier', async () => {
    const rows = [
      { type: 'turn/start', seq: 1, data: {} },
      call(2), dispatchStart(3, 'call-A:ptc:1'), dispatchEnd(4, 'call-A:ptc:1'), result(5),
      { type: 'turn/end', seq: 6, data: { reason: { kind: 'ok' } } },
    ];
    const fake = fakeArtifact({ readArtifact: async () => artifact(rows) });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('nothing to repair');
    expect(fake.ports.keepBackup).not.toHaveBeenCalled();
  });

  it('refuses before anything is written when the loader validation rejects the rewrite', async () => {
    const fake = fakeArtifact({ validate: () => { throw new Error('relationship refused'); } });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('relationship refused');
    expect(fake.ports.keepBackup).not.toHaveBeenCalled();
    expect(fake.ports.stageArtifact).not.toHaveBeenCalled();
    expect(fake.replacements()).toEqual([]);
  });

  it('refuses when the artifact changed while the repair was being prepared', async () => {
    let reads = 0;
    const fake = fakeArtifact({ location: async () => ({ kind: 'jsonl', path: '/p/session-s1/session.v4.jsonl.zstd', revision: (reads += 1) === 1 ? 'r1' : 'r2' }) });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('changed while it was being repaired');
    expect(fake.replacements()).toEqual([]);
    expect(fake.ports.discardArtifact).toHaveBeenCalled();
  });

  it('refuses when the conversation becomes live during the final revision read', async () => {
    let reads = 0;
    let live = false;
    const fake = fakeArtifact({
      live: () => live,
      location: async () => { reads += 1; if (reads === 2) live = true; return { kind: 'jsonl', path: '/dsh/sessions/p/session-s1/session.v4.jsonl.zstd', revision: 'r1' }; },
    });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('became live');
    expect(fake.replacements()).toEqual([]);
    expect(fake.ports.discardArtifact).toHaveBeenCalled();
  });

  it('refuses when the conversation becomes live before the swap', async () => {
    let live = false;
    const fake = fakeArtifact({ live: () => live });
    fake.ports.keepBackup = async () => { live = true; return '/backup/path'; };
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('became live');
    expect(fake.replacements()).toEqual([]);
  });

  it('validates, keeps a backup, replaces atomically and re-observes', async () => {
    const fake = fakeArtifact();
    const result = await new SessionRepair(fake.ports).repair('s1');
    expect(result.renamed).toBe(1);
    expect(result.backupPath).toContain('session-repair-backups');
    expect(fake.ports.validate).toHaveBeenCalledTimes(1);
    expect(fake.ports.keepBackup).toHaveBeenCalledTimes(1);
    expect(fake.replacements()).toHaveLength(1);
    expect(fake.ports.observe).toHaveBeenCalledWith('s1');
    const after = scanArtifact(fake.file());
    expect(after.rows.some(row => (row as { data?: { subCallId?: string } }).data?.subCallId === 'call-A:ptc:2')).toBe(true);
  });

  it('restores the original when the repaired artifact is still unreadable', async () => {
    const fake = fakeArtifact({ observe: async () => { throw new Error('still corrupt'); } });
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('the original was restored');
    expect(fake.replacements()).toHaveLength(2);
    expect(fake.file()).toEqual(artifact());
  });

  it('leaves a foreign artifact alone when another writer replaced it during verification', async () => {
    const fake = fakeArtifact();
    const foreign = Buffer.from('written by another writer');
    fake.ports.observe = async () => { fake.set(foreign); throw new Error('still corrupt'); };
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('left untouched');
    expect(fake.file()).toEqual(foreign);
    expect(fake.replacements()).toHaveLength(1);
  });

  it('does not overwrite an artifact replaced while the original was being staged back', async () => {
    const fake = fakeArtifact();
    const foreign = Buffer.from('written by another writer');
    const stage = fake.ports.stageArtifact;
    let staged = 0;
    fake.ports.stageArtifact = vi.fn(async (path: string, bytes: Buffer) => {
      staged += 1;
      const result = await stage(path, bytes);
      // Another writer replaces the artifact during the restore's own staging write.
      if (staged === 2) fake.set(foreign);
      return result;
    });
    fake.ports.observe = async () => { throw new Error('still corrupt'); };
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('left untouched');
    expect(fake.file()).toEqual(foreign);
    // Only the repaired swap reached the artifact; the restore never did.
    expect(fake.replacements()).toHaveLength(1);
    expect(fake.ports.discardArtifact).toHaveBeenCalledTimes(1);
  });

  it('discards the staged original when restoring it fails', async () => {
    const fake = fakeArtifact();
    const replace = fake.ports.replaceArtifact;
    let replaces = 0;
    fake.ports.replaceArtifact = vi.fn(async (staging: string, path: string) => {
      replaces += 1;
      if (replaces === 2) throw new Error('rename failed');
      return replace(staging, path);
    });
    fake.ports.observe = async () => { throw new Error('still corrupt'); };
    await expect(new SessionRepair(fake.ports).repair('s1')).rejects.toThrow('could not be restored');
    expect(fake.ports.discardArtifact).toHaveBeenCalledTimes(1);
  });

  it('serializes repairs of one conversation', async () => {
    const fake = fakeArtifact();
    const repair = new SessionRepair(fake.ports);
    const [first, second] = await Promise.allSettled([repair.repair('s1'), repair.repair('s1')]);
    expect(first.status).toBe('fulfilled');
    // The second attempt runs after the first and finds a log with nothing left to repair.
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(SessionRepairRefused);
    expect(fake.replacements()).toHaveLength(1);
  });
});
