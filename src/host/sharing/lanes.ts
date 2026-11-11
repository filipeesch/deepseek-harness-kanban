import { AsyncLocalStorage } from 'node:async_hooks';
import { KanbanError } from '../../shared/errors.js';

/**
 * One serialized execution lane per Hub.
 *
 * Every operation for a Hub runs in submission order. A public operation started
 * from inside a lane is refused rather than queued, because it would wait for the
 * operation that is waiting for it; a caller that must reuse the lane asks for it
 * explicitly.
 */
export interface LaneRegistryOptions {
  /** Notified when a lane starts or drains, so a view can show a synchronization in flight. */
  onChange?: () => void;
}

export class LaneRegistry {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly active = new Map<string, number>();
  private readonly context = new AsyncLocalStorage<string>();
  private disposed = false;
  private readonly onChange: () => void;

  constructor(options: LaneRegistryOptions = {}) {
    this.onChange = options.onChange ?? (() => {});
  }

  /** True while any operation for this Hub is running or queued. */
  busy(hubId: string): boolean {
    return this.active.has(hubId);
  }

  /** True when the current async context already holds this Hub's lane. */
  holdsLane(hubId: string): boolean {
    return this.context.getStore() === hubId;
  }

  /** Run one operation in the lane, FIFO with everything already submitted. */
  run<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    if (this.context.getStore() !== undefined) {
      throw new KanbanError('SHARING_REENTRANT', 'A publishing operation cannot start inside another publishing operation.');
    }
    const wasIdle = !this.active.has(hubId);
    this.active.set(hubId, (this.active.get(hubId) ?? 0) + 1);
    if (wasIdle) this.onChange();
    const prior = this.tails.get(hubId) ?? Promise.resolve();
    const execution = prior.then(() => this.context.run(hubId, operation));
    this.tails.set(hubId, execution.then(() => undefined, () => undefined));
    return execution.finally(() => {
      const remaining = (this.active.get(hubId) ?? 1) - 1;
      if (remaining <= 0) {
        this.active.delete(hubId);
        this.onChange();
      } else this.active.set(hubId, remaining);
    });
  }

  /** Run one operation in the lane, re-entrant for a caller that already holds it. */
  exclusive<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    if (this.context.getStore() === hubId) return operation();
    return this.run(hubId, operation);
  }

  /** Leave the current lane's context, for work that must not be treated as re-entrant. */
  outside<T>(operation: () => T): T {
    return this.context.exit(operation);
  }

  /** Stop accepting work and wait for every lane to drain. */
  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.tails.values()]);
    this.tails.clear();
  }
}
