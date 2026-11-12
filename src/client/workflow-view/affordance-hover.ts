/** The connection the diagram presents as pointed at, and the leave that may clear it. */
export interface HoverState {
  readonly id: string | null;
  /** The connection whose leave is waiting for the linger to elapse. */
  readonly pending: string | null;
}

export const NO_HOVER: HoverState = { id: null, pending: null };

export type HoverEvent =
  | { readonly kind: 'enter'; readonly id: string }
  | { readonly kind: 'leave'; readonly id: string }
  | { readonly kind: 'settle'; readonly id: string }
  | { readonly kind: 'clear' };

/**
 * The hover rule for a connection's marks. Entering marks the connection. Leaving
 * only schedules the clear, so a pointer moving from the line to one of its
 * handles keeps the marks presented; an entering handle cancels that pending
 * clear, and the settle event clears the marks once the linger elapses.
 */
export function hoverReduce(state: HoverState, event: HoverEvent): HoverState {
  switch (event.kind) {
    case 'enter':
      return { id: event.id, pending: null };
    case 'leave':
      return state.id === event.id ? { id: state.id, pending: event.id } : state;
    case 'settle':
      return state.pending === event.id ? NO_HOVER : state;
    case 'clear':
      return state.id === null && state.pending === null ? state : NO_HOVER;
  }
}
