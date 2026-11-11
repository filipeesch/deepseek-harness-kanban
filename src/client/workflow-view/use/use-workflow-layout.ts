import { useCallback, useMemo, useRef, useState } from 'react';
import type { ConnectionLayout, KanbanSnapshot, StagePosition, StageSize, Workflow } from '../../../shared/types.js';
import { effectiveStageSize } from '../../../domain/stage-size.js';
import { readStagePositions, type StagePositions } from '../../../domain/workflow-positions.js';
import { readStageSizes, type StageSizes } from '../../../domain/workflow-sizes.js';
import { readConnections, type ConnectionLayouts } from '../../../domain/workflow-connections.js';
import type { ConnectionLayoutPort } from './use-transition-actions.js';
import { mergeConnectionOverrides, useConnectionOverrides } from './use-connection-overrides.js';
import { computeAutoLayout, freezeAutoLayout, graphKey, type FrozenAutoLayout } from '../auto-layout.js';
import { mergePlacements } from '../placement-merge.js';
import { placementBounds, type StageLayout } from '../layout.js';
import { usePlacementHistory, type PlacementHistoryState } from './use-placement-history.js';
import { usePlacementOverrides } from './use-placement-overrides.js';
import { usePlacementSaver, type PlacementSaver } from './use-placement-saver.js';

export interface WorkflowLayoutInput {
  readonly hubId: string;
  readonly boardId: string;
  readonly workflow: Workflow;
  readonly workflowYaml: string;
  /** Store a layout edit, composed inside the writer's slot against the acknowledged document. */
  readonly saveLayout: (compose: (acknowledged: string | null) => string | null) => Promise<unknown>;
  readonly measured: ReadonlyMap<string, StageSize>;
  readonly revealed: boolean;
  readonly onError: (error: unknown) => void;
  readonly onRejected?: () => void;
}

export interface WorkflowLayout {
  readonly placements: ReadonlyMap<string, StagePosition>;
  /** The positions the diagram shows right now, including a gesture in progress. */
  visualPositions(): Record<string, StagePosition>;
  /** The connection layouts to draw: stored, with this session's adjustments on top. */
  readonly connectionLayouts: Readonly<Record<string, ConnectionLayout | undefined>>;
  readonly connections: ConnectionLayoutPort;
  /** Present a restored set of connection layouts, before its save lands. */
  previewConnections(values: ConnectionLayouts): void;
  /** Present one connection's adjusted layout right away, until its save lands. */
  intendConnection(connectionId: string, layout: ConnectionLayout): void;
  readonly stageSizeOf: (stageId: string) => StageSize;
  readonly layoutFrom: (positions: StagePositions) => StageLayout;
  readonly saver: PlacementSaver;
  readonly placement: ReturnType<typeof usePlacementOverrides>;
  readonly history: PlacementHistoryState;
  /** Freeze the automatic placement the diagram computed, so a gesture keeps its frame. */
  freeze(layout: StageLayout): void;
  /** Forget the frozen automatic placement, so the next render recomputes it. */
  invalidate(): void;
  reset(): void;
}

/**
 * The diagram's authored layout: stage placement, stage size, and connection layout,
 * with the optimistic overrides and the coalesced save that keep a gesture looking
 * immediate. The view keeps composition and JSX; every value here is authored state.
 */
export function useWorkflowLayout(input: WorkflowLayoutInput): WorkflowLayout {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const frozen = useRef<FrozenAutoLayout | null>(null);

  const workflowKey = useMemo(() => graphKey(input.workflow), [input.workflow]);
  const stored = useMemo(() => readStagePositions(input.workflow), [input.workflow]);
  const storedSizes = useMemo(() => readStageSizes(input.workflow), [input.workflow]);
  const placement = usePlacementOverrides({ stored, storedSizes });
  const storedConnections = useMemo(() => readConnections(input.workflow), [input.workflow]);
  const connectionOverrides = useConnectionOverrides(storedConnections);
  const connectionLayouts = useMemo(() => mergeConnectionOverrides(storedConnections, connectionOverrides.overrides), [storedConnections, connectionOverrides.overrides]);

  const history = usePlacementHistory();
  const saver = usePlacementSaver({
    boardId: input.boardId,
    saveLayout: input.saveLayout,
    workflow: input.workflow,
    workflowYaml: input.workflowYaml,
    onError: input.onError,
    ...(input.onRejected === undefined ? {} : { onRejected: input.onRejected }),
  });

  const autoLayout = useMemo(() => {
    const compute = () => computeAutoLayout(input.workflow, input.measured);
    if (!input.revealed) return compute();
    const frozenLayout = freezeAutoLayout(frozen.current, workflowKey, compute);
    frozen.current = frozenLayout;
    return frozenLayout.layout;
  }, [input.workflow, workflowKey, input.measured, input.revealed, layoutVersion]);

  const placements = useMemo(() => mergePlacements(Object.fromEntries(autoLayout.placements), stored, placement.positions), [autoLayout, stored, placement.positions]);
  const placementsRef = useRef(placements); placementsRef.current = placements;

  const visualPositions = useCallback((): Record<string, StagePosition> => {
    const result: Record<string, StagePosition> = {};
    for (const [id, position] of placementsRef.current) result[id] = { x: position.x, y: position.y };
    return result;
  }, []);

  const layoutFrom = useCallback((positions: StagePositions): StageLayout => {
    const map = new Map<string, StagePosition>();
    for (const [id, position] of Object.entries(positions)) if (position !== undefined) map.set(id, position);
    return { placements: map, bounds: placementBounds(map, input.measured) };
  }, [input.measured]);

  const stageSizeOf = useCallback((stageId: string): StageSize => effectiveStageSize(placement.sizes[stageId] ?? storedSizes[stageId]), [placement.sizes, storedSizes]);

  const freeze = useCallback((layout: StageLayout) => {
    frozen.current = { key: workflowKey, layout };
    setLayoutVersion(value => value + 1);
  }, [workflowKey]);

  const invalidate = useCallback(() => {
    frozen.current = null;
    setLayoutVersion(value => value + 1);
  }, []);

  const previewConnections = connectionOverrides.preview;
  const intendConnections = saver.intendConnections;
  const acceptConnections = saver.acceptConnections;
  const connections = useMemo<ConnectionLayoutPort>(() => ({
    current: () => ({ ...saver.desiredConnections.current }),
    intend: (values: ConnectionLayouts) => { previewConnections(values); intendConnections(values); },
    authoritativeYaml: (snapshot: KanbanSnapshot) => snapshot.state.hubs.find(hub => hub.id === input.hubId)?.boards.find(board => board.id === input.boardId)?.workflowYaml ?? null,
    apply: (text: string) => saver.writeInto(text),
    accept: (values: ConnectionLayouts) => { previewConnections(values); acceptConnections(values); },
    restore: (values: ConnectionLayouts) => { previewConnections(values); intendConnections(values); },
  }), [acceptConnections, input.boardId, input.hubId, intendConnections, previewConnections, saver]);

  const reset = useCallback(() => {
    placement.reset();
    frozen.current = null;
    setLayoutVersion(value => value + 1);
    connectionOverrides.reset();
    history.reset();
  }, [connectionOverrides, history, placement]);

  return {
    placements,
    visualPositions,
    connectionLayouts,
    connections,
    previewConnections,
    intendConnection: connectionOverrides.intend,
    stageSizeOf,
    layoutFrom,
    saver,
    placement,
    history,
    freeze,
    invalidate,
    reset,
  };
}
