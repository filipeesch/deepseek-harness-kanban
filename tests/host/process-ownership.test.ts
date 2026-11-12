import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NativeExecutionOwnership } from '../../src/host/deterministic/ownership.js';
import { createDarwinTable, type ProcessPrograms } from '../../src/host/deterministic/process/darwin.js';
import { createDelegatedOwnership } from '../../src/host/deterministic/process/delegated.js';
import { createProcessOwnership, hostTable, ownedProcesses, terminateOwned } from '../../src/host/deterministic/process/index.js';
import { createLinuxTable, type ProcessFiles } from '../../src/host/deterministic/process/linux.js';
import { markerNeedle, sweepOwned } from '../../src/host/deterministic/process/sweep.js';
import type { Membership, ProcessTable } from '../../src/host/deterministic/process/types.js';
import { createWindowsOwnership, WINDOWS_UNSUPPORTED } from '../../src/host/deterministic/process/windows.js';

const marker = 'a'.repeat(32);

function fakeTable(initial: Record<number, Membership>, options: { stopped?: boolean } = {}) {
  const states = new Map<number, Membership>(Object.entries(initial).map(([pid, value]) => [Number(pid), value]));
  const signals: Array<{ pid: number; signal: string }> = [];
  const control: ProcessTable = {
    candidates: () => [...states].filter(([, value]) => value === 'owned').map(([pid]) => pid),
    membership: pid => states.get(pid) ?? 'absent',
    stopped: () => options.stopped ?? false,
  };
  const kill = (pid: number, signal: NodeJS.Signals): void => {
    signals.push({ pid, signal });
    if (signal === 'SIGKILL') states.set(pid, 'absent');
  };
  return { control, states, signals, kill };
}

