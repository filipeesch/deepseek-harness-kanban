/**
 * Where a task lands inside its destination stage.
 *
 * - `start`: before every card the stage already contains.
 * - `end`: after every card the stage already contains.
 * - `before`: immediately before the named task.
 */
export type Placement = 'start' | 'end' | { readonly before: string };

/**
 * The placement requested by a move anchor. An absent anchor means no position
 * was requested — a drawer stage change or an automatic advance — and lands at
 * the start. `null` is an explicit drop after the last card, and a task id is an
 * anchored drop.
 */
export function placementFromAnchor(anchor: string | null | undefined): Placement {
  if (anchor === undefined) return 'start';
  if (anchor === null) return 'end';
  return { before: anchor };
}

/**
 * The insertion index for a placement in an already ordered destination that
 * does not contain the moving task. An anchor missing from that destination
 * falls back to the end, so a persisted transition still completes when its
 * anchor was removed before dispatch.
 */
export function placementIndex(placement: Placement, ordered: readonly { readonly id: string }[]): number {
  if (placement === 'start') return 0;
  if (placement === 'end') return ordered.length;
  const index = ordered.findIndex(value => value.id === placement.before);
  return index >= 0 ? index : ordered.length;
}
