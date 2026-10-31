import React, { memo, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { DrawerSubagentAddress } from './conversation-navigation.js';
import { ConversationCloseAction } from './conversation-actions.js';
import { useConversationLeaseState } from './conversation-leases.js';
import { useConversationLeases } from './conversation-lease-context.js';

/** The small owner share the retained surface needs from the Main slot. */
export interface ConversationSurfaceOwner {
  SessionProvider: ComponentType<{ session: SessionReference; children: ReactNode }>;
  renderSlot(key: 'kanban.session.header' | 'kanban.conversation', owner: object): ReactNode;
}

/** Application services used by the retained conversation surface. */
export interface ConversationSurfaceServices {
  claimComposer(sessionId: string): (() => void) | null;
}

/** Props for the public conversation.content occurrence embedded in a task drawer. */
export interface EmbeddedConversationBodyProps {
  sessionId: string;
  useSession: (selector: (value: { openState?: string; openError?: { message?: string } }) => unknown) => unknown;
  renderFactorySlot: (name: string, input: unknown, options: unknown) => ReactNode;
  viewSession(sessionId: string): (() => void) | undefined;
}

function FixedChat(props: ConversationViewsProps) {
  return props.renderSlot('conversation.session', { view: 'chat' });
}

/** Render the shared native content factory for one task conversation. */
export function EmbeddedConversationBody({ sessionId, useSession, renderFactorySlot, viewSession }: EmbeddedConversationBodyProps) {
  const session = useSession(value => value) as { openState?: string; openError?: { message?: string } } | undefined;
  useEffect(() => {
    let release: (() => void) | undefined;
    const sync = () => {
      release?.(); release = undefined;
      if (document.visibilityState !== 'hidden') release = viewSession(sessionId);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); release?.(); };
  }, [sessionId, viewSession]);
  if (session?.openState === 'error') return <div className="kanban-native-state" role="alert">Native conversation could not open: {session.openError?.message ?? 'Unknown error'}. Close and reopen this tab to retry.</div>;
  // A task already owns an explicit session and cwd; the main-workspace hero would disable its composer.
  return renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: session?.openState !== 'open' ? 'settling' : 'active', hero: false,
  }, { slots: { views: FixedChat } });
}

function RetainedConversationView({ id, target, owner, services }: {
  id: string;
  target?: DrawerSubagentAddress;
  owner: ConversationSurfaceOwner;
  services: ConversationSurfaceServices;
}) {
  const leases = useConversationLeases();
  const sessionId = target?.childSessionId ?? id;
  const targetKey = target === undefined ? id : target.parentSessionId + ':' + target.childSessionId + ':' + target.mode;
  const lease = useConversationLeaseState(leases, sessionId);
  const [claimError, setClaimError] = useState<string | null>(null);
  useEffect(() => {
    const releaseComposer = services.claimComposer(sessionId);
    if (!releaseComposer) {
      setClaimError('This conversation already has an active Kanban composer. Close the other view first.');
      return undefined;
    }
    setClaimError(null);
    // Acquisition follows a successful claim: a refused duplicate never pins a Session it cannot render.
    const releaseLease = target === undefined ? (leases.acquireRoot(id), undefined) : leases.acquirePeek(target);
    return () => {
      releaseLease?.();
      releaseComposer();
    };
    // targetKey describes the entire address; keeping the object out avoids re-acquiring on identity churn.
  }, [leases, id, targetKey, sessionId, services]);
  if (claimError !== null) return <div className="kanban-native-state"><div role="alert">{claimError}</div><div className="kb-actions"><ConversationCloseAction /></div></div>;
  if (lease?.status === 'error') return <div className="kanban-native-state"><div role="alert">{lease.error ?? 'The native conversation could not open.'}</div><div className="kb-actions"><button type="button" onClick={() => leases.retry(target ?? id)}>Retry conversation</button><ConversationCloseAction /></div></div>;
  if (lease?.reference === undefined) return <div className="kanban-native-state"><span role="status">Opening native conversation…</span> <ConversationCloseAction /></div>;
  const reference = lease.reference;
  const Provider = owner.SessionProvider;
  return <Provider session={reference}>
    <div className="kb-session-frame">
      {owner.renderSlot('kanban.session.header', {})}
      <div className="kb-native-conversation">
        {owner.renderSlot('kanban.conversation', {})}
      </div>
    </div>
  </Provider>;
}

/**
 * Retain one native session (or subagent address) through the drawer lease scope
 * and render the hosted header above the public content factory. The native
 * content owns history settling and open-failure presentation.
 */
export const RetainedConversation = memo(RetainedConversationView);
