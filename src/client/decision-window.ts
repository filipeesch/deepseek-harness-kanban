import type { Command, KanbanSnapshot, Problem, Task } from '../shared/types.js';

/** The product-fixed window between confirming a choice and applying its route. */
export const DECISION_WINDOW_MS = 5_000;

export interface DecisionClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Browser clock; injected so the window is scripted in tests. */
export const systemDecisionClock: DecisionClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: handle => window.clearTimeout(handle as number),
};

/** Everything one confirmed choice carries until its window closes. */
export interface DecisionWindowInput {
  taskId: string;
  entryId: string;
  optionId: string;
  note?: string;
  destinationId: string;
  /** The stable identity of the destination the person saw. */
  destinationIdentity: string;
  destinationName: string;
}

export type DecisionWindowStatus = 'counting' | 'sending' | 'failed';

export interface DecisionWindowEntry extends DecisionWindowInput {
  /** The moment the route is submitted; absent while sending or failed. */
  deadline: number | null;
  status: DecisionWindowStatus;
  error?: Problem;
}

export type DecisionWindowCommand = (command: Command) => Promise<KanbanSnapshot>;

export interface DecisionWindowOptions {
  run: DecisionWindowCommand;
  clock?: DecisionClock;
  windowMs?: number;
}

/**
 * Holds the cancelable window before a decision choice is applied.
 *
 * The window is client state by design, like the timed stage instruction: a
 * reload discards it, nothing is submitted, and the gate is still waiting. When
 * the window closes the choice is submitted once; the host owns the durable part.
 */
export class DecisionWindowController {
  private entries: Record<string, DecisionWindowEntry> = {};
  private readonly timers = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly clock: DecisionClock;
  private readonly windowMs: number;
  private disposed = false;

  constructor(private readonly options: DecisionWindowOptions) {
    this.clock = options.clock ?? systemDecisionClock;
    this.windowMs = options.windowMs ?? DECISION_WINDOW_MS;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): Record<string, DecisionWindowEntry> => this.entries;

  entryFor = (taskId: string): DecisionWindowEntry | undefined => this.entries[taskId];

  /** Begin one window; a newer confirmation replaces the previous one. */
  arm = (input: DecisionWindowInput): void => {
    if (this.disposed) return;
    this.clearTimer(input.taskId);
    const deadline = this.clock.now() + this.windowMs;
    this.commit({ ...input, deadline, status: 'counting' });
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(input.taskId);
      void this.expire(input);
    }, this.windowMs);
    this.timers.set(input.taskId, timer);
  };

  /** Discard the window without submitting anything. */
  cancel = (taskId: string): void => {
    this.clearTimer(taskId);
    this.remove(taskId);
  };

  /** Drop windows whose stage entry was replaced or whose task is gone. */
  reconcile = (tasks: readonly Pick<Task, 'id' | 'columnId' | 'stageEntry'>[]): void => {
    for (const entry of Object.values(this.entries)) {
      const task = tasks.find(value => value.id === entry.taskId);
      if (task === undefined || task.stageEntry?.id !== entry.entryId) this.cancel(entry.taskId);
    }
  };

  dispose = (): void => {
    this.disposed = true;
    for (const taskId of [...this.timers.keys()]) this.clearTimer(taskId);
    this.entries = {};
    this.listeners.clear();
  };

  private expire = async (input: DecisionWindowInput): Promise<void> => {
    if (this.disposed) return;
    const current = this.entries[input.taskId];
    if (!current || current.status !== 'counting' || current.entryId !== input.entryId || current.optionId !== input.optionId) return;
    this.commit({ ...current, deadline: null, status: 'sending' });
    try {
      await this.options.run({
        type: 'task.decide',
        taskId: input.taskId,
        entryId: input.entryId,
        optionId: input.optionId,
        destinationIdentity: input.destinationIdentity,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
      const latest = this.entries[input.taskId];
      if (latest !== undefined && latest.entryId === input.entryId && latest.optionId === input.optionId) this.remove(input.taskId);
    } catch (error) {
      const latest = this.entries[input.taskId];
      if (!latest || latest.entryId !== input.entryId || latest.optionId !== input.optionId) return;
      this.commit({ ...latest, status: 'failed', error: asProblem(error) });
    }
  };

  private clearTimer = (taskId: string): void => {
    const handle = this.timers.get(taskId);
    if (handle === undefined) return;
    this.clock.clearTimeout(handle);
    this.timers.delete(taskId);
  };

  private commit = (entry: DecisionWindowEntry): void => {
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
      try { listener(); } catch { /* observers must not break the window */ }
    }
  };
}

function asProblem(error: unknown): Problem {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { code: typeof code === 'string' ? code : 'DECISION_FAILED', message: error.message };
  }
  return { code: 'DECISION_FAILED', message: String(error) };
}