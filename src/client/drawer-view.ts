/** The drawer's conversation view and its pure transitions. */
import type { SubagentTarget } from './drawer-navigation.js';

/**
 * What the Conversations section presents.
 *
 * A conversation view renders one of the task's retained conversations; a peek
 * view renders an owned subagent descendant instead, keeping the conversation
 * tab it was opened from active. View state is never written to the task.
 */
export type DrawerView =
  | {
    readonly kind: 'conversation';
    readonly sessionId: string | null;
    /** A failed creation left the selection unproven; disable the implicit fallback. */
    readonly selectionRequired: boolean;
  }
  | {
    readonly kind: 'peek';
    readonly conversationId: string | null;
    readonly selectionRequired: boolean;
    readonly target: SubagentTarget;
  };

/** A fork the drawer asked the host to attach as a conversation of the task. */
export interface ForkClaim {
  readonly sessionId: string;
  /** The failure the host reported; absent while the claim is still pending. */
  readonly error?: string;
}

export const EMPTY_DRAWER_VIEW: DrawerView = Object.freeze({ kind: 'conversation', sessionId: null, selectionRequired: false });

/** The active top-level conversation the drawer keeps in view. */
export function conversationOf(view: DrawerView): string | null {
  return view.kind === 'conversation' ? view.sessionId : view.conversationId;
}

/** The peeked descendant, or null while a conversation is presented. */
export function peekOf(view: DrawerView): SubagentTarget | null {
  return view.kind === 'peek' ? view.target : null;
}

/** Whether the implicit fallback to the first conversation is disabled. */
export function selectionRequiredOf(view: DrawerView): boolean {
  return view.selectionRequired;
}

/** Present one conversation tab and end any peek. */
export function selectConversation(view: DrawerView, sessionId: string | null): DrawerView {
  if (view.kind === 'conversation' && view.sessionId === sessionId) return view;
  return { kind: 'conversation', sessionId, selectionRequired: false };
}

/** Mark the presented conversation as explicitly required after an unsafe creation receipt. */
export function requireSelection(view: DrawerView): DrawerView {
  return view.selectionRequired ? view : { ...view, selectionRequired: true };
}

/**
 * Keep the presented conversation while it is open. When it disappeared, fall
 * back to the first open conversation only if the drawer allows it, preserving
 * the explicit-selection requirement either way.
 */
export function resolveConversation(view: DrawerView, open: readonly string[], fallbackAllowed: boolean): DrawerView {
  const selected = conversationOf(view);
  if (selected !== null && open.includes(selected)) return view;
  const next = fallbackAllowed ? open[0] ?? null : null;
  if (view.kind === 'conversation' && view.sessionId === next) return view;
  return { kind: 'conversation', sessionId: next, selectionRequired: view.selectionRequired };
}

/** Show an owned descendant in place of the active conversation body. */
export function openPeek(view: DrawerView, target: SubagentTarget): DrawerView {
  const conversationId = conversationOf(view);
  if (view.kind === 'peek' && view.target.sessionId === target.sessionId && view.target.parentSessionId === target.parentSessionId) return view;
  return { kind: 'peek', conversationId, selectionRequired: view.selectionRequired, target };
}

/** Return from a peek to the conversation it replaced. */
export function endPeek(view: DrawerView): DrawerView {
  if (view.kind === 'conversation') return view;
  return { kind: 'conversation', sessionId: view.conversationId, selectionRequired: view.selectionRequired };
}

/** Record the fork the drawer claimed; the host is attaching it. */
export function beginClaim(sessionId: string): ForkClaim {
  return { sessionId };
}

/** Record the host's failure for a claimed fork; the claim stays visible until dismissed. */
export function failClaim(claim: ForkClaim, message: string): ForkClaim {
  return { ...claim, error: message };
}
