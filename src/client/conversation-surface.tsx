import React, { createContext, memo, useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots';
// Loads the Conversation Factory declarations, including `conversation.window`.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import { useConversationLeaseState } from './conversation-leases.js';
import { useConversationLeases } from './conversation-lease-context.js';
import { ConversationWorkspace } from './conversations/workspace.js';
import { NativeSurfaceNotice } from './native-surface-notice.js';
import type { SidebarPanelPort } from './sidebar-panel-port.js';

/** How one conversation is presented: a task conversation, or a transient descendant peek. */
export type ConversationSurfaceMode = 'conversation' | 'peek';

/** The small owner share the retained surface needs from the Main slot. */
export interface ConversationSurfaceOwner {
  SessionProvider: ComponentType<{ session: SessionReference; children: ReactNode }>;
  renderSlot(key: 'kanban.conversation', owner: object): ReactNode;
}

/** Application services used by the retained conversation surface. */
export interface ConversationSurfaceServices {
  claimComposer(sessionId: string): (() => void) | null;
}

/** The Session lifecycle fields the drawer gates on before rendering the window. */
export interface ConversationWindowSession {
  readonly openState?: string;
  readonly openError?: { readonly message?: string };
}

/** Props for the public conversation.window occurrence embedded in a task drawer. */
export interface TaskConversationWindowProps {
  sessionId: string;
  useSession: (selector: (value: ConversationWindowSession) => unknown) => unknown;
  renderFactorySlot: RenderFactorySlot;
  viewSession(sessionId: string): (() => void) | undefined;
  /** The drawer's right Sidebar port and occurrence renderer; omitted by isolated surfaces and older hosts. */
  sidebar?: {
    readonly port: SidebarPanelPort | undefined;
    readonly renderPanel: () => ReactNode;
  };
}

/**
 * The pinned SDK predates the public Factory declaration, so the window call is
 * typed locally until the DSH release that declares `conversation.window` is
 * pinned. Runtime dispatch is unchanged; remove this bridge when the release pin lands.
 */
type ConversationWindowRenderer = (
  name: 'conversation.window',
  input: { readonly variant: 'embedded' },
  options: { fallback: ReactNode },
) => ReactNode;

/** Hosts older than the release that declares `conversation.window` render this notice. */
function UnsupportedConversationWindow() {
  return <NativeSurfaceNotice title="Native conversation unavailable">
    <p>This DSH version does not provide the native conversation window. Update DSH to a release that exposes it, then reopen this conversation.</p>
  </NativeSurfaceNotice>;
}

/** The presentation of the occurrence currently rendering, provided by the retained area. */
const SurfaceModeContext = createContext<ConversationSurfaceMode>('conversation');

/** Read the presentation of the occurrence this surface renders. */
export function useConversationSurfaceMode(): ConversationSurfaceMode {
  return useContext(SurfaceModeContext);
}

/**
 * Render the host's public conversation window for one retained task Session.
 * The plugin keeps only the gates the window does not own: read tracking and
 * the open-failure report.
 * @param props - retained Session identity, standard Session source, and renderer.
 * @returns the window occurrence, or the open-failure notice.
 */
export function TaskConversationWindow({ sessionId, useSession, renderFactorySlot, viewSession, sidebar }: TaskConversationWindowProps) {
  const session = useSession(value => value) as ConversationWindowSession | undefined;
  const mode = useConversationSurfaceMode();
  useEffect(() => {
    // A peeked descendant belongs to its own conversation lineage; reading it must
    // not acknowledge a task conversation's settled turn.
    if (mode === 'peek') return undefined;
    let release: (() => void) | undefined;
    const sync = () => {
      release?.(); release = undefined;
      if (document.visibilityState !== 'hidden') release = viewSession(sessionId);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); release?.(); };
  }, [sessionId, viewSession, mode]);
  if (session?.openState === 'error') {
    return <div className="kanban-native-state" role="alert">
      Native conversation could not open: {session.openError?.message ?? 'Unknown error'}. Close and reopen this tab to retry.
    </div>;
  }
  const renderWindow = renderFactorySlot as unknown as ConversationWindowRenderer;
  const window = <div className="kb-conversation-window">
    <div data-kanban-conversation-window="">
      {renderWindow('conversation.window', { variant: 'embedded' }, { fallback: <UnsupportedConversationWindow /> })}
    </div>
  </div>;
  // A peeked descendant is transient: it keeps the window alone. Older hosts
  // have no panel port, so the drawer keeps exactly its previous markup.
  if (mode === 'peek' || sidebar?.port === undefined) return window;
  return <ConversationWorkspace sessionId={sessionId} port={sidebar.port} renderPanel={sidebar.renderPanel}>{window}</ConversationWorkspace>;
}

function RetainedConversationView({ id, owner, services, mode }: {
  id: string;
  owner: ConversationSurfaceOwner;
  services: ConversationSurfaceServices;
  mode?: ConversationSurfaceMode;
}) {
  const leases = useConversationLeases();
  const lease = useConversationLeaseState(leases, id);
  const [claimError, setClaimError] = useState<string | null>(null);
  useEffect(() => {
    const releaseComposer = services.claimComposer(id);
    if (!releaseComposer) {
      setClaimError('This conversation already has an active Kanban composer. Close the other view first.');
      return undefined;
    }
    setClaimError(null);
    // A peeked descendant is retained transiently by the surface that shows it.
    if (mode !== 'peek') leases.acquireRoot(id);
    return releaseComposer;
  }, [leases, id, services, mode]);
  if (claimError !== null) return <div className="kanban-native-state" role="alert">{claimError}</div>;
  if (lease?.status === 'error') return <div className="kanban-native-state"><div role="alert">{lease.error ?? 'The native conversation could not open.'}</div><div className="kb-actions"><button type="button" onClick={() => leases.retry(id)}>Retry conversation</button></div></div>;
  if (lease?.reference === undefined) return <div className="kanban-native-state"><span role="status">Opening native conversation…</span></div>;
  const reference = lease.reference;
  const Provider = owner.SessionProvider;
  return <SurfaceModeContext.Provider value={mode ?? 'conversation'}>
    <Provider session={reference}>
      <div className="kb-session-frame">
        {owner.renderSlot('kanban.conversation', {})}
      </div>
    </Provider>
  </SurfaceModeContext.Provider>;
}

/**
 * Retain one native Session through the drawer lease scope and render the
 * hosted conversation window inside that Session area.
 *
 * A peeked descendant is addressed by `mode: 'peek'`: it keeps the same window
 * and composer gates, but it is not acknowledged as a task conversation.
 */
export const RetainedConversation = memo(RetainedConversationView);
