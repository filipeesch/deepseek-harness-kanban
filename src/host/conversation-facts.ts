import type { Session } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';

/** The conversation facts derivable from event folds without reading a Session log. */
export interface ConversationFactsFold {
  readonly lastTurnEndSeq: number | null;
  readonly lastTurnOutcome: 'ok' | 'error' | null;
  readonly openApprovalIds: readonly string[];
}

/** Reads the registered fold for one live Session and releases its registration. */
export interface ConversationFactsReader {
  read(session: Session): ConversationFactsFold | undefined;
  dispose(): void;
}

export const CONVERSATION_FACTS_KEY = 'kanbanConversationFacts';

const conversationFactsSchema = z.object({
  lastTurnEndSeq: z.number().int().nonnegative().nullable(),
  lastTurnOutcome: z.union([z.literal('ok'), z.literal('error')]).nullable(),
  openApprovalIds: z.array(z.string()),
});

const INITIAL: ConversationFactsFold = Object.freeze({ lastTurnEndSeq: null, lastTurnOutcome: null, openApprovalIds: [] });

interface FactsEvent { readonly type: string; readonly seq: number; readonly data: unknown }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function approvalId(event: FactsEvent): string | undefined {
  const data = record(event.data) ? event.data : undefined;
  return data !== undefined && typeof data.id === 'string' ? data.id : undefined;
}

/** Fold the settled-turn and approval facts from one committed event. */
export function applyConversationFacts(state: ConversationFactsFold, raw: FactsEvent): ConversationFactsFold {
  if (raw.type === 'turn/end') {
    const data = record(raw.data) ? raw.data : undefined;
    const reason = data !== undefined && record(data.reason) ? data.reason : undefined;
    return {
      lastTurnEndSeq: raw.seq,
      lastTurnOutcome: reason?.kind === 'error' ? 'error' : 'ok',
      openApprovalIds: [],
    };
  }
  if (raw.type === 'approval/asked') {
    const id = approvalId(raw);
    if (id === undefined || state.openApprovalIds.includes(id)) return state;
    return { ...state, openApprovalIds: [...state.openApprovalIds, id] };
  }
  if (raw.type === 'approval/decided') {
    const id = approvalId(raw);
    if (id === undefined || !state.openApprovalIds.includes(id)) return state;
    return { ...state, openApprovalIds: state.openApprovalIds.filter(value => value !== id) };
  }
  return state;
}

interface LooseProjectionRegistry {
  register(definition: unknown): unknown;
  stateOf(session: Session, key: string): unknown;
}

/** Release the pinned registration handle (a disposer) or the newer awaited handle. */
function disposeRegistration(registration: unknown): void {
  try {
    if (typeof registration === 'function') {
      const pending = (registration as () => unknown)();
      if (pending !== null && pending !== undefined && typeof (pending as Promise<void>).then === 'function') {
        void (pending as Promise<void>).catch(() => undefined);
      }
      return;
    }
    const handle = registration as { dispose?: () => unknown } | undefined;
    const pending = handle?.dispose?.();
    if (pending !== null && pending !== undefined && typeof (pending as Promise<void>).then === 'function') {
      void (pending as Promise<void>).catch(() => undefined);
    }
  } catch {
    /* A released registration is already gone. */
  }
}

function projectionRegistry(ctx: Context): LooseProjectionRegistry | undefined {
  try {
    const service = (ctx as unknown as { get?: (name: string) => unknown }).get?.('sessionProjections');
    return service as LooseProjectionRegistry | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Register the host-only conversation-facts fold. The unit declares no wire
 * view, so its state never enters client payloads.
 * @returns the reader used by the native facts port; reads are `undefined` when the registry is absent.
 */
export function registerConversationFacts(ctx: Context): ConversationFactsReader {
  const registry = projectionRegistry(ctx);
  if (registry === undefined) return { read: () => undefined, dispose: () => {} };
  const registration = registry.register({
    key: CONVERSATION_FACTS_KEY,
    stateSchema: conversationFactsSchema,
    init: () => INITIAL,
    apply: applyConversationFacts,
    stateVersion: 1,
  });
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeRegistration(registration);
    },
    read(session: Session): ConversationFactsFold | undefined {
      try {
        const value = registry.stateOf(session, CONVERSATION_FACTS_KEY);
        const parsed = conversationFactsSchema.safeParse(value);
        return parsed.success ? parsed.data : undefined;
      } catch {
        // A failed projection read degrades to the history inspection fallback.
        return undefined;
      }
    },
  };
}
