import type { Node } from '@xyflow/react';
import type { StageNodeModel } from './stage-node.js';

/** One stage as the diagram surface receives it, with its authored position and size. */
export interface CanvasStage {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** The minimum width the stage renders at. */
  readonly width: number;
  /** The minimum height the stage renders at. */
  readonly height: number;
  readonly cardIds: readonly string[];
  /** True for the stage that is the workflow's configured initial stage. */
  readonly creatable: boolean;
}

/** The React Flow node a stage is painted from. */
export type StageFlowNode = Node<StageNodeModel, 'stage'>;

/** The node the surface paints for one stage, including the stage's creation action. */
export function toNode(stage: CanvasStage, locked: boolean, measured?: StageFlowNode['measured']): StageFlowNode {
  return {
    id: stage.id,
    type: 'stage',
    position: { x: stage.x, y: stage.y },
    data: { id: stage.id, label: stage.label, cardIds: stage.cardIds, width: stage.width, height: stage.height, locked, creatable: stage.creatable },
    style: { width: stage.width, minHeight: stage.height },
    draggable: false,
    selectable: false,
    ...(measured === undefined ? {} : { measured }),
  };
}

/**
 * What decides whether the stage nodes need re-syncing. Every stage field a node
 * renders has to appear here, or changing only that field leaves the painted stage
 * stale until some other change forces a re-sync; `creatable` is in it for exactly
 * that reason, so editing the workflow's initial stage moves the creation action at
 * once. Exported so the field set is pinned by a test rather than by memory.
 */
export function stageSignature(stages: readonly CanvasStage[], locked: boolean): string {
  return JSON.stringify(stages.map(stage => [
    stage.id, stage.x, stage.y, stage.width, stage.height, stage.label, locked,
    stage.cardIds, stage.creatable,
  ]));
}
