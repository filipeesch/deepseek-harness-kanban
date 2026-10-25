import type { ModeOption, ModePort } from './mode-port.js';

export type ModeSeatError = string | { readonly preset: ModeOption; readonly reason: string };

export interface ModeSeatState {
  readonly options: readonly ModeOption[];
  readonly current: string;
  readonly error: ModeSeatError | null;
  readonly busy: boolean;
  readonly introduce: boolean;
}

const INITIAL: ModeSeatState = Object.freeze({ options: [], current: '', error: null, busy: false, introduce: false });

/**
 * State for the hosted native agent-preset seat. It reads the native roster,
 * selects the exact blank session, and never stores a task-level default.
 */
export class ModeSeatController {
  private state: ModeSeatState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private loadGeneration = 0;
  private pendingLoad: Promise<void> | undefined;

  constructor(
    private readonly port: ModePort,
    private readonly sessionId: string,
    private readonly currentPreset: () => string | undefined,
  ) {}

  getSnapshot = (): ModeSeatState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private set(patch: Partial<ModeSeatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Read the roster once while a read is in flight; the newest completed read publishes. */
  load(): Promise<void> {
    if (this.pendingLoad !== undefined) return this.pendingLoad;
    const generation = ++this.loadGeneration;
    this.set({ busy: true, error: null });
    const pending = this.loadNow(generation);
    this.pendingLoad = pending;
    void pending.finally(() => { if (this.pendingLoad === pending) this.pendingLoad = undefined; });
    return pending;
  }

  private async loadNow(generation: number): Promise<void> {
    try {
      const options = await this.port.list();
      if (generation !== this.loadGeneration) return;
      const current = this.currentPreset() || options.find(option => option.isDefault)?.id || options[0]?.id || '';
      this.set({ options, current, busy: false, error: null });
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.set({ options: [], busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Select one mode for this exact session; refusal returns the native reason. */
  async select(id: string): Promise<string | undefined> {
    if (this.state.busy) return undefined;
    const previous = this.state.current;
    this.set({ busy: true, error: null, current: id });
    try {
      const result = await this.port.select(this.sessionId, id);
      if (result.ok) {
        this.set({ busy: false, current: result.id ?? id, error: null });
        return undefined;
      }
      const preset = this.state.options.find(option => option.id === id) ?? { id };
      this.set({ busy: false, current: previous, error: { preset, reason: result.message ?? 'The native agent preset selection was refused.' } });
      return result.message ?? 'The native agent preset selection was refused.';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const preset = this.state.options.find(option => option.id === id) ?? { id };
      this.set({ busy: false, current: previous, error: { preset, reason } });
      return reason;
    }
  }

  /** Acknowledge the native refusal after its Toast ends. */
  dismissRefusal(refusal: ModeSeatError): void {
    if (refusal !== null && typeof refusal === 'object' && this.state.error === refusal) this.set({ error: null });
  }

  /** Acknowledge the one-shot introduction cue. */
  introduced(): void {
    if (this.state.introduce) this.set({ introduce: false });
  }
}
