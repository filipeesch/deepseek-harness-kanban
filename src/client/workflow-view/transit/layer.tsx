import React from 'react';
import type { Transit } from './plan.js';
import { TRANSIT_POLICY, type TransitPolicy } from './policy.js';
import { delayFor, diameterFor, durationFor } from './timing.js';

export interface TransitLayerProps {
  readonly transits: readonly Transit[];
  /** Reports that a transit's last particle reached the destination. */
  readonly onArrived: (transit: Transit) => void;
  readonly policy?: TransitPolicy;
}

/** The particle diameters and delays one transit draws, the core first. */
function particles(policy: TransitPolicy): number[] {
  const count = Math.max(0, policy.trailCount);
  return Array.from({ length: count + 1 }, (_value, index) => index);
}

/**
 * Plays the transit inside the diagram viewport: one particle group per moving card,
 * the bright core first and its trailing particles behind it, all following the path
 * the diagram already draws. The particles are inert and hidden from assistive
 * technology, and the arrangement reports arrival from its last particle.
 *
 * The timing lives in CSS, so a re-render of this component cannot cancel or replay a
 * running transit; React only mounts and removes the particles.
 */
export function TransitLayer({ transits, onArrived, policy = TRANSIT_POLICY }: TransitLayerProps) {
  const indexes = particles(policy);
  const last = indexes[indexes.length - 1] ?? 0;
  return <>
    {transits.map(transit => {
      const duration = durationFor(transit.length, policy);
      return <div
        key={transit.key}
        className="kb-flow-transit"
        data-transit-task={transit.taskId}
        data-transit-from={transit.fromStageId}
        data-transit-to={transit.toStageId}
        aria-hidden="true"
      >
        {indexes.map(index => <span
          key={index}
          className={'kb-flow-transit-particle' + (index === 0 ? ' is-core' : '')}
          style={{
            '--kb-transit-path': 'path("' + transit.path + '")',
            '--kb-transit-duration': duration + 'ms',
            '--kb-transit-delay': delayFor(index, policy) + 'ms',
            // The particle keeps a readable screen size without ever dwarfing the wire:
            // the diagram publishes its counter-scale, bounded here.
            '--kb-transit-size': 'calc(' + diameterFor(index, policy) + 'px * clamp(0.55, var(--kb-affordance-scale, 1), 2.2))',
          } as React.CSSProperties}
          {...(index === last ? { onAnimationEnd: () => onArrived(transit) } : {})}
        />)}
      </div>;
    })}
  </>;
}