function unreadable(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function procFiles(entries: Record<string, string | NodeJS.ErrnoException>): ProcessFiles {
  return {
    list: directory => [...new Set(Object.keys(entries).filter(path => path.startsWith(directory + '/')).map(path => path.slice(directory.length + 1).split('/')[0]!))],
    read: path => {
      const value = entries[path];
      if (value === undefined) throw unreadable('ENOENT');
      if (typeof value !== 'string') throw value;
      return Buffer.from(value);
    },
  };
}

function psPrograms(responses: Record<string, string | Error>): ProcessPrograms {
  return {
    run: (program, args) => {
      const key = [program, ...args].join(' ');
      const value = responses[key];
      if (value === undefined) throw new Error('unexpected program call ' + key);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

describe('token sweep', () => {
  it('signals only processes whose own environment proves ownership', async () => {
    const table = fakeTable({ 11: 'owned', 12: 'not-owned' });
    await sweepOwned(table.control, marker, { kill: table.kill, sleep: async () => {} });
    expect(table.signals).toEqual([{ pid: 11, signal: 'SIGSTOP' }, { pid: 11, signal: 'SIGKILL' }]);
  });

  it('never resumes a process it did not stop itself', async () => {
    const table = fakeTable({ 11: 'owned' }, { stopped: true });
    await sweepOwned(table.control, marker, { kill: table.kill, sleep: async () => {} });
    expect(table.signals).toEqual([{ pid: 11, signal: 'SIGKILL' }]);
  });

  it('continues a frozen process whose membership changed instead of killing it', async () => {
    const signals: string[] = [];
    let reads = 0;
    const control: ProcessTable = {
      candidates: () => (signals.includes('SIGSTOP') ? [] : [11]),
      membership: () => { reads += 1; return reads === 1 ? 'owned' : 'not-owned'; },
      stopped: () => false,
    };
    await sweepOwned(control, marker, { kill: (_pid, signal) => { signals.push(signal); }, sleep: async () => {}, rounds: 2 });
    expect(signals).toEqual(['SIGSTOP', 'SIGCONT']);
  });

  it('rejects when an owned process survives every round', async () => {
    const table = fakeTable({ 11: 'owned' });
    await expect(sweepOwned(table.control, marker, { kill: () => {}, sleep: async () => {}, rounds: 2 })).rejects.toThrow(/survived cleanup/);
  });

  it('never treats a registered guard pid as owned', async () => {
    const table = fakeTable({ 11: 'owned', 12: 'owned' });
    await sweepOwned(table.control, marker, { kill: table.kill, sleep: async () => {}, exclude: new Set([11]) });
    expect(table.signals.map(entry => entry.pid)).toEqual([12, 12]);
    expect(table.states.get(11)).toBe('owned');
  });

  it('matches only the environment entry, never a bare marker string', () => {
    expect(markerNeedle(marker)).toBe('DSH_DETERMINISTIC_RUN=' + marker);
  });
});

describe('linux process table', () => {
  const files = procFiles({
    '/proc/31/environ': 'A=1\0DSH_DETERMINISTIC_RUN=' + marker + '\0',
    '/proc/32/environ': 'A=1\0',
    '/proc/33/environ': unreadable('EACCES'),
    '/proc/31/stat': '31 (bash) S 1 31 31 0 -1',
    '/proc/32/stat': '32 (bash) T 1 32 32 0 -1',
    '/proc/33/stat': '33 (bash) S 1 33 33 0 -1',
  });
  const table = createLinuxTable(files);

  it('reads ownership from the kernel environment', () => {
    expect(table.candidates(markerNeedle(marker))).toEqual([31]);
    expect(table.membership(31, markerNeedle(marker))).toBe('owned');
    expect(table.membership(32, markerNeedle(marker))).toBe('not-owned');
  });

  it('treats an unreadable environment as outside the tracked set and a missing one as gone', () => {
    expect(table.candidates(markerNeedle(marker))).not.toContain(33);
    expect(table.membership(33, markerNeedle(marker))).toBe('not-owned');
    expect(table.membership(99, markerNeedle(marker))).toBe('absent');
  });

  it('reports whether a process was already stopped', () => {
    expect(table.stopped(31)).toBe(false);
    expect(table.stopped(32)).toBe(true);
    expect(table.stopped(99)).toBeUndefined();
  });
});

describe('macOS process table', () => {
  it('reads the environment-bearing command column only', () => {
    const programs = psPrograms({
      'ps -E -axo pid=,command=': '  41 node DSH_DETERMINISTIC_RUN=' + marker + '\n  42 node unrelated\n',
      'ps -p 41 -E -o command=': 'node DSH_DETERMINISTIC_RUN=' + marker,
      'ps -p 42 -E -o command=': 'node unrelated',
      'ps -p 41 -o stat=': 'S',
      'ps -p 42 -o stat=': 'T',
    });
    const table = createDarwinTable(programs);
    expect(table.candidates(markerNeedle(marker))).toEqual([41]);
    expect(table.membership(42, markerNeedle(marker))).toBe('not-owned');
    expect(table.membership(43, markerNeedle(marker))).toBe('absent');
    expect(table.stopped(42)).toBe(true);
    expect(table.stopped(43)).toBeUndefined();
  });
});

describe('platform ownership selection', () => {
  it('delegates the sweep to the one party that can read the table', async () => {
    const requests: string[] = [];
    const ownership = createDelegatedOwnership(async requested => { requests.push(requested); });
    await ownership.sweep(marker);
    expect(requests).toEqual([marker]);
  });

  it('propagates a refused delegated sweep instead of reporting clean', async () => {
    const ownership = createDelegatedOwnership(async () => { throw new Error('host refused'); });
    await expect(ownership.sweep(marker)).rejects.toThrow('host refused');
  });

  it('fails closed where no ownership primitive is enabled', async () => {
    await expect(createWindowsOwnership().sweep(marker)).rejects.toThrow(WINDOWS_UNSUPPORTED);
    await expect(createProcessOwnership('win32').sweep(marker)).rejects.toThrow(/NATIVE_LIFETIME_UNSUPPORTED/);
    // An empty set would read as proof that nothing survives; no platform without a
    // primitive can claim that.
    expect(() => ownedProcesses(marker, 'win32')).toThrow(/NATIVE_LIFETIME_UNSUPPORTED/);
    await expect(terminateOwned(marker, 'win32')).rejects.toThrow(/NATIVE_LIFETIME_UNSUPPORTED/);
    expect(hostTable('win32')).toBeUndefined();
  });

  it('selects a readable table on every supported host platform', () => {
    expect(hostTable('linux')).toBeDefined();
    expect(hostTable('darwin')).toBeDefined();
    expect(createProcessOwnership('linux')).not.toBe(createProcessOwnership('darwin'));
  });

  it('refuses to release a marker-backed record where no ownership primitive exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kanban-unsupported-reclaim-'));
    try {
      const ownership = new NativeExecutionOwnership(root, 'win32');
      // A witness port nobody answers, so only the host-side fallback could claim clean.
      const dead = createServer(() => {});
      await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve));
      const address = dead.address();
      if (address === null || typeof address === 'string') throw new Error('the probe endpoint did not bind.');
      await new Promise<void>(resolve => dead.close(() => resolve()));
      const scope = { hubId: 'h', boardId: 'b', projectId: 'p', stageIdentity: 's' };
      const release = await ownership.acquire(scope, 'stale-execution', 'task', { port: address.port, token: 'b'.repeat(64) });
      await release.register({ port: address.port, token: 'c'.repeat(64), marker });
      await expect(ownership.reclaim('stale-execution')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' });
      expect(await readdir(root)).toContain('owners');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
