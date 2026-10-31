/**
 * Coalesces Host publication requests into at most one publication per window.
 * The first request after a quiet period publishes immediately; a dirty state
 * left at the end of a window publishes on the trailing edge, so a burst of
 * Session events can never drop the final state.
 */
export interface PublishSchedulerOptions {
  publish: () => void;
  windowMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const DEFAULT_WINDOW_MS = 50;

export class PublishScheduler {
  private readonly windowMs: number;
  private readonly schedule: (run: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private timer: unknown;
  private windowOpen = false;
  private dirty = false;
  private disposed = false;

  constructor(private readonly options: PublishSchedulerOptions) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
    this.cancel = options.cancel ?? (handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); });
  }

  /** Mark the Host state dirty and publish within the current or next window. */
  request(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.windowOpen) this.openWindow();
  }

  /** Publish a dirty state now and close the current window. */
  flush(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    this.windowOpen = false;
    this.deliver();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    this.windowOpen = false;
    this.dirty = false;
  }

  private openWindow(): void {
    this.windowOpen = true;
    this.deliver();
    this.timer = this.schedule(() => {
      this.timer = undefined;
      this.windowOpen = false;
      if (this.dirty) this.openWindow();
    }, this.windowMs);
  }

  private deliver(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.options.publish();
  }
}
