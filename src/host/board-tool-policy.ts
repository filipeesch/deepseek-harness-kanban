import { deniedMcpTools } from '../domain/mcp-allowlist.js';

/** One live agent, as far as a tool policy needs to know it. */
export interface PolicyAgent { readonly session: { readonly id: unknown } }

/** Where a board's allowlist is read: a task conversation's board, or no policy at all. */
export interface BoardPolicySource {
  /** The board's allowlist, or `undefined` when this session belongs to no board or the board names none. */
  allowlist(sessionId: string): readonly string[] | undefined;
}

export interface BoardToolPolicyDeps {
  readonly policy: BoardPolicySource;
  /** Every tool name the application scope has registered, including each MCP server's tools. */
  catalog(): readonly string[];
  /** Apply one deny mask inside the agent's own scope and return its exact disposer. */
  restrict(agent: PolicyAgent, deny: readonly string[]): () => void;
  /** Report a defect; a lifecycle listener must never throw into the host. */
  report?(error: unknown): void;
}

export interface BoardToolPolicy {
  /** Apply the board's mask to one live agent, replacing whatever mask the session already held. */
  track(agent: PolicyAgent): void;
  /** Lift this exact agent's mask when it is disposed; a replaced agent's mask is left alone. */
  forget(agent: PolicyAgent): void;
  /** Recompute every tracked mask, e.g. after the tool catalog changed. */
  refresh(): void;
  dispose(): void;
}

interface HeldMask {
  /** The exact agent instance the mask was applied to. */
  readonly agent: PolicyAgent;
  /**
   * The allowlist the agent started with. A board edit must not change a running
   * agent, so a catalog refresh reapplies this snapshot instead of rereading the
   * board.
   */
  readonly allowlist: readonly string[];
  /** The deny set currently applied, so an unchanged set is not re-applied. */
  readonly deny: readonly string[];
  /** Absent when the board allowed every currently registered MCP tool. */
  readonly release?: () => void;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/**
 * Mask the MCP tools a board does not allow. The policy owns one namespace only:
 * it denies MCP tools and never names a product tool, so a preset's own product
 * policy and this board policy cannot intersect into an empty tool set. The deny
 * set is computed from the live catalog, never from a stored list, so a server
 * that is disconnected is a no-op rather than a failure, and a server that
 * connects later is masked on the next refresh.
 *
 * One mask is kept per session. A preset that recomposes an agent replaces it:
 * tracking the replacement lifts the previous mask first, and a disposal notice
 * for the replaced instance cannot lift the replacement's mask.
 */
export function createBoardToolPolicy(deps: BoardToolPolicyDeps): BoardToolPolicy {
  const held = new Map<string, HeldMask>();
  let disposed = false;
  // Applying or lifting a mask emits the registry's own change notification, so a
  // listener on it reenters this policy. One guard keeps a single mutation from
  // recursing through its own effect.
  let mutating = false;
  const mutate = (run: () => void): void => {
    if (mutating || disposed) return;
    mutating = true;
    try { run(); } finally { mutating = false; }
  };

  const release = (sessionId: string): void => {
    const mask = held.get(sessionId);
    if (mask === undefined) return;
    held.delete(sessionId);
    try { mask.release?.(); } catch (error) { deps.report?.(error); }
  };

  const apply = (agent: PolicyAgent, allowlist: readonly string[]): void => {
    const sessionId = String(agent.session.id);
    const deny = deniedMcpTools(allowlist, deps.catalog());
    // Replacing a mask emits its own change notification, and every agent's mask could
    // then reapply in turn. An unchanged set for the same agent needs no write at all.
    const current = held.get(sessionId);
    if (current !== undefined && current.agent === agent && sameNames(current.deny, deny)) return;
    release(sessionId);
    const source = deny.length === 0 ? undefined : deps.restrict(agent, deny);
    held.set(sessionId, source === undefined ? { agent, allowlist, deny } : { agent, allowlist, deny, release: source });
  };

  return {
    track(agent) {
      mutate(() => {
        const sessionId = String(agent.session.id);
        // No board, or a board that names no field: every server stays visible, and
        // tracking nothing keeps a later catalog change from masking this agent.
        const allowlist = deps.policy.allowlist(sessionId);
        if (allowlist === undefined) { release(sessionId); return; }
        try { apply(agent, allowlist); } catch (error) { deps.report?.(error); }
      });
    },
    forget(agent) {
      mutate(() => {
        const sessionId = String(agent.session.id);
        const mask = held.get(sessionId);
        if (mask === undefined || mask.agent !== agent) return;
        release(sessionId);
      });
    },
    refresh() {
      mutate(() => {
        // A catalog change reapplies the allowlist each agent started with, so a board
        // edit never changes a running agent.
        for (const mask of [...held.values()]) {
          try { apply(mask.agent, mask.allowlist); } catch (error) { deps.report?.(error); }
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sessionId of [...held.keys()]) release(sessionId);
    },
  };
}
