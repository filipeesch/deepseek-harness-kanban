import type { ConnectionAnchor, ConnectionSegmentOffset } from '../../shared/types.js';
import type { GestureHandle, PointerEventsPort } from './gestures/stage-drag.js';
import type { SnapPolicy } from './gestures/grid-snap.js';
import type { LiveConnectionDescriptor, LiveStageRect } from './edge-model.js';
import type { Viewport } from './gestures/viewport-policy.js';
import type { StageCallbacks } from './stage-node.js';
import type { CardEnvironment } from './card-environment.js';

/** One connection as the diagram draws it, with the authored layout already merged in. */
export type CanvasConnection = LiveConnectionDescriptor;

/** One connection adjustment the surface asks the view to store. */
export interface ConnectionEdit {
  readonly connectionId: string;
  readonly source?: ConnectionAnchor;
  readonly target?: ConnectionAnchor;
  readonly segments?: readonly ConnectionSegmentOffset[];
}

/** What the control stack can ask of the diagram surface. */
export interface CanvasViewportActions { zoomIn(): void; zoomOut(): void; fit(): void }

/**
 * Where the surface places the diagram once it is ready: either the position the
 * board stored, or the whole diagram. The parent owns the intent and the token.
 */
export type CanvasViewRequest =
  | { readonly kind: 'restore'; readonly viewport: Viewport }
  | { readonly kind: 'fit' };

/** The stage and insertion line under an active card drag. */
export interface CanvasDropState {
  readonly stageId: string | null;
  readonly indicatorY: number | null;
}

export type { GestureHandle, PointerEventsPort, SnapPolicy, LiveStageRect, StageCallbacks, CardEnvironment };
export type { CanvasStage } from './canvas-stage.js';
