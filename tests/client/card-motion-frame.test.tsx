// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CardMotionFrame, type CardMotionFrameProps } from '../../src/client/card-motion/frame.js';
import type { CardMotionAnimator } from '../../src/client/card-motion/animator.js';

interface FakeAnimator extends CardMotionAnimator {
  glide: ReturnType<typeof vi.fn>;
  fadeIn: ReturnType<typeof vi.fn>;
  fadeOut: ReturnType<typeof vi.fn>;
  cancelMovements: ReturnType<typeof vi.fn>;
  cancelAll: ReturnType<typeof vi.fn>;
}

function fakeAnimator(enabled = true): FakeAnimator {
  return {
    enabled,
    glide: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(),
    cancelMovements: vi.fn(), cancelAll: vi.fn(),
  } as unknown as FakeAnimator;
}

function domRect(left: number, top: number, width = 240, height = 40): DOMRect {
  return {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

let queues: Map<Element, DOMRect[]>;

beforeEach(() => {
  queues = new Map();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const queue = queues.get(this);
    if (queue === undefined || queue.length === 0) return domRect(0, 0, 800, 600);
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

interface GridOptions { resetKey?: string; reducedMotion?: () => boolean }

type Entry = readonly [column: string, taskId: string];

function grid(entries: readonly Entry[], animator: CardMotionAnimator, options: GridOptions = {}): React.ReactElement<CardMotionFrameProps> {
  return <CardMotionFrame
    className="grid" label="Cards" layoutKeys={entries.map(([column, id]) => column + '\u0000' + id)}
    resetKey={options.resetKey ?? 'view'} animator={animator}
    {...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion })}
  >{entries.map(([, id]) => <article key={id} data-task-id={id}>{id}</article>)}</CardMotionFrame>;
}

function cards(container: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'))) found.set(element.dataset['taskId']!, element);
  return found;
}

describe('card motion frame', () => {
  it('glides every card whose order changed and settles a same-key commit', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator));
    expect(animator.glide).toHaveBeenCalledTimes(2);
    expect(animator.glide).toHaveBeenCalledWith(elements.get('a'), { key: 'a', dx: 0, dy: -60 });
    expect(animator.glide).toHaveBeenCalledWith(elements.get('b'), { key: 'b', dx: 0, dy: 60 });
    animator.glide.mockClear();
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('glides a card whose stage changed even when the flat task order stayed identical', () => {
    const animator = fakeAnimator();
    const view = render(grid([['left', 'a'], ['right', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(240, 0)]);
    queues.set(elements.get('b')!, [domRect(240, 0), domRect(240, 0)]);
    view.rerender(grid([['right', 'a'], ['right', 'b']], animator));
    expect(animator.glide).toHaveBeenCalledTimes(1);
    expect(animator.glide).toHaveBeenCalledWith(elements.get('a'), { key: 'a', dx: -240, dy: 0 });
  });

  it('cancels a running glide before starting the next one', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator));
    expect(animator.cancelMovements).toHaveBeenCalled();
    expect(animator.cancelMovements.mock.invocationCallOrder[0]).toBeLessThan(animator.glide.mock.invocationCallOrder[0]!);
  });

  it('settles a commit that only changed a card size', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('b')!, [domRect(0, 120)]);
    view.rerender(grid([['c', 'a'], ['c', 'b']], animator));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('settles a replaced view', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator, { resetKey: 'other-board' }));
    expect(animator.glide).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('honors reduced motion for movement, entries, and exits', () => {
    const animator = fakeAnimator();
    const reducedMotion = (): boolean => true;
    const view = render(grid([['c', 'a'], ['c', 'b']], animator, { reducedMotion }));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60)]);
    view.rerender(grid([['c', 'b'], ['c', 'c']], animator, { reducedMotion }));
    expect(animator.glide).not.toHaveBeenCalled();
    expect(animator.fadeIn).not.toHaveBeenCalled();
    expect(animator.fadeOut).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('animates exactly eight entries', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a']], animator));
    view.rerender(grid([['c', 'a'], ...Array.from({ length: 8 }, (_, index) => ['c', 'e' + index] as Entry)], animator));
    expect(animator.fadeIn).toHaveBeenCalledTimes(8);
  });

  it('settles nine entries', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a']], animator));
    view.rerender(grid([['c', 'a'], ...Array.from({ length: 9 }, (_, index) => ['c', 'e' + index] as Entry)], animator));
    expect(animator.fadeIn).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('settles a batch of exits above the cap', () => {
    const animator = fakeAnimator();
    const keys = Array.from({ length: 9 }, (_, index) => ['c', 'x' + index] as Entry);
    const view = render(grid(keys, animator));
    view.rerender(grid([], animator));
    expect(animator.fadeOut).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('glides a long reorder because cards that stay do not count toward the cap', () => {
    const animator = fakeAnimator();
    const keys = Array.from({ length: 10 }, (_, index) => ['c', 'k' + index] as Entry);
    const view = render(grid(keys, animator));
    const elements = cards(view.container);
    for (const [index, key] of ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'].entries()) {
      queues.set(elements.get(key)!, [domRect(0, index * 50), domRect(0, (9 - index) * 50)]);
    }
    view.rerender(grid([...keys].reverse(), animator));
    expect(animator.glide).toHaveBeenCalledTimes(10);
  });

  it('fades the first card of an empty board', () => {
    const animator = fakeAnimator();
    const view = render(grid([], animator));
    view.rerender(grid([['c', 'a']], animator));
    expect(animator.fadeIn).toHaveBeenCalledTimes(1);
  });

  it('skips cards outside the visible board', () => {
    const animator = fakeAnimator();
    const view = render(grid([['left', 'a']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, -400), domRect(0, -350)]);
    view.rerender(grid([['right', 'a']], animator));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('fades a leaving card as an inert, identity-free copy in the hidden overlay', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const leaving = cards(view.container).get('b')!;
    queues.set(leaving, [domRect(0, 60)]);
    view.rerender(grid([['c', 'a']], animator));
    expect(animator.fadeOut).toHaveBeenCalledTimes(1);
    const [copy, overlay] = animator.fadeOut.mock.calls[0] as [HTMLElement, HTMLElement];
    expect(copy.hasAttribute('data-task-id')).toBe(false);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.inert).toBe(true);
    expect(copy.style.position).toBe('absolute');
    expect(copy.style.top).toBe('60px');
    expect(overlay.className).toBe('kb-motion-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelectorAll('[data-task-id]')).toHaveLength(1);
  });

  it('settles and clears motion when the frame unmounts', () => {
    const animator = fakeAnimator();
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator));
    view.unmount();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('does nothing on a host without animations', () => {
    const animator = fakeAnimator(false);
    const view = render(grid([['c', 'a'], ['c', 'b']], animator));
    view.rerender(grid([['c', 'b'], ['c', 'a']], animator));
    expect(animator.glide).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });
});
