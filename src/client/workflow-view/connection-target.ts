/** What releasing a connection gesture means. */
export type ConnectionDrop =
  | { readonly kind: 'none' }
  | { readonly kind: 'anchor' }
  | { readonly kind: 'repoint'; readonly to: string }
  | { readonly kind: 'reown'; readonly toSource: string }
  | { readonly kind: 'create'; readonly to: string };

export type ConnectionEnd = 'source' | 'target';

/**
 * What releasing a connection end means, given the stage under the pointer.
 *
 * Releasing inside the end's own stage keeps the established meaning: the end moves
 * to another anchor point. Releasing over another stage changes the destination
 * instead, which is a transition edit. A stage that would make the transition point
 * at its own source is refused rather than authored.
 */
export function decideEndDrop(input: { readonly end: ConnectionEnd; readonly from: string; readonly to: string; readonly stageUnder: string | null }): ConnectionDrop {
  const { end, from, to, stageUnder } = input;
  if (stageUnder === null) return { kind: 'anchor' };
  if (end === 'target') {
    if (stageUnder === to) return { kind: 'anchor' };
    if (stageUnder === from) return { kind: 'none' };
    return { kind: 'repoint', to: stageUnder };
  }
  if (stageUnder === from) return { kind: 'anchor' };
  if (stageUnder === to) return { kind: 'none' };
  return { kind: 'reown', toSource: stageUnder };
}

/**
 * The stage a release of one connection end would act on: the new destination for
 * a target end, the new owner for a source end, and null when the release would
 * keep the end on its own stage or change nothing. The gesture marks exactly this
 * stage as the candidate before the release.
 */
export function candidateStageFor(input: { readonly end: ConnectionEnd; readonly from: string; readonly to: string; readonly stageUnder: string | null }): string | null {
  const decision = decideEndDrop(input);
  if (decision.kind === 'repoint') return decision.to;
  if (decision.kind === 'reown') return decision.toSource;
  return null;
}

/** What releasing a newly drawn connection means, given the stage under the pointer. */
export function decideCreationDrop(input: { readonly sourceId: string; readonly stageUnder: string | null }): ConnectionDrop {
  if (input.stageUnder === null || input.stageUnder === input.sourceId) return { kind: 'none' };
  return { kind: 'create', to: input.stageUnder };
}
