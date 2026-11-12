// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TransitLayer } from '../../src/client/workflow-view/transit/layer.js';
import type { Transit } from '../../src/client/workflow-view/transit/plan.js';

const transits: Transit[] = [
  { key: 'a:one->two', taskId: 'a', fromStageId: 'one', toStageId: 'two', path: 'M 0 0 L 300 0', length: 300 },
];

afterEach(cleanup);

describe('transit layer', () => {
  it('presents one particle group per transit on the drawn path', () => {
    const view = render(<TransitLayer transits={transits} onArrived={() => undefined} />);
    const groups = view.container.querySelectorAll('.kb-flow-transit');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.getAttribute('data-transit-task')).toBe('a');
    const particles = groups[0]!.querySelectorAll<HTMLElement>('.kb-flow-transit-particle');
    expect(particles).toHaveLength(4);
    expect(particles[0]!.classList.contains('is-core')).toBe(true);
    for (const particle of particles) expect(particle.style.getPropertyValue('--kb-transit-path')).toBe('path("M 0 0 L 300 0")');
    expect(particles[0]!.style.getPropertyValue('--kb-transit-duration')).toBe('420ms');
    expect(particles[0]!.style.getPropertyValue('--kb-transit-delay')).toBe('0ms');
    expect(particles[3]!.style.getPropertyValue('--kb-transit-delay')).toBe('90ms');
    expect(particles[0]!.style.getPropertyValue('--kb-transit-size')).toContain('12px');
    // The particle keeps a readable screen size without dwarfing the wire at extreme zooms.
    expect(particles[0]!.style.getPropertyValue('--kb-transit-size')).toContain('clamp(');
  });

  it('is inert and hidden from assistive technology', () => {
    const view = render(<TransitLayer transits={transits} onArrived={() => undefined} />);
    expect(view.container.querySelector('.kb-flow-transit')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the same nodes across a re-render, so a running transit is never restarted', () => {
    const view = render(<TransitLayer transits={transits} onArrived={() => undefined} />);
    const first = view.container.querySelector('.kb-flow-transit-particle');
    view.rerender(<TransitLayer transits={[...transits]} onArrived={() => undefined} />);
    expect(view.container.querySelector('.kb-flow-transit-particle')).toBe(first);
  });

  it('reports arrival once, from the last particle', () => {
    const onArrived = vi.fn();
    const view = render(<TransitLayer transits={transits} onArrived={onArrived} />);
    const particles = view.container.querySelectorAll('.kb-flow-transit-particle');
    fireEvent.animationEnd(particles[0]!);
    expect(onArrived).not.toHaveBeenCalled();
    fireEvent.animationEnd(particles[particles.length - 1]!);
    expect(onArrived).toHaveBeenCalledTimes(1);
    expect(onArrived).toHaveBeenCalledWith(transits[0]);
  });

  it('presents nothing when there is no transit', () => {
    const view = render(<TransitLayer transits={[]} onArrived={() => undefined} />);
    expect(view.container.querySelector('.kb-flow-transit')).toBeNull();
  });
});
