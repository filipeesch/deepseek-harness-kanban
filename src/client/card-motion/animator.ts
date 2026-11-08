import type { MotionTiming } from './config.js';
import type { CardMovement } from './layout.js';

/** The Web Animations call the animator uses; injected so tests never need a real animation. */
export type AnimatePort = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;

/** The class added only while a card glides, so it paints above the columns it crosses. */
export const GLIDE_CLASS = 'kb-card-gliding';

/** The animator surface the frame depends on; the DOM implementation lives below. */
export interface CardMotionAnimator {
  readonly enabled: boolean;
  glide(element: HTMLElement, movement: CardMovement): void;
  fadeIn(element: HTMLElement): void;
  fadeOut(copy: HTMLElement, overlay: HTMLElement): void;
  /** Cancels glides, leaving exit copies to finish. */
  cancelMovements(): void;
  /** Cancels glides and removes every exit copy. */
  cancelAll(): void;
}

/** The browser's Web Animations entry point, or null when the host does not provide it. */
export function webAnimations(): AnimatePort | null {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return null;
  return (element, keyframes, options) => element.animate(keyframes, options);
}

/**
 * Applies the board's movement and fade animations and owns their lifetime.
 *
 * Every animation is cancelled when it finishes, so no transform or opacity
 * survives it. Exit copies live in the frame's overlay and are removed on finish
 * or when the frame settles.
 */
export class CardAnimator implements CardMotionAnimator {
  readonly enabled: boolean;
  private readonly timing: MotionTiming;
  private readonly animate: AnimatePort | null;
  private readonly stackingIndex: number;
  private readonly movements = new Map<HTMLElement, Animation>();
  private readonly exits = new Map<HTMLElement, Animation>();

  constructor(timing: MotionTiming, animate: AnimatePort | null, stackingIndex: number) {
    this.timing = timing;
    this.animate = animate;
    this.stackingIndex = stackingIndex;
    this.enabled = animate !== null;
  }

  glide(element: HTMLElement, movement: CardMovement): void {
    const animate = this.animate;
    if (animate === null) return;
    this.cancelMovement(element);
    element.classList.add(GLIDE_CLASS);
    element.style.zIndex = String(this.stackingIndex);
    const animation = animate(element, [
      { transform: 'translate(' + movement.dx + 'px, ' + movement.dy + 'px)' },
      { transform: 'translate(0, 0)' },
    ], { duration: this.timing.glideMs, easing: this.timing.easing });
    this.movements.set(element, animation);
    animation.onfinish = () => {
      if (this.movements.get(element) !== animation) return;
      this.movements.delete(element);
      element.classList.remove(GLIDE_CLASS);
      element.style.zIndex = '';
      animation.onfinish = null;
      animation.cancel();
    };
  }

  fadeIn(element: HTMLElement): void {
    const animate = this.animate;
    if (animate === null) return;
    this.cancelMovement(element);
    const animation = animate(element, [{ opacity: '0' }, { opacity: '1' }], { duration: this.timing.fadeMs, easing: this.timing.easing });
    this.movements.set(element, animation);
    animation.onfinish = () => {
      if (this.movements.get(element) !== animation) return;
      this.movements.delete(element);
      animation.onfinish = null;
      animation.cancel();
    };
  }

  fadeOut(copy: HTMLElement, overlay: HTMLElement): void {
    const animate = this.animate;
    if (animate === null) return;
    overlay.append(copy);
    const animation = animate(copy, [{ opacity: '1' }, { opacity: '0' }], { duration: this.timing.fadeMs, easing: this.timing.easing });
    this.exits.set(copy, animation);
    animation.onfinish = () => {
      if (this.exits.get(copy) !== animation) return;
      this.exits.delete(copy);
      copy.remove();
      animation.onfinish = null;
      animation.cancel();
    };
  }

  cancelMovements(): void {
    for (const [element, animation] of this.movements) {
      animation.onfinish = null;
      animation.cancel();
      element.classList.remove(GLIDE_CLASS);
      element.style.zIndex = '';
    }
    this.movements.clear();
  }

  cancelAll(): void {
    this.cancelMovements();
    for (const [copy, animation] of this.exits) {
      animation.onfinish = null;
      animation.cancel();
      copy.remove();
    }
    this.exits.clear();
  }

  private cancelMovement(element: HTMLElement): void {
    const animation = this.movements.get(element);
    if (animation === undefined) return;
    animation.onfinish = null;
    animation.cancel();
    element.classList.remove(GLIDE_CLASS);
    element.style.zIndex = '';
    this.movements.delete(element);
  }
}
