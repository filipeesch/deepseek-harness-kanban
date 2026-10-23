export type DraftResult = 'applied' | 'preserved' | 'blocked' | 'unavailable';

/** Narrow native-composer face used by the drawer prefill; the SDK adapter supplies it. */
export interface InstructionDraftBinding {
  requestDraftInitialization(options: { prompt: string; clearPreviousDraft?: boolean }): DraftResult;
  focus(): void;
  attachmentIds(): readonly string[];
  removeAttachment(id: string): boolean;
}

export interface InstructionDraftPort {
  /** Insert into an attached conversation, or wait until that conversation mounts. */
  prepare(sessionId: string, text: string, signal: AbortSignal): Promise<DraftResult>;
  /** Replace existing text and attachments with the stage instruction. */
  replace(sessionId: string, text: string, signal: AbortSignal): Promise<DraftResult>;
  /** Attach a retained conversation binding; returns a detach disposer. */
  attach(sessionId: string, binding: InstructionDraftBinding): () => void;
}

interface PendingDraft {
  text: string;
  replace: boolean;
  signal: AbortSignal;
  resolve(result: DraftResult): void;
  onAbort(): void;
}

/** Small application service over the native draft API; no SDK types leak to the drawer. */
export class InstructionDraftPortImpl implements InstructionDraftPort {
  private readonly bindings = new Map<string, InstructionDraftBinding>();
  private readonly pending = new Map<string, PendingDraft[]>();

  attach(sessionId: string, binding: InstructionDraftBinding): () => void {
    this.bindings.set(sessionId, binding);
    this.flush(sessionId);
    return () => { if (this.bindings.get(sessionId) === binding) this.bindings.delete(sessionId); };
  }

  prepare(sessionId: string, text: string, signal: AbortSignal): Promise<DraftResult> {
    return this.enqueue(sessionId, text, false, signal);
  }

  replace(sessionId: string, text: string, signal: AbortSignal): Promise<DraftResult> {
    return this.enqueue(sessionId, text, true, signal);
  }

  private enqueue(sessionId: string, text: string, replace: boolean, signal: AbortSignal): Promise<DraftResult> {
    if (signal.aborted) return Promise.resolve('unavailable');
    const binding = this.bindings.get(sessionId);
    if (binding) return Promise.resolve(this.apply(binding, text, replace));
    return new Promise(resolve => {
      const entry: PendingDraft = {
        text, replace, signal, resolve,
        onAbort: () => {
          const list = this.pending.get(sessionId);
          if (list) {
            const index = list.indexOf(entry);
            if (index >= 0) list.splice(index, 1);
            if (list.length === 0) this.pending.delete(sessionId);
          }
          resolve('unavailable');
        },
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      const list = this.pending.get(sessionId) ?? [];
      list.push(entry);
      this.pending.set(sessionId, list);
    });
  }

  private flush(sessionId: string): void {
    const list = this.pending.get(sessionId);
    if (!list) return;
    this.pending.delete(sessionId);
    const binding = this.bindings.get(sessionId);
    for (const entry of list) {
      entry.signal.removeEventListener('abort', entry.onAbort);
      if (!binding || entry.signal.aborted) { entry.resolve('unavailable'); continue; }
      entry.resolve(this.apply(binding, entry.text, entry.replace));
    }
  }

  private apply(binding: InstructionDraftBinding, text: string, replace: boolean): DraftResult {
    if (replace) {
      // The native initialization is authoritative and checks detached drafts,
      // in-flight attachments, and submission locks before changing text. Do not
      // remove attachments until it has applied; a blocked request must write nothing.
      const result = binding.requestDraftInitialization({ prompt: text, clearPreviousDraft: true });
      if (result !== 'applied') return result;
      let removed = true;
      for (const id of [...binding.attachmentIds()]) {
        try { if (!binding.removeAttachment(id)) removed = false; }
        catch { removed = false; }
      }
      if (!removed) return 'blocked';
      this.focus(binding);
      return 'applied';
    }
    const result = binding.requestDraftInitialization({ prompt: text });
    if (result === 'applied') this.focus(binding);
    return result;
  }

  private focus(binding: InstructionDraftBinding): void {
    try { binding.focus(); } catch { /* focus is best effort */ }
  }
}
