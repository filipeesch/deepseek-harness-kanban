/** Whether a candidate still carries the run token that proves ownership. */
export type Membership = 'owned' | 'not-owned' | 'absent';

/**
 * The reads one process table offers. A table is the only authority that decides
 * membership; a pid alone, or a pid beside a separately read timestamp, never proves it.
 */
export interface ProcessTable {
  /** Pids that might carry the token. A superset is fine; membership decides. */
  candidates(needle: string): number[];
  /** Confirms one candidate's own environment, or reports that it exited. */
  membership(pid: number, needle: string): Membership;
  /** Whether the process was already stopped by its owner; undefined when unknown. */
  stopped(pid: number): boolean | undefined;
}

/** The whole-tree cleanup operation the guard, the host, and the reclaim path share. */
export interface ProcessOwnership {
  /**
   * Signals every process that carries this token and rejects unless the set is empty.
   * A registered guard never carries the token, so an exclusion is defence in depth
   * rather than the proof; a delegated owner computes its own.
   */
  sweep(marker: string, exclude?: ReadonlySet<number>): Promise<void>;
}
