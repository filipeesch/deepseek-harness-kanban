import { describe, expect, it } from 'vitest';
import { hoverReduce, NO_HOVER, type HoverState } from '../../src/client/workflow-view/affordance-hover.js';

function enter(id: string): HoverState {
  return hoverReduce(NO_HOVER, { kind: 'enter', id });
}

describe('connection hover', () => {
  it('marks the connection the pointer entered', () => {
    const state = enter('a->b');
    expect(state).toEqual({ id: 'a->b', pending: null });
  });

  it('keeps the marks presented while a leave waits for the linger', () => {
    const left = hoverReduce(enter('a->b'), { kind: 'leave', id: 'a->b' });
    expect(left.id).toBe('a->b');
    expect(left.pending).toBe('a->b');
  });

  it('clears the marks when the linger settles', () => {
    const left = hoverReduce(enter('a->b'), { kind: 'leave', id: 'a->b' });
    expect(hoverReduce(left, { kind: 'settle', id: 'a->b' })).toEqual(NO_HOVER);
  });

  it('keeps the marks of a handle that reports entering before the linger', () => {
    const left = hoverReduce(enter('a->b'), { kind: 'leave', id: 'a->b' });
    const again = hoverReduce(left, { kind: 'enter', id: 'a->b' });
    expect(hoverReduce(again, { kind: 'settle', id: 'a->b' })).toEqual({ id: 'a->b', pending: null });
  });

  it('does not clear the marks of the connection the pointer moved to', () => {
    const left = hoverReduce(enter('a->b'), { kind: 'leave', id: 'a->b' });
    const moved = hoverReduce(left, { kind: 'enter', id: 'c->d' });
    expect(hoverReduce(moved, { kind: 'settle', id: 'a->b' })).toEqual({ id: 'c->d', pending: null });
  });

  it('ignores the leave of a connection that is not pointed at', () => {
    const state = enter('a->b');
    expect(hoverReduce(state, { kind: 'leave', id: 'c->d' })).toBe(state);
  });

  it('forgets everything on clear', () => {
    const left = hoverReduce(enter('a->b'), { kind: 'leave', id: 'a->b' });
    expect(hoverReduce(left, { kind: 'clear' })).toEqual(NO_HOVER);
    expect(hoverReduce(NO_HOVER, { kind: 'clear' })).toBe(NO_HOVER);
  });
});
