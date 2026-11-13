/**
 * The attention states a task card can present, most urgent first. A card's surface
 * presents one of them; its marks present every one that applies, so dominance
 * orders the surface without hiding a state.
 */
export const CARD_PRESENCE_PRIORITY = ['error', 'approval', 'attention', 'running', 'unread'] as const;

export type CardPresenceState = (typeof CARD_PRESENCE_PRIORITY)[number];

/** The one state a card's surface presents, or none when the card is quiet. */
export type CardDominance = CardPresenceState | 'none';

/** The attention facts the dominance policy reads; a projected attention satisfies it. */
export interface CardPresenceFacts {
  readonly running: boolean;
  readonly unread: boolean;
  readonly awaitingReply: boolean;
  readonly failed: boolean;
  /** A task-level pending executable approval, not a conversation attention fact. */
  readonly approval?: boolean;
}

function isActive(state: CardPresenceState, facts: CardPresenceFacts): boolean {
  if (state === 'error') return facts.failed;
  if (state === 'approval') return facts.approval === true;
  if (state === 'attention') return facts.awaitingReply;
  if (state === 'running') return facts.running;
  return facts.unread;
}

/**
 * The state a task card's surface presents. A failure outranks everything so a
 * running turn never hides it, an awaiting reply outranks work in progress so the
 * card that needs the user reads first, and execution outranks unread so a running
 * card reads as running rather than as new messages.
 */
export function projectCardDominance(facts: CardPresenceFacts): CardDominance {
  return CARD_PRESENCE_PRIORITY.find(state => isActive(state, facts)) ?? 'none';
}
