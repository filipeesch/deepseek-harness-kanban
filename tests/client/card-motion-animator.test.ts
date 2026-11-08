// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CardAnimator, GLIDE_CLASS, webAnimations, type AnimatePort } from '../../src/client/card-motion/animator.js';
import { CARD_MOTION } from '../../src/client/card-motion/config.js';

const timing = CARD_MOTION.timing;

interface FakeAnimation { onfinish: ((event?: unknown) => void) | null; cancel: ReturnType<typeof vi.fn> }

function fakePort() {
  const animations: FakeAnimation[] = [];
  const animate = vi.fn((_element: HTMLElement, _keyframes: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation: FakeAnimation = { onfinish: null, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  return { animate: animate as unknown as AnimatePort, calls: animate, animations };
}

function card(): HTMLElement { return document.createElement('div'); }

describe('card animator', () => {
  it('uses the shipped glide and fade timing', () => {
    expect(CARD_MOTION.timing).toEqual({ glideMs: 200, fadeMs: 100, easing: 'ease-out' });
    expect(CARD_MOTION.batchLimit).toBe(8);
  });

  it('glides from the previous offset, raises the card, and clears the transform when it finishes', () => {
    const { animate, calls, animations } = fakePort();
    const animator = new CardAnimator(timing, animate, 3);
    const element = card();
    animator.glide(element, { key: 'a', dx: 12, dy: -8 });
    expect(calls).toHaveBeenCalledWith(element,
      [{ transform: 'translate(12px, -8px)' }, { transform: 'translate(0, 0)' }],
      { duration: timing.glideMs, easing: timing.easing });
    expect(element.classList.contains(GLIDE_CLASS)).toBe(true);
    expect(element.style.zIndex).toBe('3');
    animations[0]!.onfinish!();
    expect(element.classList.contains(GLIDE_CLASS)).toBe(false);
    expect(element.style.zIndex).toBe('');
    expect(animations[0]!.cancel).toHaveBeenCalled();
  });

  it('cancels a running glide before starting the next one', () => {
    const { animate, calls, animations } = fakePort();
    const animator = new CardAnimator(timing, animate, 3);
    const element = card();
    animator.glide(element, { key: 'a', dx: 5, dy: 0 });
    animator.glide(element, { key: 'a', dx: 9, dy: 0 });
    expect(animations[0]!.cancel).toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(2);
    expect(element.classList.contains(GLIDE_CLASS)).toBe(true);
  });

  it('fades an entering card', () => {
    const { animate, calls } = fakePort();
    const animator = new CardAnimator(timing, animate, 3);
    const element = card();
    animator.fadeIn(element);
    expect(calls).toHaveBeenCalledWith(element, [{ opacity: '0' }, { opacity: '1' }], { duration: timing.fadeMs, easing: timing.easing });
  });

  it('appends an exit copy to the overlay and removes it when it finishes', () => {
    const { animate, calls, animations } = fakePort();
    const animator = new CardAnimator(timing, animate, 3);
    const overlay = document.createElement('div');
    const copy = card();
    animator.fadeOut(copy, overlay);
    expect(overlay.contains(copy)).toBe(true);
    expect(calls).toHaveBeenCalledWith(copy, [{ opacity: '1' }, { opacity: '0' }], { duration: timing.fadeMs, easing: timing.easing });
    animations.at(-1)!.onfinish!();
    expect(overlay.contains(copy)).toBe(false);
  });

  it('settles every animation and removes exit copies', () => {
    const { animate } = fakePort();
    const animator = new CardAnimator(timing, animate, 3);
    const element = card();
    const overlay = document.createElement('div');
    const copy = card();
    animator.glide(element, { key: 'a', dx: 1, dy: 1 });
    animator.fadeOut(copy, overlay);
    animator.cancelAll();
    expect(element.classList.contains(GLIDE_CLASS)).toBe(false);
    expect(element.style.zIndex).toBe('');
    expect(overlay.contains(copy)).toBe(false);
  });

  it('does nothing when the host has no Web Animations', () => {
    expect(webAnimations()).toBeNull();
    const animator = new CardAnimator(timing, null, 3);
    expect(animator.enabled).toBe(false);
    const element = card();
    const overlay = document.createElement('div');
    animator.glide(element, { key: 'a', dx: 1, dy: 1 });
    animator.fadeIn(element);
    animator.fadeOut(card(), overlay);
    animator.cancelAll();
    expect(element.className).toBe('');
    expect(overlay.childElementCount).toBe(0);
  });
});
