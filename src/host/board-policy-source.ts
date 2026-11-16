/** One board, as far as a tool policy needs to know it. */
export interface BoardMcp {
  readonly mcp?: readonly string[];
}

/** Where a session's board and its parent session are read. */
export interface BoardLookupSource {
  /** The workflow of the board that owns this task conversation, or undefined when it owns none. */
  boardOf(sessionId: string): BoardMcp | undefined;
  /** The session this one descends from, or undefined for a root conversation. */
  parentOf(sessionId: string): string | undefined;
}

/** How far a session's ancestry is followed; a real fork chain is far shorter. */
const MAX_ANCESTRY = 8;

/**
 * The board allowlist one session's agent starts under.
 *
 * A task conversation reads its own board. A fork or a delegated child is created
 * before it is attached to the task it descends from, so the agent-start mask would
 * otherwise see no board; following the ancestry closes that window. The walk is
 * bounded and cycle-safe, and the attachment path reapplies the policy as a fallback.
 */
export function boardAllowlistFor(source: BoardLookupSource, sessionId: string): readonly string[] | undefined {
  const visited = new Set<string>();
  let current: string | undefined = sessionId;
  while (current !== undefined && !visited.has(current) && visited.size < MAX_ANCESTRY) {
    visited.add(current);
    const board = source.boardOf(current);
    if (board !== undefined) return board.mcp;
    current = source.parentOf(current);
  }
  return undefined;
}
