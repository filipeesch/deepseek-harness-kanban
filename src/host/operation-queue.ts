export interface OperationQueueJob {
  taskId: string;
  operationId: string;
  run: () => Promise<void>;
}

/**
 * FIFO host queue for destructive context operations. Execution is serial so
 * Git worktree metadata, native archives, and workspace cleanup are never
 * touched by two destructive operations at once. The queue never holds the
 * command path: callers enqueue and return.
 */
export class OperationQueue {
  private readonly pending: OperationQueueJob[] = [];
  private readonly keys = new Set<string>();
  private readonly idleWaiters: Array<() => void> = [];
  private running: Promise<void> | undefined;
  private disposed = false;

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  /** Returns false when the queue is disposed; a duplicate operation is already queued and returns true. */
  enqueue(job: OperationQueueJob): boolean {
    if (this.disposed) return false;
    const key = job.taskId + ':' + job.operationId;
    if (this.keys.has(key)) return true;
    this.keys.add(key);
    this.pending.push(job);
    this.drain();
    return true;
  }

  /** Stop accepting work and prevent not-yet-started jobs from running. */
  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
    this.keys.clear();
    this.settleIdle();
  }

  /** Resolve once the running job and every queued job have finished. */
  settle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise<void>(resolve => { this.idleWaiters.push(resolve); });
  }

  private drain(): void {
    if (this.running) return;
    if (this.disposed) { this.pending.length = 0; this.settleIdle(); return; }
    const job = this.pending.shift();
    if (!job) { this.settleIdle(); return; }
    this.running = job.run().catch(() => {}).finally(() => {
      this.running = undefined;
      this.keys.delete(job.taskId + ':' + job.operationId);
      this.drain();
    });
  }

  private settleIdle(): void {
    if (this.running || this.pending.length > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
