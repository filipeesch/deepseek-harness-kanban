export interface OperationQueueJob {
  /** Slow context work is serialized inside a lane and may overlap across lanes. */
  lane: string;
  /** The entity that owns the journal: a task id or a project id. */
  ownerId: string;
  operationId: string;
  run: () => Promise<void>;
}

interface Lane {
  pending: OperationQueueJob[];
  running: Promise<void> | undefined;
}

/**
 * FIFO host queue for destructive context operations with one lane per
 * repository. Each lane runs at most one job, so Git worktree metadata is never
 * touched twice at once while unrelated repositories keep making progress. The
 * queue never holds the command path: callers enqueue and return.
 */
export class OperationQueue {
  private readonly lanes = new Map<string, Lane>();
  private readonly keys = new Set<string>();
  private readonly idleWaiters: Array<() => void> = [];
  private disposed = false;

  get size(): number {
    let total = 0;
    for (const lane of this.lanes.values()) total += lane.pending.length + (lane.running ? 1 : 0);
    return total;
  }

  /** Returns false when the queue is disposed; a duplicate operation is already queued and returns true. */
  enqueue(job: OperationQueueJob): boolean {
    if (this.disposed) return false;
    const key = job.ownerId + ':' + job.operationId;
    if (this.keys.has(key)) return true;
    this.keys.add(key);
    this.laneFor(job.lane).pending.push(job);
    this.drain(job.lane);
    return true;
  }

  /** Stop accepting work and prevent not-yet-started jobs from running. */
  dispose(): void {
    this.disposed = true;
    // Queued jobs are dropped, but a running job stays counted so `settle()`
    // still waits for it before shutdown reports completion.
    for (const lane of this.lanes.values()) lane.pending.length = 0;
    this.keys.clear();
    this.settleIdle();
  }

  /** Resolve once every lane is idle and no queued job remains. */
  settle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise<void>(resolve => { this.idleWaiters.push(resolve); });
  }

  private laneFor(name: string): Lane {
    let lane = this.lanes.get(name);
    if (!lane) { lane = { pending: [], running: undefined }; this.lanes.set(name, lane); }
    return lane;
  }

  private drain(name: string): void {
    const lane = this.lanes.get(name);
    if (!lane || lane.running) return;
    if (this.disposed) { lane.pending.length = 0; this.forget(name, lane); this.settleIdle(); return; }
    const job = lane.pending.shift();
    if (!job) { this.forget(name, lane); this.settleIdle(); return; }
    lane.running = Promise.resolve().then(() => job.run()).catch(() => {}).finally(() => {
      lane.running = undefined;
      this.keys.delete(job.ownerId + ':' + job.operationId);
      this.drain(name);
      this.settleIdle();
    });
  }

  private forget(name: string, lane: Lane): void {
    if (lane.pending.length > 0 || lane.running) return;
    if (this.lanes.get(name) === lane) this.lanes.delete(name);
  }

  private settleIdle(): void {
    if (this.size > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
