import { execFileSync } from 'node:child_process';
import { sweepOwned } from './sweep.js';
import type { Membership, ProcessOwnership, ProcessTable } from './types.js';

/** The program-invocation seam, injected so a test can describe a process table. */
export interface ProcessPrograms {
  run(program: string, args: readonly string[], maxBuffer: number): string;
}

const environment = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C' });

const nodePrograms: ProcessPrograms = {
  // A stalled process listing must fail the proof instead of blocking the event loop.
  run: (program, args, maxBuffer) => execFileSync(program, [...args], { encoding: 'utf8', maxBuffer, timeout: 5000, env: environment() }),
};

/**
 * The macOS process table. The environment-bearing command column is the only read
 * that proves ownership, and its launch-time prefix is localized, so the read never
 * parses a heading.
 */
export function createDarwinTable(programs: ProcessPrograms = nodePrograms): ProcessTable {
  return {
    candidates(needle) {
      const table = programs.run('ps', ['-E', '-axo', 'pid=,command='], 64 * 1024 * 1024);
      const found: number[] = [];
      for (const line of table.split('\n')) {
        const match = /^\s*([0-9]+)\s+(.*)$/.exec(line);
        if (!match) continue;
        const pid = Number(match[1]);
        if (pid === process.pid || pid === process.ppid) continue;
        if (match[2]!.includes(needle)) found.push(pid);
      }
      return found;
    },
    membership(pid, needle): Membership {
      let table: string;
      try { table = programs.run('ps', ['-p', String(pid), '-E', '-o', 'command='], 4 * 1024 * 1024); }
      catch { return 'absent'; }
      if (table.trim().length === 0) return 'absent';
      return table.includes(needle) ? 'owned' : 'not-owned';
    },
    stopped(pid) {
      try { return programs.run('ps', ['-p', String(pid), '-o', 'stat='], 64 * 1024).trim().startsWith('T'); }
      catch { return undefined; }
    },
  };
}

/** macOS ownership for the process that may read the process table. */
export function createDarwinOwnership(programs: ProcessPrograms = nodePrograms): ProcessOwnership {
  const table = createDarwinTable(programs);
  return { sweep: (marker, exclude) => sweepOwned(table, marker, { exclude }) };
}
