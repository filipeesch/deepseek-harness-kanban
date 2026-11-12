import type { StageSide } from '../../shared/types.js';
import type { ConnectionShape } from '../../domain/diagram/orthogonal.js';
import { connectionRoute } from '../../domain/diagram/route.js';
import type { LiveConnectionDescriptor, LiveStageRect } from './edge-model.js';

/** What a creation drag would author, from the stage and side it started at. */
export interface CreationPreviewInput {
  readonly stages: readonly LiveStageRect[];
  readonly connections: readonly LiveConnectionDescriptor[];
  readonly sourceId: string;
  readonly targetId: string;
  readonly side: StageSide;
}

/**
 * The stage a creation drag would really author, or null when the release would
 * change nothing. The same rule decides the candidate mark, the preview, and the
 * release: another stage that the source already authors exactly is refused, so
 * the gesture must not promise that edit.
 */
export function creationCandidateFor(input: {
  readonly sourceId: string;
  readonly stageUnder: string | null;
  readonly connections: readonly LiveConnectionDescriptor[];
}): string | null {
  const target = input.stageUnder;
  if (target === null || target === input.sourceId) return null;
  const alreadyAuthored = input.connections.some(connection => connection.from === input.sourceId && connection.to === target && connection.kind === 'explicit');
  return alreadyAuthored ? null : target;
}

/** The fan-out the created connection will have, including the default path it replaces. */
export function creationFanOut(connections: readonly LiveConnectionDescriptor[], sourceId: string): { readonly fanOut: number; readonly fanOutCount: number } {
  const outgoing = connections.filter(connection => connection.from === sourceId);
  // A stage with a default path authors exactly the drawn destination afterwards,
  // so the created connection replaces that path instead of following it.
  if (outgoing.some(connection => connection.kind === 'implicit')) return { fanOut: 0, fanOutCount: 1 };
  return { fanOut: outgoing.length, fanOutCount: outgoing.length + 1 };
}

/** The side the automatic route would leave from, so the preview knows when the drag authors one. */
export function automaticCreationSide(returning: boolean): StageSide {
  return returning ? 'bottom' : 'right';
}

function rectOf(stage: LiveStageRect) {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

/**
 * The route a creation drag would author. It leaves from the port's side when
 * that side is not the automatic one, exactly like the stored connection after
 * the release; the destination end is automatic, because a creation gesture
 * authors only the destination.
 */
export function creationPreviewRoute(input: CreationPreviewInput): ConnectionShape | null {
  const sourceIndex = input.stages.findIndex(stage => stage.id === input.sourceId);
  const targetIndex = input.stages.findIndex(stage => stage.id === input.targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const from = input.stages[sourceIndex]!;
  const to = input.stages[targetIndex]!;
  const returning = targetIndex < sourceIndex;
  const { fanOut, fanOutCount } = creationFanOut(input.connections, input.sourceId);
  const anchored = input.side === automaticCreationSide(returning) ? {} : { source: { side: input.side, at: 2 } };
  return connectionRoute({
    from: rectOf(from),
    to: rectOf(to),
    returning,
    fanOut,
    fanOutCount,
    clearanceStages: input.stages.map(rectOf),
    ...anchored,
  }).shape;
}
