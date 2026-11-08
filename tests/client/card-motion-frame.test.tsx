// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
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

interface GridOptions { resetKey?: string; ready?: boolean; reducedMotion?: () => boolean }

function grid(keys: readonly string[], animator: CardMotionAnimator, options: GridOptions = {}): React.ReactElement<CardMotionFrameProps> {
  return <CardMotionFrame
    className="grid" label="Cards" rowKeys={keys} resetKey={options.resetKey ?? 'view'} ready={options.ready ?? true}
    animator={animator} {...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion })}
  >{keys.map(key => <article key={key} data-task-id={key}>{key}</article>)}</CardMotionFrame>;
}

function cards(container: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'))) found.set(element.dataset['taskId']!, element);
  return found;
}

function arm(container: HTMLElement): void { fireEvent.pointerDown(container.querySelector('.grid')!); }

describe('card motion frame', () => {
  it('glides every card whose order changed and settles a same-key commit', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const elements = cards(view.container);
    arm(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid(['b', 'a'], animator));
    expect(animator.glide).toHaveBeenCalledTimes(2);
    expect(animator.glide).toHaveBeenCalledWith(elements.get('a'), { key: 'a', dx: 0, dy: -60 });
    expect(animator.glide).toHaveBeenCalledWith(elements.get('b'), { key: 'b', dx: 0, dy: 60 });
    animator.glide.mockClear();
    view.rerender(grid(['b', 'a'], animator, { resetKey: 'view' }));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('cancels a running glide before starting the next one', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const elements = cards(view.container);
    arm(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid(['b', 'a'], animator));
    expect(animator.cancelMovements).toHaveBeenCalled();
    expect(animator.cancelMovements.mock.invocationCallOrder[0]).toBeLessThan(animator.glide.mock.invocationCallOrder[0]!);
  });

  it('stays still until the first local pointer or keyboard input', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const elements = cards(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid(['b', 'a'], animator));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('settles a commit that only changed a card size', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const elements = cards(view.container);
    arm(view.container);
    queues.set(elements.get('b')!, [domRect(0, 120)]);
    view.rerender(grid(['a', 'b'], animator, { resetKey: 'view' }));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('settles a replaced view and a board that is not ready', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const elements = cards(view.container);
    arm(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid(['b', 'a'], animator, { resetKey: 'other-board' }));
    expect(animator.glide).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
    view.rerender(grid(['a', 'b'], animator, { resetKey: 'other-board', ready: false }));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('honors the reduced-motion preference', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator, { reducedMotion: () => true }));
    const elements = cards(view.container);
    arm(view.container);
    queues.set(elements.get('a')!, [domRect(0, 0), domRect(0, 60)]);
    queues.set(elements.get('b')!, [domRect(0, 60), domRect(0, 0)]);
    view.rerender(grid(['b', 'a'], animator, { reducedMotion: () => true }));
    expect(animator.glide).not.toHaveBeenCalled();
  });

  it('settles a batch of entries above the cap', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a'], animator));
    arm(view.container);
    const added = Array.from({ length: 9 }, (_, index) => 'n' + index);
    view.rerender(grid(['a', ...added], animator));
    expect(animator.fadeIn).not.toHaveBeenCalled();
    expect(animator.cancelAll).toHaveBeenCalled();
  });

  it('glides a long reorder because cards that stay do not count toward the cap', () => {
    const animator = fakeAnimator();
    const keys = Array.from({ length: 10 }, (_, index) => 'k' + index);
    const view = render(grid(keys, animator));
    const elements = cards(view.container);
    arm(view.container);
    keys.forEach((key, index) => {
      queues.set(elements.get(key)!, [domRect(0, index * 50), domRect(0, (keys.length - 1 - index) * 50)]);
    });
    view.rerender(grid([...keys].reverse(), animator));
    expect(animator.glide).toHaveBeenCalledTimes(10);
  });

  it('fades an entering card', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a'], animator));
    arm(view.container);
    view.rerender(grid(['a', 'b'], animator));
    const entered = cards(view.container).get('b');
    expect(animator.fadeIn).toHaveBeenCalledTimes(1);
    expect(animator.fadeIn).toHaveBeenCalledWith(entered);
  });

  it('fades a leaving card as an inert, identity-free copy in the hidden overlay', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a', 'b'], animator));
    const leaving = cards(view.container).get('b')!;
    arm(view.container);
    queues.set(leaving, [domRect(0, 60)]);
    view.rerender(grid(['a'], animator));
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

  it('keeps the overlay empty and hidden in the rendered grid', () => {
    const animator = fakeAnimator();
    const view = render(grid(['a'], animator));
    const overlay = view.container.querySelector('.kb-motion-overlay');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.childElementCount).toBe(0);
  });
});
