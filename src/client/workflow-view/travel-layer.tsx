import React, { useEffect, useRef } from 'react';
import { webAnimations, type AnimatePort } from '../card-motion/animator.js';
import type { DiagramPoint } from './connections.js';
import { TRAVEL } from './travel.js';

export interface TravelMoveView {
  readonly id: string;
  readonly title: string;
  readonly points: readonly DiagramPoint[];
}

/**
 * Plays the card travel inside the diagram viewport. Each move renders a card
 * copy in flow coordinates and animates it through the sampled connection
 * points with the Web Animations API, so the drawing and the movement agree.
 */
export function TravelLayer({ moves, onFinished, animate = webAnimations() }: { moves: readonly TravelMoveView[]; onFinished: () => void; /** Injected so tests never need real animations. */ animate?: AnimatePort | null }) {
  const elements = useRef(new Map<string, HTMLDivElement | null>());
  useEffect(() => {
    const animations: Animation[] = [];
    for (const move of moves) {
      const element = elements.current.get(move.id);
      const start = move.points[0];
      if (element === null || element === undefined || start === undefined || animate === null) continue;
      const frames = move.points.map((point, index) => ({
        transform: 'translate(' + (point.x - start.x) + 'px, ' + (point.y - start.y) + 'px)',
        offset: index / Math.max(1, move.points.length - 1),
        opacity: index === 0 ? 0.2 : index === move.points.length - 1 ? 0.4 : 1,
      }));
      animations.push(animate(element, frames, { duration: TRAVEL.durationMs, easing: TRAVEL.easing, fill: 'forwards' }));
    }
    const timer = setTimeout(onFinished, TRAVEL.durationMs + TRAVEL.fadeMs);
    return () => {
      clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [moves, onFinished, animate]);
  return <>{moves.map(move => {
    const start = move.points[0];
    if (start === undefined) return null;
    return <div key={move.id} ref={element => { elements.current.set(move.id, element); }} className="kb-flow-travel" style={{ left: start.x, top: start.y }} aria-hidden="true">
      <div className="kb-flow-travel-card">{move.title}</div>
    </div>;
  })}</>;
}
