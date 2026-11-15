import { readdirSync, readFileSync } from 'node:fs';
import { sweepOwned } from './sweep.js';
import type { Membership, ProcessOwnership, ProcessTable } from './types.js';

/** The kernel process filesystem reads, injected so a test can describe a table. */
export interface ProcessFiles {
  list(directory: string): string[];
  read(path: string): Buffer;
}

const nodeFiles: ProcessFiles = { list: directory => readdirSync(directory), read: path => readFileSync(path) };

const PID = /^[0-9]+$/;
/** Options whose environment cannot be inspected, so they are outside the tracked set. */
const UNREADABLE = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM']);
const GONE = new Set(['ENOENT', 'ESRCH']);

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** The state letter and the process-group id from one `/proc/<pid>/stat` record. */
function statFields(files: ProcessFiles, pid: number | string): { state: string; pgrp: number } | undefined {
  try {
    const stat = files.read('/proc/' + pid + '/stat').toString('utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { state: fields[0] ?? '', pgrp: Number(fields[2]) };
  } catch { return undefined; }
}

/**
 * The Linux process table. Ownership comes from the kernel's own per-process
 * environment, so no external process-listing program is needed and the read works
 * under bwrap and Landlock.
 */
export function createLinuxTable(files: ProcessFiles = nodeFiles): ProcessTable {
  return {
    candidates(needle) {
      const found: number[] = [];
      for (const name of files.list('/proc')) {
        if (!PID.test(name)) continue;
        const pid = Number(name);
        if (pid === process.pid || pid === process.ppid) continue;
        let environment: Buffer;
        try { environment = files.read('/proc/' + name + '/environ'); }
        catch (error) {
          // An unreadable environment cannot be inspected, so it is outside the
          // tracked set; that is the documented credential-change residual.
          if (UNREADABLE.has(codeOf(error) ?? '')) continue;
          throw error;
        }
        if (environment.includes(needle)) found.push(pid);
      }
      return found;
    },
    membership(pid, needle): Membership {
      let environment: Buffer;
      try { environment = files.read('/proc/' + pid + '/environ'); }
      catch (error) {
        if (GONE.has(codeOf(error) ?? '')) return 'absent';
        if (codeOf(error) === 'EACCES' || codeOf(error) === 'EPERM') return 'not-owned';
        throw error;
      }
      return environment.includes(needle) ? 'owned' : 'not-owned';
    },
    stopped(pid) {
      const fields = statFields(files, pid);
      return fields === undefined ? undefined : fields.state === 'T';
    },
  };
}

/** Linux ownership: the kernel's own per-process environment decides membership. */
export function createLinuxOwnership(files: ProcessFiles = nodeFiles): ProcessOwnership {
  const table = createLinuxTable(files);
  return { sweep: (marker, exclude) => sweepOwned(table, marker, { exclude }) };
}
