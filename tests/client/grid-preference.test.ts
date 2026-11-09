// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { GRID_SNAP_KEY, readGridSnap, writeGridSnap } from '../../src/client/grid-preference.js';

beforeEach(() => { localStorage.clear(); });

describe('grid snapping preference', () => {
  it('reads on when nothing is stored', () => {
    expect(readGridSnap()).toBe(true);
  });

  it('remembers off and on', () => {
    expect(writeGridSnap(false)).toBe(false);
    expect(localStorage.getItem(GRID_SNAP_KEY)).toBe('off');
    expect(readGridSnap()).toBe(false);
    writeGridSnap(true);
    expect(localStorage.getItem(GRID_SNAP_KEY)).toBe('on');
    expect(readGridSnap()).toBe(true);
  });

  it('reads a malformed value as on', () => {
    localStorage.setItem(GRID_SNAP_KEY, 'maybe');
    expect(readGridSnap()).toBe(true);
    localStorage.setItem(GRID_SNAP_KEY, '');
    expect(readGridSnap()).toBe(true);
  });

  it('keeps the preference out of the workflow configuration', () => {
    writeGridSnap(false);
    expect(Object.keys(localStorage)).toEqual([GRID_SNAP_KEY]);
  });
});
