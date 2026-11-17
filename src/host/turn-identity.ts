/** The minimum non-deprecated host projection needed to identify a live turn. */
export interface TurnBoundaryPort {
  boundary(sessionId: string): { openTurnStartSeq: number | null; lastTurn: number } | undefined;
}

export interface OpenTurnIdentity { sessionId: string; turn: number }

/** Unknown, closed, or malformed boundaries are never evidence of an open turn. */
export function openTurnIdentity(port: TurnBoundaryPort, sessionId: string | undefined): OpenTurnIdentity | undefined {
  if (!sessionId) return undefined;
  let boundary: ReturnType<TurnBoundaryPort['boundary']>;
  try { boundary = port.boundary(sessionId); } catch { return undefined; }
  if (!boundary || !Number.isSafeInteger(boundary.openTurnStartSeq) || boundary.openTurnStartSeq === null || boundary.openTurnStartSeq < 0
      || !Number.isSafeInteger(boundary.lastTurn) || boundary.lastTurn < 1) return undefined;
  return { sessionId, turn: boundary.lastTurn };
}
