// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCardDrag } from '../../src/client/useCardDrag.js';
import type { CardDropResolver } from '../../src/client/card-drop.js';

afterEach(cleanup);

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
}

function Harness({ resolver, canDrop = () => true, onDrop }: { resolver: CardDropResolver; canDrop?: () => boolean; onDrop: (taskId: string, columnId: string, beforeTaskId: string | null) => void }) {
  const { begin } = useCardDrag({ enabled: true, canDrop, onDrop, resolver });
  return createElement('button', { type: 'button', 'data-testid': 'card', onPointerDown: (event: React.PointerEvent<HTMLElement>) => begin(event, 'task-1', 'stage-1') }, 'card');
}

const target = { columnId: 'stage-2', columnName: 'Two', beforeTaskId: null, indicatorY: 4 };

describe('card drag with an injected resolver', () => {
  it('resolves a drop only after the movement threshold and reports the target', () => {
    const resolve = vi.fn(() => target);
    const onDrop = vi.fn();
    render(createElement(Harness, { resolver: { resolve }, onDrop }));
    fireEvent(screen.getByTestId('card'), pointer('pointerdown', 10, 10));
    expect(document.body.style.userSelect).toBe('none');
    fireEvent(document, pointer('pointermove', 12, 12));
    expect(resolve).not.toHaveBeenCalled();
    fireEvent(document, pointer('pointermove', 40, 40));
    expect(resolve).toHaveBeenCalled();
    fireEvent(document, pointer('pointerup', 40, 40));
    expect(onDrop).toHaveBeenCalledWith('task-1', 'stage-2', null);
  });

  it('never drops on a refused target', () => {
    const onDrop = vi.fn();
    render(createElement(Harness, { resolver: { resolve: () => target }, canDrop: () => false, onDrop }));
    fireEvent(screen.getByTestId('card'), pointer('pointerdown', 10, 10));
    fireEvent(document, pointer('pointermove', 40, 40));
    fireEvent(document, pointer('pointerup', 40, 40));
    expect(onDrop).not.toHaveBeenCalled();
  });
});
