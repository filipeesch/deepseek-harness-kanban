import type { KanbanSnapshot, Command, Problem } from '../shared/types.js';
import { asProblem } from './problem.js';

/** The product-fixed window between an instructed move and its automatic send. */
export const AUTO_RUN_DELAY_MS = 5_000;

export interface AutoRunClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Browser clock; injected so the controller is deterministic in tests. */
export const systemAutoRunClock: AutoRunClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: handle => window.clearTimeout(handle as number),
};

/** The entry identity and raw instruction captured when a move resolves. */
export interface AutoRunInput {
  taskId: string;
  columnId: string;
  enteredAt: number;
  instruction: string;
}

export type AutoRunStatus = 'counting' | 'sending' | 'failed';

export interface AutoRunEntry extends AutoRunInput {
  deadline: number | null;
  status: AutoRunStatus;
  error?: Problem;
}

/** The only task fields reconciliation needs. */
export interface AutoRunTask {
  id: string;
  columnId: string;
  instructionPending?: { columnId: string; enteredAt: number };
}

export type AutoRunCommand = (command: Command) => Promise<KanbanSnapshot>;

export interface AutoRunOptions {
  run: AutoRunCommand;
  clock?: AutoRunClock;
}

export function runInstructionCommand(input: AutoRunInput): Extract<Command, { type: 'task.runInstruction' }> {
  return { type: 'task.runInstruction', taskId: input.taskId, columnId: input.columnId, expectedEnteredAt: input.enteredAt, expectedInstruction: input.instruction };
}

/** The card's fallback copy when an auto-run failure carries no message. */
export const RUN_FAILURE_FALLBACK = 'The instruction could not be sent.';

/** The entry that belongs to this column, ignoring a stale entry from another stage. */
export function autoRunEntryForColumn(entry: AutoRunEntry | undefined, columnId: string): AutoRunEntry | undefined {
  return entry?.columnId === columnId ? entry : undefined;
}

/** Owns the per-task countdown, the single execution path, and the failure record. */
export class AutoRunController {
  private entries: Record<string, AutoRunEntry> = {};
  private readonly timers = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly clock: AutoRunClock;
  private disposed = false;

  constructor(private readonly options: AutoRunOptions) {
    this.clock = options.clock ?? systemAutoRunClock;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): Record<string, AutoRunEntry> => this.entries;

  /** Arm one window for the task; a newer entry replaces the older timer. */
  arm = (input: AutoRunInput): void => {
    if (this.disposed) return;
    this.clearTimer(input.taskId);
    const deadline = this.clock.now() + AUTO_RUN_DELAY_MS;
    this.commit({ ...input, deadline, status: 'counting' });
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(input.taskId);
      void this.expire(input);
    }, AUTO_RUN_DELAY_MS);
    this.timers.set(input.taskId, timer);
  };

  /** Stop the automatic send only; no command is issued. */
  cancel = (taskId: string): void => {
    this.clearTimer(taskId);
    this.remove(taskId);
  };

  /** Cancel a pending window and execute immediately through the shared path. */
  runNow = async (input: AutoRunInput): Promise<KanbanSnapshot | null> => {
    if (this.disposed) return null;
    const current = this.entries[input.taskId];
    if (current?.status === 'sending') return null;
    this.clearTimer(input.taskId);
    this.commit({ ...input, deadline: null, status: 'sending' });
    return this.execute(input);
  };

  /** Drop windows whose persisted entry no longer matches the board. */
  reconcile = (tasks: readonly AutoRunTask[]): void => {
    for (const entry of Object.values(this.entries)) {
      const task = tasks.find(value => value.id === entry.taskId);
      if (!task || task.instructionPending?.columnId !== entry.columnId || task.instructionPending.enteredAt !== entry.enteredAt) this.cancel(entry.taskId);
    }
  };

  dispose = (): void => {
    this.disposed = true;
    for (const taskId of [...this.timers.keys()]) this.clearTimer(taskId);
    this.entries = {};
    this.listeners.clear();
  };

  private expire = async (input: AutoRunInput): Promise<void> => {
    if (this.disposed) return;
    const current = this.entries[input.taskId];
    if (!current || current.status !== 'counting' || current.columnId !== input.columnId || current.enteredAt !== input.enteredAt) return;
    this.commit({ ...current, deadline: null, status: 'sending' });
    await this.execute(input);
  };

  private execute = async (input: AutoRunInput): Promise<KanbanSnapshot | null> => {
    try {
      const result = await this.options.run(runInstructionCommand(input));
      const current = this.entries[input.taskId];
      // A newer entry may have replaced this one while the command was in flight.
      if (current && current.columnId === input.columnId && current.enteredAt === input.enteredAt) this.remove(input.taskId);
      return result;
    } catch (error) {
      const failure = asProblem(error);
      const current = this.entries[input.taskId];
      if (!current || current.columnId !== input.columnId || current.enteredAt !== input.enteredAt) return null;
      if (failure.code === 'INSTRUCTION_ALREADY_RESOLVED') {
        this.remove(input.taskId);
        return null;
      }
      if (current.status !== 'sending') return null;
      this.commit({ ...current, deadline: null, status: 'failed', error: failure });
      return null;
    }
  };

  private clearTimer = (taskId: string): void => {
    const handle = this.timers.get(taskId);
    if (handle === undefined) return;
    this.clock.clearTimeout(handle);
    this.timers.delete(taskId);
  };

  private commit = (entry: AutoRunEntry): void => {
    this.entries = { ...this.entries, [entry.taskId]: entry };
    this.emit();
  };

  private remove = (taskId: string): void => {
    if (!(taskId in this.entries)) return;
    const next = { ...this.entries };
    delete next[taskId];
    this.entries = next;
    this.emit();
  };

  private emit = (): void => {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* observers must not break the timer */ }
    }
  };
}
