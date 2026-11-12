/**
 * The stage-height estimate the diagram rendering and the layout metrics share.
 *
 * The constants are derived from the diagram stylesheet:
 * - the header row is 10px of padding above and below, a 24px minimum line, and
 *   its 1px rule, so it occupies 45px;
 * - the card list pads by 8px and spaces its cards by 8px;
 * - one card slot renders at 93px in the browser lane: the card's 10px padding
 *   above and below and its 1px border, a 19px title line, the 16px context row,
 *   the 26px activity row, and the 5px gap between the three rows.
 *
 * The estimate is not a measurement. A card with a wrapped title or a status
 * line renders taller than the slot assumes, so a stage whose cards exceed its
 * authored height is reported as estimated rather than measured.
 */

/** The header row: 10px padding above and below, a 24px minimum line, and its 1px rule. */
export const STAGE_HEADER_HEIGHT = 45;
/** The card list's 8px padding and the 8px gap between two cards. */
export const STAGE_CARD_GAP = 8;
/** One card slot: the card's padding and border, its three rows, and the gaps between them. */
export const STAGE_CARD_HEIGHT = 93;

/**
 * The height one stage occupies at a card count: the authored height is the
 * floor, and cards can only grow it. A card count below zero is treated as none,
 * because the count never shrinks the authored floor.
 */
export function estimateStageHeight(authoredHeight: number, cards: number): number {
  const shown = Math.max(0, Math.trunc(cards));
  return Math.max(authoredHeight, STAGE_HEADER_HEIGHT + STAGE_CARD_GAP + shown * (STAGE_CARD_HEIGHT + STAGE_CARD_GAP));
}
