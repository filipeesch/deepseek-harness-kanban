import React from 'react';
import { MiniMap } from '@xyflow/react';

/** The always-visible diagram overview; dragging inside it pans the diagram. */
export function DiagramMinimap() {
  return <MiniMap className="kb-flow-minimap" ariaLabel="Diagram overview" pannable zoomable={false} />;
}
