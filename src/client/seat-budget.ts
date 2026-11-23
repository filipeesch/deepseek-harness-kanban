/**
 * The composer seat's height policy.
 *
 * A strip is bounded by what the conversation can spare, never by a fixed cap: it
 * grows with its content up to that height, and only scrolls when the content is
 * taller than the space the seat can give. When several strips wait together the
 * spare height is shared by need, so a short strip never holds height the other
 * one needs. Every function here is pure: the seat measures the DOM and passes
 * numbers, which keeps the policy testable without a browser.
 */

/** One waiting strip's measured geometry, in seat order. */
export interface StripMetrics {
  /** Height of the header bar, which stays visible in every presentation. */
  readonly header: number;
  /** Height of the fixed controls: the header plus the footer when the body is shown. */
  readonly fixed: number;
  /** Height the body content needs; zero when the body is hidden. */
  readonly content: number;
  /** Whether the body is shown. */
  readonly expanded: boolean;
}

/** The smallest cramped panel worth presenting above the conversation. */
export const MIN_PANEL = 96;
/** The largest height a cramped panel may use. */
export const MAX_PANEL = 560;
/** A readable fallback header height when a portaled strip is not measurable yet. */
export const HEADER_FALLBACK = 34;

export interface SeatPlanInput {
  /** Height the strips may use beside the composer, after the composer and the gaps. */
  readonly dockSpace: number;
  /** Height visible above the composer when the strips cannot live in the seat. */
  readonly crampedSpace: number;
  /** Row gap between the strips, used for the cramped slots. */
  readonly gap?: number;
}

export interface SeatPlan {
  readonly mode: 'dock' | 'cramped';
  /** Height per strip, in seat order. Empty for the cramped presentation. */
  readonly budgets: readonly number[];
  /** Whether the fixed controls cannot all fit and every strip scrolls as a whole. */
  readonly tight: boolean;
  /** Height per usable panel in the cramped presentation. */
  readonly panelHeight: number;
  /** Whether the cramped presentation must show compact launchers. */
  readonly launcher: boolean;
}

/** What one strip wants: its fixed controls plus its body content. */
export function stripNeed(metrics: StripMetrics): number {
  return metrics.fixed + (metrics.expanded ? metrics.content : 0);
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Split a height evenly, giving the leftover pixels to the first strips. */
function splitEvenly(space: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(space / count);
  const left = space - base * count;
  return Array.from({ length: count }, (_value, index) => base + (index < left ? 1 : 0));
}

/** Split the leftover pixels by the largest fractional remainder, deterministically. */
function apportion(space: number, weights: readonly number[]): number[] {
  const total = sum(weights);
  const result = weights.map(() => 0);
  if (space <= 0 || total <= 0) return result;
  const shares = weights.map(weight => (space * weight) / total);
  const floors = shares.map(value => Math.floor(value));
  let left = space - sum(floors);
  const order = shares
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const entry of order) {
    if (left <= 0) break;
    floors[entry.index] = floors[entry.index]! + 1;
    left -= 1;
  }
  for (let index = 0; index < result.length; index += 1) result[index] = floors[index]!;
  return result;
}

/**
 * Share a height by need.
 *
 * Every strip whose need fits inside an equal share is satisfied first, so a short
 * strip never keeps height a taller one needs; the rest of the space is then split
 * among the strips still short, in proportion to what they still need. The result
 * never exceeds the space and never exceeds a need.
 */
export function distributeByNeed(space: number, needs: readonly number[]): number[] {
  const result = needs.map(() => 0);
  // DOM reservations can be fractional; the allocatable height is whole pixels, and the
  // allocation must never exceed the space it was given.
  const budget = Math.floor(Math.max(0, space));
  if (needs.length === 0 || budget <= 0) return result;
  let remaining = budget;
  const order = needs
    .map((need, index) => ({ need: Math.max(0, need), index }))
    .sort((left, right) => left.need - right.need || left.index - right.index);
  let open = order.length;
  let satisfied = 0;
  const satisfiedIndexes = new Set<number>();
  while (satisfied < order.length) {
    const next = order[satisfied]!;
    const fair = remaining / open;
    if (next.need > fair) break;
    result[next.index] = next.need;
    remaining -= next.need;
    open -= 1;
    satisfied += 1;
    satisfiedIndexes.add(next.index);
  }
  const unmet = order.slice(satisfied);
  if (unmet.length === 0) return result;
  const shares = apportion(remaining, unmet.map(entry => entry.need));
  unmet.forEach((entry, index) => { result[entry.index] = shares[index]!; });
  return result;
}

/**
 * How the seat can present the waiting strips.
 *
 * - `dock`: the fixed controls fit, so each strip keeps them outside its scrolling
 *   body and only the body scrolls when the content is taller than the allocated body.
 * - `dock` with `tight`: the fixed controls do not all fit, so every strip keeps its
 *   header and scrolls as a whole.
 * - `cramped`: not even the headers fit; the strips are presented above the visible
 *   conversation, and `launcher` says whether they must be compact launchers.
 */
export function seatPlan(strips: readonly StripMetrics[], input: SeatPlanInput): SeatPlan {
  const count = strips.length;
  if (count === 0) return { mode: 'dock', budgets: [], tight: false, panelHeight: 0, launcher: false };
  // Reservations measured in the DOM can be fractional; the seat allocates whole pixels.
  const dockSpace = Math.floor(Math.max(0, input.dockSpace));
  const fixed = strips.map(metrics => Math.max(0, metrics.fixed));
  const headers = strips.map(metrics => Math.max(0, Math.min(metrics.header, metrics.fixed)));
  const contents = strips.map(metrics => (metrics.expanded ? Math.max(0, metrics.content) : 0));
  const fixedTotal = sum(fixed);
  if (dockSpace >= fixedTotal) {
    const bodies = distributeByNeed(dockSpace - fixedTotal, contents);
    return { mode: 'dock', budgets: fixed.map((value, index) => value + bodies[index]!), tight: false, panelHeight: 0, launcher: false };
  }
  const headerTotal = sum(headers);
  if (dockSpace >= headerTotal) {
    // No strip can show its full fixed controls here, so need cannot decide the split:
    // each expanded strip keeps its header and shares the remainder evenly, which is what
    // gives each one enough of its own scrolling body to reach its actions. A collapsed
    // strip can use no extra height, so it keeps only its header.
    const expanded = strips.map((metrics, index) => (metrics.expanded ? index : -1)).filter(index => index >= 0);
    const extra = splitEvenly(dockSpace - headerTotal, expanded.length);
    return {
      mode: 'dock',
      budgets: headers.map((value, index) => {
        const slot = expanded.indexOf(index);
        return slot < 0 ? value : value + extra[slot]!;
      }),
      tight: true,
      panelHeight: 0,
      launcher: false,
    };
  }
  const gap = Math.max(0, input.gap ?? 0);
  const share = Math.floor(Math.max(0, Math.max(0, input.crampedSpace) - gap * Math.max(0, count - 1)) / count);
  const launcher = share < MIN_PANEL;
  return {
    mode: 'cramped',
    budgets: [],
    tight: true,
    panelHeight: launcher ? 0 : Math.min(share, MAX_PANEL),
    launcher,
  };
}
