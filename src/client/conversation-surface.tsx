import React, { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { ISessions, SessionReference, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { InstructionDraftBinding } from './instruction-draft.js';
import type { DrawerSubagentAddress } from './conversation-navigation.js';

/** The small owner share the retained surface needs from the Main slot. */
export interface ConversationSurfaceOwner {
  SessionProvider: ComponentType<{ session: SessionReference; children: ReactNode }>;
  renderSlot(key: 'kanban.session.header' | 'kanban.conversation', owner: object): ReactNode;
}

/** Application services used by the retained conversation surface. */
export interface ConversationSurfaceServices {
  sessions: Pick<ISessions, 'refresh' | 'retain'>;
  claimComposer(sessionId: string): (() => void) | null;
  draftBinding(reference: SessionReference): InstructionDraftBinding;
  attachDraft(sessionId: string, binding: InstructionDraftBinding): () => void;
  lifetime: AbortSignal;
  hold(reference: SessionReference): void;
  release(reference: SessionReference): void;
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

/**
 * Retain one native session (or subagent address), bind the draft/composer
 * ownership, and render the hosted header above the public content factory.
 */
export function RetainedConversation({ id, target, owner, services }: {
  id: string;
  target?: DrawerSubagentAddress;
  owner: ConversationSurfaceOwner;
  services: ConversationSurfaceServices;
}) {
  const [reference, setReference] = useState<SessionReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionId = target?.childSessionId ?? id;
  const targetKey = target === undefined ? id : target.parentSessionId + ':' + target.childSessionId + ':' + target.mode;
  useEffect(() => {
    if (!reference) return;
    return services.attachDraft(sessionId, services.draftBinding(reference));
  }, [reference, sessionId, services]);
  useEffect(() => {
    let active = true; let retained: SessionReference | undefined;
    const cancellation = new AbortController();
    const signal = AbortSignal.any([cancellation.signal, services.lifetime]);
    const releaseComposer = services.claimComposer(sessionId);
    const retainTarget: SessionTarget = target === undefined ? id as SessionId : {
      parentSessionId: target.parentSessionId as SessionId,
      childSessionId: target.childSessionId as SessionId,
      mode: target.mode,
    };
    setReference(null); setError(null);
    if (!releaseComposer) { setError('This conversation already has an active Kanban composer. Close the other view first.'); return; }
    void (async () => {
      // Fresh host task sessions must first join the native Client catalog; this changes no selection.
      await services.sessions.refresh(); signal.throwIfAborted();
      retained = services.sessions.retain(retainTarget, { source: 'kanbanTaskDrawer', signal });
      services.hold(retained); await retained.ready; signal.throwIfAborted();
      if (active) setReference(retained);
    })().catch((failure: unknown) => {
      if (active && !signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      if (retained) { services.release(retained); retained = undefined; }
    });
    return () => { active = false; cancellation.abort(); if (retained) { services.release(retained); retained = undefined; } releaseComposer(); };
  }, [targetKey, sessionId, attempt, services]);
  if (error) return <div className="kanban-native-state" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry conversation</button></div>;
  if (!reference) return <div className="kanban-native-state" role="status">Opening native conversation…</div>;
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
