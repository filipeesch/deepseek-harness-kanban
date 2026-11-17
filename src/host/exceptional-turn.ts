import type { ExceptionalTransitionIdentity } from '../domain/transition-route.js';

export interface ExceptionalTurnPorts {
  /** Resolve the owning task even if this conversation was just closed. */
  taskForSession(sessionId: string): string | undefined;
  /** Whether the declaration and entry match and the owning conversation is still open. */
  matches(taskId: string, identity: ExceptionalTransitionIdentity): boolean;
  /** Serialized admission; its predicate expires when this observation loses ownership. */
  admit(taskId: string, identity: ExceptionalTransitionIdentity, isObserved: () => boolean): Promise<unknown>;
  /** Conditional cleanup must compare the unique declaration identity. */
  expire(taskId: string, exceptionId: string): Promise<void>;
  /** Cancel older task-wide automatic triggers when the owner completes. */
  ownerCompleted?(taskId: string): void;
  report(error: unknown): void;
}

interface Entry { identity: ExceptionalTransitionIdentity; state: 'open' | 'completed' }

/** Live-only observations; persisted exceptions are deliberately not restored. */
export class ExceptionalTurnObserver {
  private readonly entries = new Map<string, Entry>();
  private readonly handled = new Set<string>();
  private disposed = false;
  constructor(private readonly ports: ExceptionalTurnPorts) {}

  /** A live declaration can be consumed only while this process owns its token. */
  state(taskId: string, exceptionId: string): 'open' | 'completed' | undefined {
    const entry = this.entries.get(taskId);
    return !this.disposed && entry?.identity.id === exceptionId ? entry.state : undefined;
  }

  owns(taskId: string, exceptionId: string): boolean {
    return this.state(taskId, exceptionId) !== undefined;
  }

  /** Called only after the corresponding verified declaration commits. */
  register(taskId: string, identity: ExceptionalTransitionIdentity): void {
    if (!this.disposed) this.entries.set(taskId, { identity, state: 'open' });
  }

  /** Returns true when the owner boundary belongs exclusively to this admission. */
  observe(sessionId: string, event: unknown): boolean {
    if (this.disposed || typeof event !== 'object' || event === null) return false;
    const value = event as { type?: unknown; seq?: unknown; data?: { turn?: unknown; reason?: { kind?: unknown } } };
    const eventTurn = value.data?.turn;
    const key = value.type === 'turn/end' && Number.isSafeInteger(eventTurn) ? sessionId + ':' + eventTurn : undefined;
    if (key !== undefined && this.handled.has(key)) return true;
    const taskId = this.ports.taskForSession(sessionId);
    const entry = taskId === undefined ? undefined : this.entries.get(taskId);
    if (!taskId || !entry) return false;
    if (entry.identity.sessionId !== sessionId) {
      // Another conversation keeps the ordinary coordinator's existing timing.
      // After the owner completes, fresh activity also invalidates admission.
      if (entry.state === 'completed') this.expire(taskId, entry);
      return false;
    }
    // Once the owner completed, further activity invalidates its idle snapshot.
    if (entry.state === 'completed' && value.type !== 'turn/end') {
      this.expire(taskId, entry);
      return false;
    }
    if (value.type !== 'turn/start' && value.type !== 'turn/end') return false;
    if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0) { this.expire(taskId, entry); return false; }
    let matches = false;
    try { matches = this.ports.matches(taskId, entry.identity); } catch (error) { this.ports.report(error); }
    if (!matches) { this.expire(taskId, entry); return false; }
    const turn = value.data?.turn;
    // A delayed duplicate of an older turn cannot invalidate its replacement.
    if (Number.isSafeInteger(turn) && (turn as number) < entry.identity.turn) return false;
    if (!Number.isSafeInteger(turn) || (turn as number) !== entry.identity.turn) {
      this.expire(taskId, entry);
      return false;
    }
    if (value.type === 'turn/start') return false;
    if (entry.state !== 'open') return true;
    if (value.data?.reason?.kind !== 'completed') {
      this.expire(taskId, entry);
      return false;
    }
    if (key !== undefined) this.remember(key);
    entry.state = 'completed';
    // An older task-wide trigger must not race this exact owner completion.
    this.ports.ownerCompleted?.(taskId);
    const isObserved = () => !this.disposed && this.entries.get(taskId) === entry && entry.state === 'completed';
    void this.ports.admit(taskId, entry.identity, isObserved).catch(error => this.ports.report(error)).finally(() => {
      if (this.entries.get(taskId) === entry) this.entries.delete(taskId);
    });
    return true;
  }

  /** Forget a live owner and expire only that declaration, never a replacement. */
  forget(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry) this.expire(taskId, entry);
  }

  dispose(): void { this.disposed = true; this.entries.clear(); this.handled.clear(); }

  private remember(key: string): void {
    this.handled.add(key);
    if (this.handled.size > 1024) this.handled.delete(this.handled.values().next().value!);
  }

  private expire(taskId: string, entry: Entry): void {
    if (this.entries.get(taskId) !== entry) return;
    this.entries.delete(taskId);
    void this.ports.expire(taskId, entry.identity.id).catch(error => this.ports.report(error));
  }
}
