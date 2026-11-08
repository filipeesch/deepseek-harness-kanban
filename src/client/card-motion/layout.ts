/** A card's viewport rectangle, captured from `getBoundingClientRect`. */
export interface CardRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** The rendered cards of one commit: their DOM order and their rectangles. */
export interface CardSnapshot { readonly keys: readonly string[]; readonly rects: ReadonlyMap<string, CardRect> }

/** One card that must travel from its previous rectangle to its current one. */
export interface CardMovement { readonly key: string; readonly dx: number; readonly dy: number }

export interface CardMotionPlan {
  readonly movements: readonly CardMovement[];
  readonly entered: readonly string[];
  readonly exited: readonly string[];
}

/** Where an exit copy sits inside the motion overlay. */
export interface CardOffset { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Whether two rendered orders contain the same card ids in the same sequence. */
export function sameRowKeys(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((key, index) => key === next[index]);
}

/** The translation that puts `after` back on `before`, or null when the card did not move. */
export function movementFor(before: CardRect, after: CardRect): { dx: number; dy: number } | null {
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** Whether any part of the card is inside the visible board area. */
export function intersectsViewport(rect: CardRect, viewport: CardRect): boolean {
  return rect.left + rect.width > viewport.left
    && rect.left < viewport.left + viewport.width
    && rect.top + rect.height > viewport.top
    && rect.top < viewport.top + viewport.height;
}

/** An exit copy keeps the card's size and takes the card's last position inside the overlay. */
export function exitCopyRect(rect: CardRect, origin: CardRect): CardOffset {
  return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
}

/**
 * The motion one commit needs: cards present before and after move, ids only in
 * the current snapshot enter, and ids only in the previous snapshot exit. Cards
 * outside the visible board before or after the commit are skipped.
 */
export function planCardMotion(
  previous: CardSnapshot,
  current: CardSnapshot,
  visible: (rect: CardRect) => boolean,
): CardMotionPlan {
  const previousKeys = new Set(previous.keys);
  const currentKeys = new Set(current.keys);
  const movements: CardMovement[] = [];
  for (const key of current.keys) {
    const before = previous.rects.get(key);
    const after = current.rects.get(key);
    if (before === undefined || after === undefined) continue;
    if (!visible(before) && !visible(after)) continue;
    const movement = movementFor(before, after);
    if (movement !== null) movements.push({ key, dx: movement.dx, dy: movement.dy });
  }
  const entered = current.keys.filter(key => !previousKeys.has(key) && isVisible(current.rects.get(key), visible));
  const exited = previous.keys.filter(key => !currentKeys.has(key) && isVisible(previous.rects.get(key), visible));
  return { movements, entered, exited };
}

function isVisible(rect: CardRect | undefined, visible: (rect: CardRect) => boolean): boolean {
  return rect !== undefined && visible(rect);
}
