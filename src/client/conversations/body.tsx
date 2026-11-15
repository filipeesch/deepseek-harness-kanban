import React, { Component, useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { SubagentTarget } from '../drawer-navigation.js';
import type { ConversationLeaseState } from '../conversation-leases.js';
import type { ConversationSurfaceMode } from '../conversation-surface.js';
import { useOptionalConversationLeases } from '../conversation-lease-context.js';

/** Read one conversation's lease when a scope exists; an isolated harness reads nothing. */
function useOptionalLeaseState(leases: { subscribe(listener: () => void): () => void; getSnapshot(): Readonly<Record<string, ConversationLeaseState>> } | null, sessionId: string): ConversationLeaseState | undefined {
  const subscribe = useCallback((listener: () => void) => leases === null ? () => {} : leases.subscribe(listener), [leases]);
  const getSnapshot = useCallback(() => leases === null ? undefined : leases.getSnapshot()[sessionId], [leases, sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface ConversationBodyProps {
  readonly active: string;
  /** The task conversation the panel is labelled by; absent when no conversation is open. */
  readonly root?: string | undefined;
  readonly id: string;
  readonly renderConversation: (sessionId: string, mode?: ConversationSurfaceMode) => ReactNode;
  /** The peeked descendant, present only while the drawer presents a peek. */
  readonly target?: SubagentTarget | undefined;
  /** Reports a peeked descendant that can no longer be retained, so the drawer can leave it. */
  readonly onUnavailable?: ((sessionId: string) => void) | undefined;
}

/**
 * Render one conversation surface inside the drawer's conversation panel.
 *
 * A peeked descendant is retained by its address only while this surface is
 * mounted, so leaving the peek releases it without touching the task's own
 * conversation leases. A descendant that cannot be retained ends the peek instead
 * of offering a retry that could never succeed.
 */
export function ConversationBody({ active, root, id, renderConversation, target, onUnavailable }: ConversationBodyProps) {
  const leases = useOptionalConversationLeases();
  const lease = useOptionalLeaseState(leases, active);
  const parentSessionId = target?.parentSessionId;
  const sessionId = target?.sessionId;
  const mode = target?.mode;
  useEffect(() => {
    if (leases === null || parentSessionId === undefined || sessionId === undefined || mode === undefined) return undefined;
    return leases.acquireTransient({ parentSessionId, childSessionId: sessionId, mode });
  }, [leases, parentSessionId, sessionId, mode]);
  const unavailable = target !== undefined && lease?.status === 'error';
  useEffect(() => {
    if (!unavailable || onUnavailable === undefined) return;
    onUnavailable(active);
  }, [unavailable, active, onUnavailable]);
  const labelledBy = root === undefined ? undefined : id + '-tab-' + root;
  return <div className="kb-conversation-panel" role="tabpanel" id={id + '-conversation'} aria-labelledby={labelledBy}>
    {target === undefined
      ? null
      : <p className="kb-visually-hidden" role="status">Showing a subagent conversation inside this task. Return with the native breadcrumb.</p>}
    <NativeBoundary key={active}>{target === undefined ? renderConversation(active) : renderConversation(active, 'peek')}</NativeBoundary>
  </div>;
}

/** Keep one failing native surface from taking the drawer down with it. */
class NativeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'Native conversation rendering failed.' }; }
  render() { return this.state.error ? <div role="alert" className="kb-error"><strong>Native conversation unavailable</strong><p>{this.state.error}</p><div className="kb-actions"><button type="button" className="kb-button" onClick={() => this.setState({ error: null })}>Retry native view</button></div></div> : this.props.children; }
}
