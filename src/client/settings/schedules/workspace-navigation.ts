/** The native workspace surface needed to reveal a scheduled conversation. */
export interface WorkspaceNavigationPort {
  openSession(target: never): void;
  unarchiveSession?(sessionId: never): Promise<void>;
}

/**
 * Reveal one conversation, unarchiving it first when the host supports that.
 * A missing host surface yields no navigation at all, so the caller can render
 * the conversation identity instead of a dead action.
 */
export function createWorkspaceNavigation(workspace: WorkspaceNavigationPort | undefined): ((sessionId: string) => void) | undefined {
  const open = workspace?.openSession;
  if (open === undefined) return undefined;
  const unarchive = workspace?.unarchiveSession?.bind(workspace);
  return (sessionId: string) => {
    void (async () => {
      if (unarchive !== undefined) {
        try { await unarchive(sessionId as never); } catch { /* the conversation may already be visible */ }
      }
      open.call(workspace, sessionId as never);
    })();
  };
}
